// Passkeys (WebAuthn) for the dashboard: log in with Face ID / fingerprint / the device's screen lock.
// A passkey is added while logged in (it belongs to that login) and is then used instead of OTP / password.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, desc, eq } from "drizzle-orm";
import { db, passkeys, teamMembers, users } from "~/db.server";
import { env } from "./env.server";
import type { LoginResult, Viewer } from "./auth.server";

const origin = () => new URL(env.appUrl).origin;
const rpID = () => new URL(env.appUrl).hostname;
const RP_NAME = "Growpefy";

/** Challenges we handed out, valid for 5 minutes and usable once. */
const challenges = new Map<string, { at: number; purpose: "register" | "login"; who?: string }>();
const CHALLENGE_MS = 5 * 60_000;
function remember(challenge: string, purpose: "register" | "login", who?: string) {
  const now = Date.now();
  for (const [k, v] of challenges) if (now - v.at > CHALLENGE_MS) challenges.delete(k);
  challenges.set(challenge, { at: now, purpose, who });
}
function consume(challenge: string, purpose: "register" | "login", who?: string) {
  const c = challenges.get(challenge);
  if (!c || c.purpose !== purpose || Date.now() - c.at > CHALLENGE_MS || (who && c.who !== who)) return false;
  challenges.delete(challenge);
  return true;
}

/** Who a passkey logs in as. */
export function principalOf(v: Viewer): { kind: "admin" | "user" | "member"; refId: number; label: string } {
  if (v.role === "admin") return v.staff ? { kind: "member", refId: v.staff.id, label: v.staff.name } : { kind: "admin", refId: 0, label: "Super admin" };
  return v.member ? { kind: "member", refId: v.member.id, label: v.member.name } : { kind: "user", refId: v.userId, label: v.name };
}
const key = (p: { kind: string; refId: number }) => `${p.kind}:${p.refId}`;

export async function listPasskeys(v: Viewer) {
  const p = principalOf(v);
  return db.select({ id: passkeys.id, device: passkeys.device, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys).where(and(eq(passkeys.kind, p.kind), eq(passkeys.refId, p.refId))).orderBy(desc(passkeys.createdAt));
}

export async function registrationOptions(v: Viewer) {
  const p = principalOf(v);
  const existing = await db.select({ id: passkeys.credentialId, transports: passkeys.transports }).from(passkeys)
    .where(and(eq(passkeys.kind, p.kind), eq(passkeys.refId, p.refId)));
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: rpID(),
    userName: v.email || p.label, userDisplayName: `${p.label} (Growpefy)`,
    userID: new TextEncoder().encode(key(p)),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: (c.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  remember(options.challenge, "register", key(p));
  return options;
}

export async function finishRegistration(v: Viewer, response: RegistrationResponseJSON, device: string) {
  const p = principalOf(v);
  const r = await verifyRegistrationResponse({
    response, expectedOrigin: origin(), expectedRPID: rpID(), requireUserVerification: true,
    expectedChallenge: (c) => consume(c, "register", key(p)),
  });
  if (!r.verified || !r.registrationInfo) throw new Error("This device couldn't be set up. Please try again.");
  const c = r.registrationInfo.credential;
  await db.insert(passkeys).values({
    credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter,
    transports: c.transports ?? null, kind: p.kind, refId: p.refId, device: device.slice(0, 80),
  }).onConflictDoNothing();
  return true;
}

export async function removePasskey(v: Viewer, id: number) {
  const p = principalOf(v);
  await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.kind, p.kind), eq(passkeys.refId, p.refId)));
}

export async function loginOptions() {
  const options = await generateAuthenticationOptions({ rpID: rpID(), userVerification: "required", allowCredentials: [] });
  remember(options.challenge, "login");
  return options;
}

/** Checks the passkey and returns who to log in as (only active accounts). */
export async function finishLogin(response: AuthenticationResponseJSON): Promise<LoginResult> {
  const [pk] = await db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).limit(1);
  if (!pk) throw new Error("This Face ID / fingerprint isn't set up for Growpefy on this device yet. Log in with OTP once and turn it on.");
  const r = await verifyAuthenticationResponse({
    response, expectedOrigin: origin(), expectedRPID: rpID(), requireUserVerification: true,
    expectedChallenge: (c) => consume(c, "login"),
    credential: { id: pk.credentialId, publicKey: new Uint8Array(Buffer.from(pk.publicKey, "base64url")), counter: pk.counter, transports: (pk.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined },
  });
  if (!r.verified) throw new Error("Couldn't confirm it's you. Please try again.");
  await db.update(passkeys).set({ counter: r.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, pk.id));
  if (pk.kind === "admin") return { admin: true };
  if (pk.kind === "user") {
    const [u] = await db.select().from(users).where(eq(users.id, pk.refId)).limit(1);
    if (!u || !u.active) throw new Error("This account is turned off. Contact Growpefy.");
    return { user: u };
  }
  const [m] = await db.select().from(teamMembers).where(eq(teamMembers.id, pk.refId)).limit(1);
  if (!m || !m.active) throw new Error("This login is turned off. Ask your admin.");
  await db.update(teamMembers).set({ lastLoginAt: new Date() }).where(eq(teamMembers.id, m.id));
  return { member: m };
}

// Super admin PIN on a store. When a store has one, the Growpefy admin (and platform staff) must enter it before any page
// of that store opens. Store owners and their team are never asked. Unlocks last 12 hours in this browser and end on
// logout or when the PIN changes. Forgotten PIN: OTP to the recovery contact saved with the PIN, then a new PIN.
import { createCookie, redirect } from "@remix-run/node";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, stores, type Store } from "~/db.server";
import { env } from "~/lib/env.server";
import { storeCode } from "~/lib/store-code";

export const PIN_LENGTHS = [4, 6] as const;
const UNLOCK_HOURS = 12;
const MAX_TRIES = 5;
const LOCK_MINUTES = 15;

// ---------- hashing ----------
export function hashPin(pin: string) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export function checkPin(pin: string, stored: string | null) {
  if (!stored) return false;
  const [v, salt, key] = stored.split("$");
  if (v !== "s1" || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = crypto.scryptSync(pin, Buffer.from(salt, "base64url"), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
export const validPin = (pin: string, len: number) => new RegExp(`^\\d{${len}}$`).test(pin);
/** 1234, 0000, 123456… are refused */
export function weakPin(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const up = "0123456789012345", down = "9876543210987654";
  return up.includes(pin) || down.includes(pin);
}

// ---------- unlock cookie ----------
const unlockCookie = createCookie("gp_store_unlock", {
  httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
  secrets: [env.sessionSecret], maxAge: UNLOCK_HOURS * 3600,
});
type Unlocks = Record<string, { exp: number; tag: string }>;
/** Changing the PIN changes the tag, so old unlocks stop working */
const tagOf = (s: Pick<Store, "adminPinHash">) => crypto.createHash("sha256").update(s.adminPinHash ?? "").digest("base64url").slice(0, 12);

export async function readUnlocks(request: Request): Promise<Unlocks> {
  try {
    const v = (await unlockCookie.parse(request.headers.get("Cookie"))) as Unlocks | null;
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
export async function unlockHeader(request: Request, s: Store) {
  const now = Date.now();
  const cur = Object.fromEntries(Object.entries(await readUnlocks(request)).filter(([, u]) => u.exp > now));
  cur[String(s.id)] = { exp: now + UNLOCK_HOURS * 3600_000, tag: tagOf(s) };
  return unlockCookie.serialize(cur);
}
export const clearUnlocksHeader = () => unlockCookie.serialize({}, { maxAge: 0 });

export function isUnlocked(unlocks: Unlocks | undefined, s: Store) {
  if (!s.adminPinHash) return true;
  const u = unlocks?.[String(s.id)];
  return Boolean(u && u.exp > Date.now() && u.tag === tagOf(s));
}

/** For requireStore: send a locked store to the PIN screen (admin viewers only). */
export function guardStore(v: { role: string; unlocked?: Unlocks; path?: string }, s: Store) {
  if (v.role !== "admin" || isUnlocked(v.unlocked, s)) return;
  const next = v.path && v.path.startsWith("/") && !v.path.startsWith("//") ? v.path : "";
  throw redirect(`/unlock/${storeCode(s.id)}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
}

// ---------- wrong tries ----------
const tries = new Map<number, { n: number; until: number }>();
export function lockedFor(storeId: number) {
  const t = tries.get(storeId);
  return t && t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 60_000) : 0;
}
export function wrongTry(storeId: number) {
  const t = tries.get(storeId) ?? { n: 0, until: 0 };
  t.n += 1;
  if (t.n >= MAX_TRIES) { t.until = Date.now() + LOCK_MINUTES * 60_000; t.n = 0; }
  tries.set(storeId, t);
  return t.until > Date.now() ? 0 : MAX_TRIES - t.n;
}
export const rightTry = (storeId: number) => tries.delete(storeId);

// ---------- reset ticket (after the OTP, to set a new PIN) ----------
export function resetTicket(s: Store) {
  const body = `${s.id}.${Date.now() + 15 * 60_000}`;
  const sig = crypto.createHmac("sha256", env.sessionSecret).update(`pin-reset:${body}:${tagOf(s)}`).digest("base64url");
  return `${body}.${sig}`;
}
export function ticketOk(ticket: string, s: Store) {
  const [id, exp, sig] = ticket.split(".");
  if (Number(id) !== s.id || !(Number(exp) > Date.now()) || !sig) return false;
  const want = crypto.createHmac("sha256", env.sessionSecret).update(`pin-reset:${id}.${exp}:${tagOf(s)}`).digest("base64url");
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

// ---------- saving ----------
export async function savePin(storeId: number, pin: string, len: number, contact: string | null) {
  await db.update(stores).set({ adminPinHash: hashPin(pin), adminPinLen: len, adminPinContact: contact, adminPinSetAt: new Date() }).where(eq(stores.id, storeId));
  rightTry(storeId);
}
export async function removePin(storeId: number) {
  await db.update(stores).set({ adminPinHash: null, adminPinLen: null, adminPinContact: null, adminPinSetAt: null }).where(eq(stores.id, storeId));
  rightTry(storeId);
}

/** "+91 98•••••210" / "yu•••@gmail.com" */
export function maskContact(c: string | null) {
  if (!c) return "";
  if (c.includes("@")) { const [u, d] = c.split("@"); return `${u.slice(0, 2)}•••@${d}`; }
  return `+91 ${c.slice(0, 2)}•••••${c.slice(-3)}`;
}

// "Continue with Google" / "Continue with Facebook" for store owners. Buttons show only when the keys are set:
// GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, FACEBOOK_APP_ID + FACEBOOK_APP_SECRET (Railway variables).
// An email that already has an account logs into it; a new email creates an owner (KYC asks for the mobile next).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { redirect } from "@remix-run/node";
import { readAttribution } from "./attribution";
import { createOwner, findOwner, signupOpen, startSession } from "./auth.server";
import { env } from "./env.server";

export type Provider = "google" | "facebook";
const FB = "https://graph.facebook.com/v21.0";

export function socialProviders() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    facebook: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
  };
}

const callback = (p: Provider) => `${env.appUrl}/auth/${p}/callback`;
const sign = (v: string) => createHmac("sha256", env.sessionSecret).update(v).digest("base64url");
const COOKIE = "gp_oauth";

/** Sends the browser to Google / Facebook. State (random + where to go after) is kept in a signed short cookie. */
export function startSocial(p: Provider, request: Request) {
  if (!socialProviders()[p]) throw redirect("/login");
  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next") ?? "/dashboard";
  const next = nextRaw.startsWith("/dashboard") || nextRaw.startsWith("/onboarding") ? nextRaw : "/dashboard";
  const nonce = randomBytes(16).toString("base64url");
  const val = `${p}.${nonce}.${Buffer.from(next).toString("base64url")}`;
  const cookie = `${COOKIE}=${val}.${sign(val)}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  const to = p === "google"
    ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: callback(p), response_type: "code", scope: "openid email profile", state: nonce, prompt: "select_account" })}`
    : `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({ client_id: process.env.FACEBOOK_APP_ID!, redirect_uri: callback(p), response_type: "code", scope: "email,public_profile", state: nonce })}`;
  return redirect(to, { headers: { "Set-Cookie": cookie } });
}

function readState(request: Request, p: Provider) {
  const raw = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
  const i = raw.lastIndexOf(".");
  const val = raw.slice(0, i), sig = raw.slice(i + 1);
  const good = sig && sign(val).length === sig.length && timingSafeEqual(Buffer.from(sign(val)), Buffer.from(sig));
  const [prov, nonce, next64] = val.split(".");
  if (!good || prov !== p) return null;
  return { nonce, next: Buffer.from(next64 ?? "", "base64url").toString() || "/dashboard" };
}

async function profile(p: Provider, code: string): Promise<{ email: string; name: string } | null> {
  if (p === "google") {
    const t = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: callback(p), grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json() as Promise<{ access_token?: string }>);
    if (!t.access_token) return null;
    const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json() as Promise<{ email?: string; email_verified?: boolean; name?: string }>);
    return u.email && u.email_verified ? { email: u.email.toLowerCase(), name: u.name ?? "" } : null;
  }
  const t = await fetch(`${FB}/oauth/access_token?${new URLSearchParams({ client_id: process.env.FACEBOOK_APP_ID!, client_secret: process.env.FACEBOOK_APP_SECRET!, redirect_uri: callback(p), code })}`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => r.json() as Promise<{ access_token?: string }>);
  if (!t.access_token) return null;
  const proof = createHmac("sha256", process.env.FACEBOOK_APP_SECRET!).update(t.access_token).digest("hex");
  const u = await fetch(`${FB}/me?${new URLSearchParams({ fields: "name,email", access_token: t.access_token, appsecret_proof: proof })}`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => r.json() as Promise<{ email?: string; name?: string }>);
  return u.email ? { email: u.email.toLowerCase(), name: u.name ?? "" } : null;
}

const fail = (msg: string) => redirect(`/login?oauth_error=${encodeURIComponent(msg)}`, { headers: { "Set-Cookie": `${COOKIE}=; Path=/auth; Max-Age=0` } });

/** Google / Facebook sent the shopper back: log in, or create the owner account. */
export async function finishSocial(p: Provider, request: Request) {
  const url = new URL(request.url);
  const st = readState(request, p);
  if (url.searchParams.get("error")) return fail("Login was cancelled.");
  if (!st || st.nonce !== url.searchParams.get("state")) return fail("That login link expired. Please try again.");
  const code = url.searchParams.get("code");
  if (!code) return fail("Login was cancelled.");
  let who: { email: string; name: string } | null = null;
  try { who = await profile(p, code); } catch (e) { console.error(`[social] ${p}:`, e instanceof Error ? e.message : e); }
  if (!who) return fail(p === "facebook" ? "Facebook didn't share your email. Use Google or your mobile number instead." : "Google didn't confirm your email. Please try again.");

  const existing = await findOwner("email", who.email);
  if (existing) {
    if (!existing.active) return fail("This account is turned off. Contact Growpefy.");
    console.log(`[social] ${p} login user=${existing.id}`);
    return startSession(request, { user: existing }, st.next);
  }
  if (!signupOpen()) return fail("No account with this email. Ask Growpefy for access.");
  const user = await createOwner({ brandName: who.name || who.email.split("@")[0], channel: "email", target: who.email, attribution: readAttribution(request) });
  console.log(`[social] ${p} signup user=${user.id}`);
  return startSession(request, { user }, "/onboarding?welcome=1");
}

// Shared bits for courier integrations: status mapping, HTTP, session cache, sealed passwords.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.server";
import type { ShipStatus } from "../rto-shield";

export type TrackResult = { awb: string; status: ShipStatus | null; raw: string; at: Date | null };
export type TestResult = { ok: true } | { ok: false; error: string };

/** Courier status text → our status. null = no change (lost, reverse pickup in progress…). */
export function mapStatusText(text: string | null | undefined): ShipStatus | null {
  const s = String(text ?? "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/cancel/.test(s)) return "cancelled";
  if (/\brto\b|\brts\b|return(ed)? to (origin|shipper|seller)/.test(s)) {
    if (/undeliver|out for|not deliver/.test(s)) return "rto_transit";
    if (/deliver|received|acknowledg|completed|closed|\bdone\b|returned to (origin|shipper|seller)/.test(s)) return "rto";
    return "rto_transit";
  }
  if (/\bdto\b|\breturn|\breverse/.test(s)) {
    if (/undeliver|out for|initiat|request|pickup|picked|transit|schedul/.test(s)) return null;
    if (/deliver|received|completed|^returned$/.test(s)) return "returned";
    return null;
  }
  if (/\blost\b|damage|destroy|dispos/.test(s)) return null;
  if (/undeliver|not deliver|fail|\bndr\b|attempt|out for delivery|\bofd\b/.test(s)) return "in_transit";
  if (/deliver/.test(s)) return "delivered";
  return "in_transit";
}

export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

export class CourierAuthError extends Error {}

export async function http(url: string, init: RequestInit & { label: string; timeout?: number }) {
  const { label, timeout, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: { Accept: "application/json", ...(rest.body ? { "Content-Type": "application/json" } : {}), ...rest.headers }, signal: AbortSignal.timeout(timeout ?? 20_000) });
  } catch (e) {
    throw new Error(`Couldn't reach ${label}: ${e instanceof Error ? e.message : "network error"}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, ok: res.ok, body: body as Record<string, any> | null };
}

/** Runs fn over items with limited parallel calls. */
export async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const x = items[i++]; out.push(await fn(x)); }
  }));
  return out;
}

// ---- session tokens (logins are cached in memory, refreshed before expiry) ----
const sessions = new Map<string, { token: string; exp: number }>();

export async function session(key: string, ttlMs: number, login: () => Promise<string>, fresh = false) {
  const hit = sessions.get(key);
  if (!fresh && hit && hit.exp > Date.now()) return hit.token;
  const token = await login();
  sessions.set(key, { token, exp: Date.now() + ttlMs });
  return token;
}
export const dropSession = (key: string) => void sessions.delete(key);

/** Calls fn with a session token; logs in again once if the courier says the token expired. */
export async function withSession<R>(key: string, ttlMs: number, login: () => Promise<string>, fn: (token: string) => Promise<R>): Promise<R> {
  try {
    return await fn(await session(key, ttlMs, login));
  } catch (e) {
    if (!(e instanceof CourierAuthError)) throw e;
    dropSession(key);
    return fn(await session(key, ttlMs, login, true));
  }
}

// ---- sealed passwords ----
const KEY = () => createHash("sha256").update(`${env.sessionSecret}:courier-creds`).digest();

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64")}`;
}

export function unseal(v: string | undefined) {
  if (!v) return "";
  if (!v.startsWith("enc:v1:")) return v;
  try {
    const b = Buffer.from(v.slice(7), "base64");
    const d = createDecipheriv("aes-256-gcm", KEY(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new CourierAuthError("Saved courier password can't be read any more. Connect the courier again.");
  }
}

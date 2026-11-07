// Shopper accounts on a store's website: OTP / password login, profile, and the shopper's own orders.
import { createCookie } from "@remix-run/node";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { customerOtps, db, orders, storeCustomers, type Store, type StoreCustomer } from "~/db.server";
import { env } from "./env.server";
import { messaging, otpMode, otpReady, verifyWidgetToken, widgetPublic } from "./rto.server";
import { chargeUsage } from "./wallet.server";
import { accountSettings, normPhone, validEmail, validPhone, type Channel } from "./customer-accounts";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const TTL_MS = 10 * 60_000;
const RESEND_MS = 30_000;
const MAX_SENDS_HOUR = 5;
const MAX_IP_HOUR = 20;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 60;

const hashCode = (id: string, code: string) => crypto.createHmac("sha256", env.sessionSecret).update(`c:${id}:${code}`).digest("hex");

// ---------- identifiers ----------

export function parseTarget(channel: Channel, raw: string): string | null {
  if (channel === "phone") { const p = normPhone(raw); return validPhone(p) ? p : null; }
  const e = raw.trim().toLowerCase();
  return validEmail(e) ? e : null;
}

export const showTarget = (channel: Channel, t: string) => (channel === "phone" ? `+91 ${t.slice(0, 5)} ${t.slice(5)}` : t);

// ---------- one-time codes ----------

/** Is a code for this channel possible right now? */
export async function channelReady(channel: Channel) {
  if (channel === "email") return Boolean(process.env.RESEND_API_KEY) || process.env.EMAIL_TEST_MODE === "1";
  return otpReady(await messaging());
}

/** MSG91 widget settings for the browser when phone codes go through the widget. */
export async function phoneWidget() {
  return widgetPublic(await messaging());
}

async function sendSms(store: Store, phone: string, code: string) {
  const m = await messaging();
  if (m.msg91AuthKey === "test") return true;
  const u = new URL("https://control.msg91.com/api/v5/otp");
  u.searchParams.set("template_id", m.msg91TemplateId!);
  u.searchParams.set("mobile", `91${phone}`);
  u.searchParams.set("otp", code);
  u.searchParams.set("otp_expiry", "10");
  const res = await fetch(u, { method: "POST", headers: { authkey: m.msg91AuthKey!, "Content-Type": "application/json" }, body: JSON.stringify({ store: store.name.slice(0, 30) }), signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
  if (!res.ok || body.type !== "success") { console.error("[customer-otp] msg91:", res.status, body.message); return false; }
  return true;
}

async function sendMail(store: Store, to: string, code: string) {
  if (process.env.EMAIL_TEST_MODE === "1" || !process.env.RESEND_API_KEY) { console.log(`[customer-otp] test mode, code for ${to}: ${code}`); return true; }
  const name = store.name.replace(/[<>"]/g, "");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.STORE_MAIL_FROM || `${name} <no-reply@growpefy.com>`,
      to: [to],
      subject: `${code} is your ${name} login code`,
      text: `Your ${name} login code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px"><p style="font-size:15px;color:#333">Your ${name} login code</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:8px 0 16px">${code}</p><p style="font-size:13px;color:#777">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) { console.error("[customer-otp] resend:", res.status); return false; }
  return true;
}

export async function sendCode(store: Store, channel: Channel, target: string, ip?: string): Promise<{ ok: true; resendIn: number } | { ok: false; error: string; resendIn?: number }> {
  if (!(await channelReady(channel))) return { ok: false, error: channel === "phone" ? "SMS codes aren't available right now." : "Email codes aren't available right now." };
  const hourAgo = new Date(Date.now() - 3600_000);
  const recent = await db.select({ createdAt: customerOtps.createdAt }).from(customerOtps)
    .where(and(eq(customerOtps.storeId, store.id), eq(customerOtps.target, target), gt(customerOtps.createdAt, hourAgo))).orderBy(desc(customerOtps.createdAt));
  if (recent.length >= MAX_SENDS_HOUR) return { ok: false, error: "Too many codes requested. Try again in an hour." };
  const wait = recent[0] ? RESEND_MS - (Date.now() - recent[0].createdAt.getTime()) : 0;
  if (wait > 0) return { ok: false, error: "Please wait before asking for a new code", resendIn: Math.ceil(wait / 1000) };
  if (ip) {
    const byIp = await db.select({ id: customerOtps.id }).from(customerOtps).where(and(eq(customerOtps.ip, ip), gt(customerOtps.createdAt, hourAgo))).limit(MAX_IP_HOUR);
    if (byIp.length >= MAX_IP_HOUR) return { ok: false, error: "Too many codes requested from this network. Try again later." };
  }
  const id = crypto.randomUUID();
  // Widget mode: the browser sends the SMS through MSG91; we only count it
  if (channel === "phone" && otpMode(await messaging()) === "widget") {
    await db.insert(customerOtps).values({ id, storeId: store.id, channel, target, codeHash: hashCode(id, crypto.randomUUID()), ip: ip ?? null, expiresAt: new Date(Date.now() + TTL_MS) });
    await chargeUsage(store.id, "otp", id, `Login OTP to +91 ${target.slice(0, 2)}xxxxxx${target.slice(-2)}`).catch(() => {});
    return { ok: true, resendIn: RESEND_MS / 1000 };
  }
  const test = channel === "phone" ? (await messaging()).msg91AuthKey === "test" : process.env.EMAIL_TEST_MODE === "1" || !process.env.RESEND_API_KEY;
  const code = test ? "123456" : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const sent = await (channel === "phone" ? sendSms(store, target, code) : sendMail(store, target, code)).catch(() => false);
  if (!sent) return { ok: false, error: "Couldn't send the code. Please try again." };
  await db.insert(customerOtps).values({ id, storeId: store.id, channel, target, codeHash: hashCode(id, code), ip: ip ?? null, expiresAt: new Date(Date.now() + TTL_MS) });
  if (channel === "phone") await chargeUsage(store.id, "otp", id, `Login OTP to +91 ${target.slice(0, 2)}xxxxxx${target.slice(-2)}`).catch(() => {});
  return { ok: true, resendIn: RESEND_MS / 1000 };
}

export async function checkCode(store: Store, channel: Channel, target: string, code: string, widgetToken?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (channel === "phone" && otpMode(await messaging()) === "widget") {
    if (!widgetToken) return { ok: false, error: "Enter the code we sent you" };
    const phone = await verifyWidgetToken(widgetToken);
    if (!phone) return { ok: false, error: "Couldn't confirm the code. Please try again." };
    return phone === target ? { ok: true } : { ok: false, error: "The code was for a different number." };
  }
  const [row] = await db.select().from(customerOtps).where(and(eq(customerOtps.storeId, store.id), eq(customerOtps.target, target))).orderBy(desc(customerOtps.createdAt)).limit(1);
  if (!row) return { ok: false, error: "Ask for a code first" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong tries. Ask for a new code." };
  if (row.verifiedAt) return { ok: false, error: "This code was already used. Ask for a new one." };
  if (row.expiresAt < new Date()) return { ok: false, error: "This code has expired. Ask for a new one." };
  const good = crypto.timingSafeEqual(Buffer.from(hashCode(row.id, code.replace(/\D/g, ""))), Buffer.from(row.codeHash));
  await db.update(customerOtps).set(good ? { verifiedAt: new Date() } : { attempts: row.attempts + 1 }).where(eq(customerOtps.id, row.id));
  return good ? { ok: true } : { ok: false, error: "That code isn't right. Check and try again." };
}

// ---------- passwords ----------

export async function hashPw(pw: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scrypt(pw, salt, 64)).toString("hex")}`;
}
export async function checkPw(pw: string, stored: string | null) {
  if (!stored) return false;
  const [, s, k] = stored.split("$");
  if (!s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, "hex"), 64);
  const want = Buffer.from(k, "hex");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

// ---------- session (one signed cookie per store) ----------

const cookieFor = (storeId: number) => createCookie(`__gpc_${storeId}`, {
  httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400, secrets: [env.sessionSecret],
});

export async function currentCustomer(request: Request, store: Store): Promise<StoreCustomer | null> {
  const v = (await cookieFor(store.id).parse(request.headers.get("Cookie")).catch(() => null)) as { c?: number } | null;
  if (!v?.c) return null;
  const [c] = await db.select().from(storeCustomers).where(and(eq(storeCustomers.id, v.c), eq(storeCustomers.storeId, store.id))).limit(1);
  return c ?? null;
}

export async function loginCookie(store: Store, customerId: number) {
  await db.update(storeCustomers).set({ lastLoginAt: new Date() }).where(eq(storeCustomers.id, customerId));
  return cookieFor(store.id).serialize({ c: customerId });
}
export const logoutCookie = (store: Store) => cookieFor(store.id).serialize({}, { maxAge: 0 });

// ---------- customers ----------

export async function findCustomer(storeId: number, channel: Channel, target: string) {
  const [c] = await db.select().from(storeCustomers).where(and(eq(storeCustomers.storeId, storeId), channel === "phone" ? eq(storeCustomers.phone, target) : eq(storeCustomers.email, target))).limit(1);
  return c ?? null;
}

/** Details from the shopper's latest order on this store, to pre-fill a new account. */
export async function latestOrderDetails(storeId: number, channel: Channel, target: string) {
  const [o] = await db.select({ customer: orders.customer }).from(orders)
    .where(and(eq(orders.storeId, storeId), inArray(orders.status, ["paid", "cod_placed"]), channel === "phone" ? sql`${orders.customer}->>'phone' = ${target}` : sql`lower(${orders.customer}->>'email') = ${target}`))
    .orderBy(desc(orders.createdAt)).limit(1);
  return o?.customer ?? null;
}

/** New account for a verified (or password) identifier, filled from the shopper's last order when there is one. */
export async function createCustomer(storeId: number, channel: Channel, target: string, verified: boolean, extra: Partial<StoreCustomer> = {}) {
  const prev = await latestOrderDetails(storeId, channel, target);
  const values = {
    storeId,
    firstName: extra.firstName ?? prev?.firstName ?? "", lastName: extra.lastName ?? prev?.lastName ?? "",
    phone: channel === "phone" ? target : extra.phone ?? null,
    email: channel === "email" ? target : extra.email ?? null,
    phoneVerifiedAt: channel === "phone" && verified ? new Date() : null,
    emailVerifiedAt: channel === "email" && verified ? new Date() : null,
    passwordHash: extra.passwordHash ?? null,
    address: extra.address ?? (prev ? { address1: prev.address1, address2: prev.address2 ?? "", landmark: "", city: prev.city, state: prev.state, pincode: prev.pincode } : null),
  };
  const [c] = await db.insert(storeCustomers).values(values).onConflictDoNothing().returning();
  return c ?? (await findCustomer(storeId, channel, target));
}

export async function markVerified(c: StoreCustomer, channel: Channel) {
  await db.update(storeCustomers).set(channel === "phone" ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }).where(eq(storeCustomers.id, c.id));
}

/** Which details the store asks for that this shopper hasn't given yet. */
export function missingFields(store: Store, c: StoreCustomer) {
  const s = accountSettings(store.accountSettings);
  const miss: string[] = [];
  if (s.name !== "none" && s.nameRequired && !c.firstName) miss.push("name");
  if (s.name === "full" && s.nameRequired && !c.lastName) miss.push("name");
  if (s.phone === "required" && !c.phone) miss.push("phone");
  if (s.phone === "required" && s.phoneVerify && c.phone && !c.phoneVerifiedAt) miss.push("phone");
  if (s.email === "required" && !c.email) miss.push("email");
  if (s.email === "required" && s.emailVerify && c.email && !c.emailVerifiedAt) miss.push("email");
  if (s.address === "required" && !c.address?.address1) miss.push("address");
  return [...new Set(miss)];
}

// ---------- the shopper's orders ----------

const SHOWN = ["paid", "cod_placed", "refunded"];

/** Orders this shopper placed, matched only by a phone / email they proved is theirs. */
export async function customerOrders(store: Store, c: StoreCustomer, limit = 50) {
  const by = [] as ReturnType<typeof sql>[];
  if (c.phone && c.phoneVerifiedAt) by.push(sql`${orders.customer}->>'phone' = ${c.phone}`);
  if (c.email && c.emailVerifiedAt) by.push(sql`lower(${orders.customer}->>'email') = ${c.email}`);
  if (!by.length) return [];
  return db.select().from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.status, SHOWN), or(...by))).orderBy(desc(orders.createdAt)).limit(limit);
}

export async function customerOrder(store: Store, c: StoreCustomer, orderId: string) {
  const list = await customerOrders(store, c, 500);
  return list.find((o) => o.id === orderId) ?? null;
}

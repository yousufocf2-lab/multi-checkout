// OTP for store owner signup and login: SMS through MSG91 (platform account), email through Resend.
import { and, desc, eq, gt } from "drizzle-orm";
import crypto from "node:crypto";
import { db, ownerOtps } from "~/db.server";
import { env } from "./env.server";
import { messaging, otpMode, otpReady, verifyWidgetToken, widgetPublic } from "./rto.server";

export type Channel = "phone" | "email";
export type Purpose = "signup" | "login" | "reset" | "verify";

const TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 30_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_SENDS_PER_IP_HOUR = 20;
const MAX_ATTEMPTS = 5;
const VERIFIED_VALID_MS = 15 * 60_000;

const hashCode = (id: string, code: string) => crypto.createHmac("sha256", env.sessionSecret).update(`owner:${id}:${code}`).digest("hex");

/** "9876543210" / "you@brand.com" → which channel it is, normalised. */
export function parseContact(raw: string): { channel: Channel; target: string } | null {
  const v = raw.trim();
  if (v.includes("@")) {
    const e = v.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { channel: "email", target: e } : null;
  }
  const d = v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? { channel: "phone", target: d } : null;
}

export const showContact = (c: { channel: Channel; target: string }) => (c.channel === "phone" ? `+91 ${c.target}` : c.target);

const emailTestMode = () => process.env.RESEND_API_KEY === "test" || (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production");

/** Whether we can send OTPs on this channel right now. */
export async function channelReady(channel: Channel) {
  if (channel === "email") return Boolean(process.env.RESEND_API_KEY) || emailTestMode();
  return otpReady(await messaging());
}

/** MSG91 widget config for the browser when SMS OTPs go through the widget (no DLT), else null. */
export async function ownerWidget(c: { channel: Channel } | null) {
  return c?.channel === "phone" ? widgetPublic(await messaging()) : null;
}

async function sendSms(phone: string, code: string) {
  const m = await messaging();
  if (m.msg91AuthKey === "test") return true;
  if (!otpReady(m)) return false;
  const u = new URL("https://control.msg91.com/api/v5/otp");
  u.searchParams.set("template_id", m.msg91TemplateId!);
  u.searchParams.set("mobile", `91${phone}`);
  u.searchParams.set("otp", code);
  u.searchParams.set("otp_expiry", "10");
  const res = await fetch(u, { method: "POST", headers: { authkey: m.msg91AuthKey!, "Content-Type": "application/json" }, body: JSON.stringify({ store: "Growpefy" }), signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
  if (!res.ok || body.type !== "success") { console.error("[owner-otp] msg91:", res.status, body.message); return false; }
  return true;
}

async function sendEmail(to: string, code: string) {
  if (emailTestMode()) { console.log(`[owner-otp] test mode, code for ${to}: ${code}`); return true; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Growpefy <no-reply@growpefy.com>",
      to: [to],
      subject: `${code} is your Growpefy code`,
      text: `Your Growpefy verification code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px"><p style="font-size:15px;color:#333">Your Growpefy verification code</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:8px 0 16px">${code}</p><p style="font-size:13px;color:#777">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) { console.error("[owner-otp] resend:", res.status, await res.text().catch(() => "")); return false; }
  return true;
}

export async function sendOwnerOtp(c: { channel: Channel; target: string }, purpose: Purpose, ip?: string): Promise<{ ok: true; resendIn: number } | { ok: false; error: string; resendIn?: number }> {
  if (!(await channelReady(c.channel))) {
    return { ok: false, error: c.channel === "phone" ? "SMS codes aren't available right now. Use your email instead." : "Email codes aren't available right now. Use your mobile number instead." };
  }
  const hourAgo = new Date(Date.now() - 3600_000);
  const recent = await db.select({ createdAt: ownerOtps.createdAt }).from(ownerOtps)
    .where(and(eq(ownerOtps.target, c.target), gt(ownerOtps.createdAt, hourAgo))).orderBy(desc(ownerOtps.createdAt));
  if (recent.length >= MAX_SENDS_PER_HOUR) return { ok: false, error: "Too many codes requested. Try again in an hour." };
  const wait = recent[0] ? RESEND_AFTER_MS - (Date.now() - recent[0].createdAt.getTime()) : 0;
  if (wait > 0) return { ok: false, error: "Please wait before asking for a new code", resendIn: Math.ceil(wait / 1000) };
  if (ip) {
    const byIp = await db.select({ id: ownerOtps.id }).from(ownerOtps).where(and(eq(ownerOtps.ip, ip), gt(ownerOtps.createdAt, hourAgo))).limit(MAX_SENDS_PER_IP_HOUR);
    if (byIp.length >= MAX_SENDS_PER_IP_HOUR) return { ok: false, error: "Too many codes requested from this network. Try again later." };
  }

  // Widget mode: the browser sends the SMS through MSG91's widget; nothing to send from here
  if (c.channel === "phone" && otpMode(await messaging()) === "widget") return { ok: true, resendIn: RESEND_AFTER_MS / 1000 };
  const test = c.channel === "phone" ? (await messaging()).msg91AuthKey === "test" : emailTestMode();
  const code = test ? "123456" : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const sent = await (c.channel === "phone" ? sendSms(c.target, code) : sendEmail(c.target, code)).catch((e) => {
    console.error("[owner-otp]", e instanceof Error ? e.message : e);
    return false;
  });
  if (!sent) return { ok: false, error: "Couldn't send the code. Please try again." };
  const id = crypto.randomUUID();
  await db.insert(ownerOtps).values({ id, channel: c.channel, target: c.target, purpose, codeHash: hashCode(id, code), ip: ip ?? null, expiresAt: new Date(Date.now() + TTL_MS) });
  return { ok: true, resendIn: RESEND_AFTER_MS / 1000 };
}

export async function verifyOwnerOtp(c: { channel: Channel; target: string }, purpose: Purpose, code: string, widgetToken?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (c.channel === "phone" && otpMode(await messaging()) === "widget") {
    if (!widgetToken) return { ok: false, error: "Enter the code we sent you" };
    const phone = await verifyWidgetToken(widgetToken);
    if (!phone) return { ok: false, error: "Couldn't confirm the code. Please try again." };
    return phone === c.target ? { ok: true } : { ok: false, error: "The code was for a different number." };
  }
  const [row] = await db.select().from(ownerOtps)
    .where(and(eq(ownerOtps.target, c.target), eq(ownerOtps.purpose, purpose)))
    .orderBy(desc(ownerOtps.createdAt)).limit(1);
  if (!row) return { ok: false, error: "Ask for a code first" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong tries. Ask for a new code." };
  const good = crypto.timingSafeEqual(Buffer.from(hashCode(row.id, code.replace(/\D/g, ""))), Buffer.from(row.codeHash));
  // A used code still needs the right digits, and only works for a short while (double submits)
  if (row.verifiedAt) {
    if (good && row.verifiedAt.getTime() > Date.now() - VERIFIED_VALID_MS) return { ok: true };
    if (!good) await db.update(ownerOtps).set({ attempts: row.attempts + 1 }).where(eq(ownerOtps.id, row.id));
    return { ok: false, error: good ? "This code was already used. Ask for a new one." : "That code isn't right. Check and try again." };
  }
  if (row.expiresAt < new Date()) return { ok: false, error: "This code has expired. Ask for a new one." };
  await db.update(ownerOtps).set(good ? { verifiedAt: new Date() } : { attempts: row.attempts + 1 }).where(eq(ownerOtps.id, row.id));
  return good ? { ok: true } : { ok: false, error: "That code isn't right. Check and try again." };
}

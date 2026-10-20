import { and, count, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import crypto from "node:crypto";
import { blockedCustomers, checkoutOtps, db, orders, walletTransactions, type MessagingSettings, type Order, type Store } from "~/db.server";
import { BLOCK_KINDS, normValue, type BlockKind } from "./blocklist";
import { env } from "./env.server";
import { formatINR } from "./pricing";
import { chargeUsage, getPlatform, getWallet } from "./wallet.server";

// ---------------- providers (platform level; Growpefy pays them and bills the wallet) ----------------

export async function messaging(): Promise<MessagingSettings> {
  const p = await getPlatform();
  const m = p.messaging ?? {};
  return {
    msg91AuthKey: m.msg91AuthKey || process.env.MSG91_AUTH_KEY || undefined,
    msg91TemplateId: m.msg91TemplateId || process.env.MSG91_OTP_TEMPLATE_ID || undefined,
    msg91WidgetId: m.msg91WidgetId || process.env.MSG91_WIDGET_ID || undefined,
    msg91TokenAuth: m.msg91TokenAuth || process.env.MSG91_TOKEN_AUTH || undefined,
    waPhoneNumberId: m.waPhoneNumberId || process.env.WA_PHONE_NUMBER_ID || undefined,
    waToken: m.waToken || process.env.WA_ACCESS_TOKEN || undefined,
    waTemplate: m.waTemplate || process.env.WA_CONFIRM_TEMPLATE || undefined,
    waLang: m.waLang || "en",
  };
}
/**
 * How OTPs go out: "api" = our own code via a DLT template (Auth key + Template ID);
 * "widget" = MSG91 OTP Widget (Widget ID + Token auth, no DLT needed), verified server-side with the Auth key.
 * A Template ID wins when both are set.
 */
export function otpMode(m: MessagingSettings): "api" | "widget" | null {
  if (m.msg91AuthKey && m.msg91TemplateId) return "api";
  if (m.msg91AuthKey && m.msg91WidgetId && m.msg91TokenAuth) return "widget";
  return null;
}
export const otpReady = (m: MessagingSettings) => otpMode(m) !== null;
/** What the browser needs to run the MSG91 widget (both values are meant to be public). */
export function widgetPublic(m: MessagingSettings) {
  return otpMode(m) === "widget" ? { widgetId: m.msg91WidgetId!, tokenAuth: m.msg91TokenAuth! } : null;
}

/**
 * Checks a widget access token with MSG91 and returns the 10-digit mobile it was issued for, or null.
 * Fails closed: if MSG91 doesn't tell us the number, the token is not accepted.
 * Test widget (ID "test"): tokens look like "test:9876543210".
 */
export async function verifyWidgetToken(token: string): Promise<string | null> {
  const m = await messaging();
  if (otpMode(m) !== "widget" || !token) return null;
  if (m.msg91WidgetId === "test") { const t = /^test:([6-9]\d{9})$/.exec(token); return t ? t[1] : null; }
  try {
    const res = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ authkey: m.msg91AuthKey, "access-token": token }), signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || String(body.type ?? "").toLowerCase() !== "success") {
      console.error("[otp] widget verify:", res.status, body.message);
      return null;
    }
    // The verified number comes back in "message" (or a data field on some accounts)
    const strings: string[] = [];
    const walk = (v: unknown) => { if (typeof v === "string" || typeof v === "number") strings.push(String(v)); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
    walk(body);
    for (const s of strings) { const d = s.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, ""); if (/^[6-9]\d{9}$/.test(d)) return d; }
    console.error("[otp] widget verify: success but no mobile number in response");
    return null;
  } catch (e) {
    console.error("[otp] widget verify:", e instanceof Error ? e.message : e);
    return null;
  }
}
export const waReady = (m: MessagingSettings) => Boolean(m.waPhoneNumberId && m.waToken && m.waTemplate);
/** "test" as the MSG91 key: no SMS is sent and the code is always 123456 (for trying the flow). */
const otpTestMode = (m: MessagingSettings) => m.msg91AuthKey === "test";

// ---------------- block list ----------------

export type BlockInput = { phone?: string; email?: string; pincode?: string; city?: string; state?: string; country?: string };
export type BlockHit = { kind: BlockKind; scope: "cod" | "all" };

/** Is this customer on the store's block list? scope "cod" = only COD is closed, "all" = can't order. */
export async function blockFor(store: Store, input: BlockInput): Promise<BlockHit | null> {
  if (!store.blockEnabled) return null;
  const country = input.country || "IN";
  const pairs = BLOCK_KINDS.map((k) => [k, normValue(k, k === "country" ? country : input[k] ?? "", { country })] as const)
    .filter((p): p is readonly [BlockKind, string] => Boolean(p[1]));
  if (!pairs.length) return null;
  const [hit] = await db.select({ kind: blockedCustomers.kind }).from(blockedCustomers)
    .where(and(eq(blockedCustomers.storeId, store.id), or(...pairs.map(([k, v]) => and(eq(blockedCustomers.kind, k), eq(blockedCustomers.value, v))))))
    .limit(1);
  return hit ? { kind: hit.kind as BlockKind, scope: store.blockCodOnly ? "cod" : "all" } : null;
}

export const BLOCK_MESSAGE = {
  cod: "Cash on Delivery isn't available for these delivery details. You can pay online.",
  all: "We can't take an order with these details. Please contact the store for help.",
};

/** Adds values to the block list (normalised, duplicates ignored). Returns how many were new. */
export async function addBlocks(storeId: number, entries: { kind: BlockKind; value: string }[], source: "manual" | "csv") {
  let added = 0;
  for (let i = 0; i < entries.length; i += 1000) {
    const chunk = entries.slice(i, i + 1000).map((e) => ({ storeId, kind: e.kind, value: e.value, source }));
    if (!chunk.length) continue;
    const rows = await db.insert(blockedCustomers).values(chunk).onConflictDoNothing().returning({ id: blockedCustomers.id });
    added += rows.length;
  }
  return added;
}

// ---------------- OTP ----------------

const OTP_TTL_MS = 10 * 60_000;
const OTP_VALID_FOR_ORDER_MS = 30 * 60_000;
const RESEND_AFTER_MS = 30_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const hashCode = (id: string, code: string) => crypto.createHmac("sha256", env.sessionSecret).update(`${id}:${code}`).digest("hex");

export async function otpRequired(store: Store, method: "prepaid" | "cod") {
  if (!store.otpEnabled || !(method === "cod" ? store.otpCod : store.otpPrepaid)) return false;
  return otpReady(await messaging());
}

export async function otpVerified(sessionId: string, phone: string) {
  const [row] = await db.select({ id: checkoutOtps.id }).from(checkoutOtps)
    .where(and(eq(checkoutOtps.sessionId, sessionId), eq(checkoutOtps.phone, phone), isNotNull(checkoutOtps.verifiedAt), gt(checkoutOtps.verifiedAt, new Date(Date.now() - OTP_VALID_FOR_ORDER_MS))))
    .limit(1);
  return Boolean(row);
}

export async function sendOtp(store: Store, sessionId: string, phone: string): Promise<{ ok: true; resendIn: number } | { ok: false; error: string; resendIn?: number }> {
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: "Enter a valid 10-digit mobile number" };
  const m = await messaging();
  if (!otpReady(m)) return { ok: false, error: "OTP service isn't available right now" };
  if (otpMode(m) === "widget") return { ok: false, error: "Please refresh the page and try again" }; // the browser sends widget OTPs

  const recent = await db.select({ createdAt: checkoutOtps.createdAt }).from(checkoutOtps)
    .where(and(eq(checkoutOtps.sessionId, sessionId), gt(checkoutOtps.createdAt, new Date(Date.now() - 3600_000))))
    .orderBy(desc(checkoutOtps.createdAt));
  if (recent.length >= MAX_SENDS_PER_HOUR) return { ok: false, error: "Too many OTP requests. Please try again in a while." };
  const wait = recent[0] ? RESEND_AFTER_MS - (Date.now() - recent[0].createdAt.getTime()) : 0;
  if (wait > 0) return { ok: false, error: "Please wait before requesting a new OTP", resendIn: Math.ceil(wait / 1000) };

  const id = crypto.randomUUID();
  const code = otpTestMode(m) ? "123456" : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  if (!otpTestMode(m)) {
    try {
      const u = new URL("https://control.msg91.com/api/v5/otp");
      u.searchParams.set("template_id", m.msg91TemplateId!);
      u.searchParams.set("mobile", `91${phone}`);
      u.searchParams.set("otp", code);
      u.searchParams.set("otp_expiry", "10");
      const res = await fetch(u, { method: "POST", headers: { authkey: m.msg91AuthKey!, "Content-Type": "application/json" }, body: JSON.stringify({ store: store.name.slice(0, 30) }), signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
      if (!res.ok || body.type !== "success") {
        console.error("[otp] msg91:", res.status, body.message);
        return { ok: false, error: "Couldn't send the OTP. Please try again." };
      }
    } catch (e) {
      console.error("[otp] msg91:", e instanceof Error ? e.message : e);
      return { ok: false, error: "Couldn't send the OTP. Please try again." };
    }
  }
  await db.insert(checkoutOtps).values({ id, storeId: store.id, sessionId, phone, codeHash: hashCode(id, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
  // ₹ per OTP from the store's wallet, only after the provider accepted it
  await chargeUsage(store.id, "otp", id, `OTP to +91 ${phone.slice(0, 2)}xxxxxx${phone.slice(-2)}`).catch((e) => console.error("[otp] charge:", e));
  return { ok: true, resendIn: RESEND_AFTER_MS / 1000 };
}

/** Widget mode: the browser verified the OTP with MSG91; we confirm the token and mark this session's phone verified. */
export async function verifyWidgetOtp(store: Store, sessionId: string, phone: string, token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: "Enter a valid 10-digit mobile number" };
  const recent = await db.select({ id: checkoutOtps.id }).from(checkoutOtps)
    .where(and(eq(checkoutOtps.sessionId, sessionId), gt(checkoutOtps.createdAt, new Date(Date.now() - 3600_000)))).limit(MAX_SENDS_PER_HOUR + 1);
  if (recent.length > MAX_SENDS_PER_HOUR) return { ok: false, error: "Too many OTP requests. Please try again in a while." };
  const verified = await verifyWidgetToken(token);
  if (!verified) return { ok: false, error: "Couldn't confirm the OTP. Please try again." };
  if (verified !== phone) return { ok: false, error: "The OTP was for a different number." };
  const id = crypto.randomUUID();
  await db.insert(checkoutOtps).values({ id, storeId: store.id, sessionId, phone, codeHash: hashCode(id, crypto.randomUUID()), expiresAt: new Date(Date.now() + OTP_TTL_MS), verifiedAt: new Date() });
  await chargeUsage(store.id, "otp", id, `OTP to +91 ${phone.slice(0, 2)}xxxxxx${phone.slice(-2)}`).catch((e) => console.error("[otp] charge:", e));
  return { ok: true };
}

export async function verifyOtp(sessionId: string, phone: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db.select().from(checkoutOtps)
    .where(and(eq(checkoutOtps.sessionId, sessionId), eq(checkoutOtps.phone, phone)))
    .orderBy(desc(checkoutOtps.createdAt)).limit(1);
  if (!row) return { ok: false, error: "Request an OTP first" };
  if (row.verifiedAt) return { ok: true };
  if (row.expiresAt < new Date()) return { ok: false, error: "This OTP has expired. Request a new one." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many wrong attempts. Request a new OTP." };
  const good = crypto.timingSafeEqual(Buffer.from(hashCode(row.id, code.replace(/\D/g, ""))), Buffer.from(row.codeHash));
  await db.update(checkoutOtps).set(good ? { verifiedAt: new Date() } : { attempts: row.attempts + 1 }).where(eq(checkoutOtps.id, row.id));
  return good ? { ok: true } : { ok: false, error: "That OTP isn't right. Check and try again." };
}

// ---------------- WhatsApp order confirmation ----------------

/** Sends the order confirmation on WhatsApp if the store turned it on for this payment method. Never throws. */
export async function sendOrderConfirmation(store: Store, order: Order) {
  try {
    if (!store.confirmEnabled || !store.confirmWhatsapp) return;
    if (!(order.paymentMethod === "cod" ? store.confirmWaCod : store.confirmWaPrepaid)) return;
    if (order.status !== "paid" && order.status !== "cod_placed") return;
    const phone = order.customer.phone;
    if (!/^[6-9]\d{9}$/.test(phone)) return;
    const m = await messaging();
    if (!waReady(m)) return;
    // Once per order: the ledger entry is the record that it was sent
    const w = await getWallet(store.id);
    const [done] = await db.select({ id: walletTransactions.id }).from(walletTransactions)
      .where(and(eq(walletTransactions.walletId, w.id), eq(walletTransactions.type, "wa_confirm"), eq(walletTransactions.refId, `order:${order.id}`))).limit(1);
    if (done) return;

    const res = await fetch(`https://graph.facebook.com/v21.0/${m.waPhoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${m.waToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: `91${phone}`, type: "template",
        template: {
          name: m.waTemplate, language: { code: m.waLang || "en" },
          components: [{ type: "body", parameters: [
            { type: "text", text: order.customer.firstName || "there" },
            { type: "text", text: store.name },
            { type: "text", text: order.shopifyOrderName || order.id.slice(0, 10).toUpperCase() },
            { type: "text", text: formatINR(order.total) },
            { type: "text", text: order.paymentMethod === "cod" ? "Cash on Delivery" : "Paid online" },
          ] }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !body.messages?.length) {
      console.error(`[whatsapp] order ${order.id}:`, res.status, body.error?.message);
      return;
    }
    await chargeUsage(store.id, "wa_confirm", `order:${order.id}`, `Order confirmation · ${order.shopifyOrderName ?? order.id.slice(0, 10)}`);
  } catch (e) {
    console.error(`[whatsapp] order ${order.id}:`, e instanceof Error ? e.message : e);
  }
}

// ---------------- stats ----------------

/** Completed orders (paid + COD placed). Call confirmation unlocks at 100. */
export async function completedOrders(storeId: number) {
  const [r] = await db.select({ n: count() }).from(orders).where(and(eq(orders.storeId, storeId), inArray(orders.status, ["paid", "cod_placed"])));
  return Number(r?.n ?? 0);
}
export { CALL_UNLOCK_ORDERS } from "./blocklist";

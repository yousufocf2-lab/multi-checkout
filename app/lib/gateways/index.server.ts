// Payment gateways: up to 3 per store, tried in order.
//  - Fallback 1: if the primary can't start a payment (down, bad keys, timeout), the next one starts it.
//  - Fallback 2: if the customer's payment fails, "Try again" opens the next gateway.
// Every result is confirmed with the gateway server to server (or by its signed return) before an order is marked paid.
import { and, eq, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db, orders, stores, type Order, type PayAttempt, type Store, type StoreGateway } from "~/db.server";
import { env } from "../env.server";
import { finalizeOrder, logPaymentEvent } from "../orders.server";
import { payNowPaise } from "../payment-methods";
import { formatINR } from "../pricing";
import { storeBaseUrl } from "../urls.server";
import { MAX_GATEWAYS, gatewayById } from "./catalog";
import { cashfree } from "./cashfree.server";
import { ccavenue } from "./ccavenue.server";
import { easebuzz } from "./easebuzz.server";
import { payu } from "./payu.server";
import { paytm } from "./paytm.server";
import { phonepe } from "./phonepe.server";
import { razorpay } from "./razorpay.server";
import type { GatewayAdapter, StartResult, Verification } from "./types";

export const ADAPTERS: Record<string, GatewayAdapter> = { payu, cashfree, razorpay, phonepe, easebuzz, paytm, ccavenue };

/** Path on the store's website that Shopify forwards to Growpefy (App Proxy: prefix "apps", subpath "growpefy"). */
export const PROXY_PATH = "/apps/growpefy";
export const proxyBase = (store: Pick<Store, "storefrontUrl">) => `${store.storefrontUrl.replace(/\/+$/, "")}${PROXY_PATH}`;

/** The store's gateways in priority order (stores from before gateways existed use their PayU keys). */
export function storeGateways(store: Pick<Store, "gateways" | "payuKey" | "payuSalt" | "payuMode">): StoreGateway[] {
  const list = (store.gateways ?? []).filter((g) => ADAPTERS[g.id]).slice(0, MAX_GATEWAYS);
  if (list.length) return list;
  if (store.payuKey && store.payuSalt) return [{ id: "payu", mode: store.payuMode === "live" ? "live" : "test", on: true, creds: { key: store.payuKey, salt: store.payuSalt } }];
  return [];
}

export const isConfigured = (g: StoreGateway) => {
  const info = gatewayById(g.id);
  return Boolean(info && info.fields.every((f) => f.optional || (g.creds[f.name] ?? "").trim()));
};

/** Gateways that can take payments right now, in order. */
export const activeGateways = (store: Parameters<typeof storeGateways>[0]) => storeGateways(store).filter((g) => g.on && isConfigured(g));
export const onlineReady = (store: Parameters<typeof storeGateways>[0]) => activeGateways(store).length > 0;
export const primaryGatewayName = (store: Parameters<typeof storeGateways>[0]) => gatewayById(activeGateways(store)[0]?.id)?.short ?? null;

/** Where the customer goes to pay: the store's own website when that's switched on, else the checkout domain. */
export const payUrl = (store: Pick<Store, "storefrontUrl" | "payuViaStorefront">, orderId: string, retry = false) =>
  `${store.payuViaStorefront ? `${proxyBase(store)}/pay/${orderId}` : `/pay/${orderId}`}${retry ? "?retry=1" : ""}`;

/** Each try gets its own id; the first try uses the order id (max 22 chars, fits every gateway). */
const newTxn = (order: Order) => (order.payAttempts.length ? `${order.id}N${crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5)}` : order.id);

export async function orderByTxn(txn: string) {
  const [row] = await db.select({ order: orders, store: stores }).from(orders).innerJoin(stores, eq(orders.storeId, stores.id))
    .where(or(eq(orders.id, txn), sql`${orders.payAttempts} @> ${JSON.stringify([{ txn }])}::jsonb`)).limit(1);
  return row ?? null;
}

// ---------------- starting a payment ----------------

export type StartOutcome = { ok: true; result: StartResult; gateway: StoreGateway; txn: string } | { ok: false; error: string };

/**
 * Starts a payment on the first gateway that works. With retry, starts from the gateway after the last one used.
 * `base` is where the customer comes back (the checkout domain, or the store's website through App Proxy).
 */
export async function startPayment(store: Store, order: Order, base: string, opts: { retry?: boolean } = {}): Promise<StartOutcome> {
  const list = activeGateways(store);
  if (!list.length) return { ok: false, error: "Online payment isn't set up for this store." };
  let from = 0;
  if (opts.retry && order.gateway) {
    const i = list.findIndex((g) => g.id === order.gateway);
    from = i >= 0 ? (i + 1) % list.length : 0;
  }
  const errors: string[] = [];
  let current = order;
  for (let k = 0; k < list.length; k++) {
    const g = list[(from + k) % list.length];
    const txn = newTxn(current);
    const returnUrl = `${base}/pg/${g.id}/return?t=${encodeURIComponent(txn)}`;
    const notifyUrl = `${env.appUrl}/pg/${g.id}/webhook`;
    try {
      const result = await ADAPTERS[g.id].start({ store, order: current, cfg: g, txn, amountPaise: payNowPaise(current), returnUrl, notifyUrl });
      const attempt: PayAttempt = { g: g.id, txn, ref: result.ref ?? null, at: new Date().toISOString() };
      const [u] = await db.update(orders).set({
        gateway: g.id, payAttempts: sql`${orders.payAttempts} || ${JSON.stringify([attempt])}::jsonb`, updatedAt: new Date(),
      }).where(eq(orders.id, order.id)).returning();
      if (u) current = u;
      await logPaymentEvent({ storeId: store.id, orderId: order.id, source: g.id, kind: "start", status: k ? "fallback" : "ok", payload: { txn, gateway: g.id } });
      return { ok: true, result, gateway: g, txn };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${g.id}: ${msg}`);
      console.error(`[pay] ${g.id} couldn't start ${order.id}:`, msg);
      await logPaymentEvent({ storeId: store.id, orderId: order.id, source: g.id, kind: "start", status: "failed", payload: { txn, error: msg.slice(0, 500) } });
    }
  }
  return { ok: false, error: "We couldn't open the payment page right now. Please try again in a minute." };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The "Opening secure payment" page that hands the customer to the gateway. Plain HTML (also served through App Proxy). */
export function payPage(store: Store, order: Order, out: StartOutcome, backUrl: string) {
  const color = /^#[0-9a-f]{6}$/i.test(store.primaryColor) ? store.primaryColor : "#111827";
  const amount = payNowPaise(order);
  const rest = order.paymentMethod === "partial" ? order.total - amount : 0;
  const head = store.logoUrl ? `<img class="l" src="${esc(store.logoUrl)}" alt="${esc(store.name)}">` : `<div class="n">${esc(store.name)}</div>`;
  let body = "";
  if (!out.ok) {
    body = `<div class="n">Payment couldn't start</div><p>${esc(out.error)}</p><p><a class="b" href="${esc(backUrl)}">Back to checkout</a></p>`;
  } else {
    const r = out.result;
    const by = gatewayById(out.gateway.id)?.short ?? "our payment partner";
    body = `<div class="s" role="status" aria-label="Opening payment"></div><div class="n">Opening secure payment for ${esc(formatINR(amount))}</div>
${rest > 0 ? `<p>Advance now. The remaining ${esc(formatINR(rest))} is paid in cash on delivery.</p>` : ""}<p>Don't close this page or press back.</p>`;
    if (r.type === "form") {
      body += `<form id="f" method="post" action="${esc(r.action)}">${Object.entries(r.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join("")}<noscript><button class="b">Continue to payment</button></noscript></form><script>document.getElementById("f").submit()</script>`;
    } else if (r.type === "redirect") {
      body += `<p><a class="b" id="go" href="${esc(r.url)}">Continue to payment</a></p><script>location.replace(${JSON.stringify(r.url)})</script>`;
    } else {
      body += `<script src="${esc(r.src)}"></script><script>window.addEventListener("load",function(){try{${r.code}}catch(e){document.getElementById("e").style.display="block"}})</script>
<p id="e" style="display:none">The payment window didn't open. <a href="${esc(backUrl)}">Back to checkout</a></p>`;
    }
    body += `<p class="t"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> Processed securely by ${esc(by)}</p>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Opening secure payment</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#1c2430;text-align:center;padding:24px}
.s{width:44px;height:44px;border-radius:50%;border:4px solid #e5e7eb;border-top-color:${color};animation:r .8s linear infinite;margin:20px auto}@keyframes r{to{transform:rotate(360deg)}}
.l{max-height:40px;max-width:160px;object-fit:contain}.n{font-size:17px;font-weight:600}p{margin:6px 0;color:#4a5361;font-size:14px}.t{margin-top:18px;font-size:12px;color:#8a93a1;display:flex;gap:6px;align-items:center;justify-content:center}
.b{display:inline-block;background:${color};color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;text-decoration:none;margin-top:10px}</style></head>
<body>${head}${body}</body></html>`;
}

export const htmlResponse = (html: string) => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

// ---------------- results ----------------

/** Marks the order paid once the gateway confirmed the money. Safe to call many times. */
async function markPaid(store: Store, order: Order, gatewayId: string, txn: string, v: Verification, source: string) {
  const due = payNowPaise(order);
  if (v.amountPaise != null && v.amountPaise !== due) {
    await db.update(orders).set({ error: `${gatewayById(gatewayId)?.short ?? gatewayId} amount ${v.amountPaise} doesn't match the amount due ${due}`, updatedAt: new Date() }).where(eq(orders.id, order.id));
    await logPaymentEvent({ storeId: store.id, orderId: order.id, source, kind: "payment", status: "amount_mismatch", payload: { txn, v: v.raw } as Record<string, unknown> });
    return order;
  }
  const debited = v.debitedPaise ?? due;
  return finalizeOrder(store, order, {
    status: "paid", amountPaid: debited, bankDiscount: Math.max(0, due - debited),
    gateway: gatewayId, gatewayRef: v.ref, payuMihpayid: gatewayId === "payu" ? v.ref : order.payuMihpayid, error: null,
  });
}

async function markFailed(order: Order, reason: string) {
  const [u] = await db.update(orders).set({ status: "failed", error: reason.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending_payment"))).returning();
  return u ?? order;
}

/** Customer came back from the gateway (GET or POST). Returns the order to show. */
export async function handleReturn(gatewayId: string, txn: string, params: Record<string, string>, source: string) {
  const row = txn ? await orderByTxn(txn) : null;
  if (!row) return null;
  const { store } = row;
  let { order } = row;
  await logPaymentEvent({ storeId: store.id, orderId: order.id, source: `${gatewayId}-${source}`, kind: "payment", status: params.status ?? params.STATUS ?? params.order_status ?? null, payload: params });
  if (order.status !== "pending_payment" && order.status !== "failed") return order;
  const cfg = storeGateways(store).find((g) => g.id === gatewayId);
  const adapter = ADAPTERS[gatewayId];
  if (!cfg || !adapter) return order;
  const attempt = order.payAttempts.find((a) => a.txn === txn);
  let v = adapter.fromReturn?.(cfg, params, txn) ?? null;
  if (!v || v.status !== "failure") {
    try { v = await adapter.verify(cfg, txn, attempt?.ref); } catch (e) { console.error(`[pay] verify ${gatewayId} ${txn}:`, e instanceof Error ? e.message : e); }
  }
  if (!v) return order;
  if (v.status === "success") order = await markPaid(store, order, gatewayId, txn, v, `${gatewayId}-${source}`);
  else if (v.status === "failure" || v.status === "not_found") order = await markFailed(order, `Payment didn't go through (${gatewayById(gatewayId)?.short ?? gatewayId})`);
  return order;
}

/** Asks the gateways about every try of an order (newest first). Used by the order page, webhooks and the dashboard. */
export async function syncOrderPayment(store: Store, order: Order, source: string): Promise<Order> {
  if (order.paymentMethod !== "prepaid" && order.paymentMethod !== "partial") return order;
  if (order.status !== "pending_payment" && order.status !== "failed") return order;
  const tries: PayAttempt[] = order.payAttempts.length ? [...order.payAttempts].reverse().slice(0, 5) : [{ g: "payu", txn: order.id, at: order.createdAt.toISOString() }];
  const gws = storeGateways(store);
  let latest: Verification["status"] | null = null;
  for (const t of tries) {
    const cfg = gws.find((g) => g.id === t.g);
    if (!cfg || !ADAPTERS[t.g]) continue;
    try {
      const v = await ADAPTERS[t.g].verify(cfg, t.txn, t.ref);
      await logPaymentEvent({ storeId: store.id, orderId: order.id, source: `${t.g}-${source}`, kind: "verify", status: v.status, payload: { txn: t.txn } });
      if (v.status === "success") return markPaid(store, order, t.g, t.txn, v, `${t.g}-${source}`);
      latest ??= v.status;
    } catch (e) {
      console.error(`[pay] sync ${t.g} ${t.txn}:`, e instanceof Error ? e.message : e);
      latest ??= "pending";
    }
  }
  if (latest === "failure" && order.status === "pending_payment") return markFailed(order, "Payment didn't go through");
  return order;
}

/** A gateway's webhook: find our transaction and re-check it with the gateway (the body itself is never trusted). */
export async function handleWebhook(gatewayId: string, body: Record<string, unknown>) {
  const adapter = ADAPTERS[gatewayId];
  const txn = adapter?.webhookTxn?.(body) ?? null;
  const row = txn ? await orderByTxn(txn) : null;
  await logPaymentEvent({ storeId: row?.store.id ?? null, orderId: row?.order.id ?? txn, source: "webhook", kind: `${gatewayId}-webhook`, status: null, payload: body });
  if (!row) return { matched: false };
  await syncOrderPayment(row.store, row.order, "webhook");
  return { matched: true };
}

/** Back to the checkout or order page on the store's own host. */
/** Thank-you page: on the store's domain when the order was placed there (App Proxy), else the store's Growpefy address. */
export const orderPageUrl = (store: Store, order: Order) =>
  order.tracking?.proxyOrigin ? `${order.tracking.proxyOrigin}${PROXY_PATH}/order/${order.id}` : `${storeBaseUrl(store)}/order/${order.id}`;



// The PayU payment step, shared by the checkout domain (/pay, /payu/callback) and the store's own
// website through Shopify App Proxy (/apps/growpefy/pay, /apps/growpefy/payu/callback).
import { and, eq, isNotNull } from "drizzle-orm";
import crypto from "node:crypto";
import { bankOffers, db, orders, type Order, type Store } from "~/db.server";
import { finalizeOrder, getOrderWithStore, logPaymentEvent } from "./orders.server";
import { payNowPaise } from "./payment-methods";
import { buildPayuParams, payuEndpoint, verifyPayuResponse } from "./payu.server";
import { rupeesToPaise } from "./pricing";

/** Path on the store's website that Shopify forwards to Growpefy (App Proxy: prefix "apps", subpath "growpefy"). */
export const PROXY_PATH = "/apps/growpefy";
export const proxyBase = (store: Pick<Store, "storefrontUrl">) => `${store.storefrontUrl.replace(/\/+$/, "")}${PROXY_PATH}`;

/** Where the customer goes to pay: the store's own website when that's switched on, else the checkout domain. */
export const payUrl = (store: Pick<Store, "storefrontUrl" | "payuViaStorefront">, orderId: string) =>
  store.payuViaStorefront ? `${proxyBase(store)}/pay/${orderId}` : `/pay/${orderId}`;

/** Fields for the auto-submitted PayU form. */
export async function payuForm(store: Store, order: Order, callbackUrl: string) {
  const offers = await db
    .select({ key: bankOffers.payuOfferKey })
    .from(bankOffers)
    .where(and(eq(bankOffers.storeId, store.id), eq(bankOffers.active, true), isNotNull(bankOffers.payuOfferKey)));
  const fields = buildPayuParams(store, order, { callbackUrl, offerKeys: offers.map((o) => o.key!).filter(Boolean) });
  return { action: payuEndpoint(store), fields };
}

/** PayU's post back (success or failure). Returns the order id, or null if it isn't ours. */
export async function handlePayuReturn(f: Record<string, string>, source: string): Promise<string | null> {
  const row = f.txnid ? await getOrderWithStore(f.txnid) : null;
  if (!row) return null;
  const { order, store } = row;
  await logPaymentEvent({ storeId: store.id, orderId: order.id, source, kind: "payment", status: f.status ?? null, payload: f });
  // Already handled (PayU can post twice / user refresh)
  if (order.status !== "pending_payment") return order.id;

  const hashOk = verifyPayuResponse(store, f);
  const amountOk = rupeesToPaise(f.amount) === payNowPaise(order);
  const success = hashOk && amountOk && f.status === "success" && f.key === store.payuKey;
  if (!success) {
    await db.update(orders).set({
      status: "failed", payuRaw: f, payuMihpayid: f.mihpayid ?? null,
      error: !hashOk ? "PayU hash mismatch" : !amountOk ? "Amount mismatch" : f.error_Message || f.field9 || f.status,
      updatedAt: new Date(),
    }).where(and(eq(orders.id, order.id), eq(orders.status, "pending_payment"))); // never overwrite a paid order
    return order.id;
  }
  // Bank offer: PayU debits less than `amount` when an offer_key was availed
  const debited = rupeesToPaise(f.net_amount_debit) ?? payNowPaise(order);
  await finalizeOrder(store, order, { status: "paid", payuRaw: f, payuMihpayid: f.mihpayid ?? null, amountPaid: debited, bankDiscount: Math.max(0, payNowPaise(order) - debited) });
  return order.id;
}

/**
 * Shopify signs every App Proxy request: all query params except `signature`, sorted, "key=value"
 * (repeated keys joined with ","), concatenated without separators, HMAC-SHA256 with the app's client secret.
 */
export function verifyProxySignature(url: URL, secret: string | null | undefined) {
  const sig = url.searchParams.get("signature");
  if (!sig || !secret) return false;
  const keys = [...new Set([...url.searchParams.keys()].filter((k) => k !== "signature"))].sort();
  const msg = keys.map((k) => `${k}=${url.searchParams.getAll(k).join(",")}`).join("");
  const expected = crypto.createHmac("sha256", secret.trim()).update(msg).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

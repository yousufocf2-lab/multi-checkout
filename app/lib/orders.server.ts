import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import crypto from "node:crypto";
import { db, orders, paymentEvents, stores, type Order, type Store } from "~/db.server";
import { fetchRefundedPaise } from "./payu.server";
import { recordOrderForCod } from "./cod.server";
import { incrementCouponUse } from "./coupons.server";
import { sendCapiPurchase } from "./meta.server";
import { uploadPurchase } from "./google-ads.server";
import { createStoreOrder } from "./platform.server";
import { sendOrderConfirmation } from "./rto.server";
import { chargeSaleFee, reverseSaleFee } from "./wallet.server";
import { saveOrderAddress } from "./addresses.server";
import { payNowPaise } from "./payment-methods";
import { chargeDropship, startDropshipWatcher } from "./dropship.server";

export function newOrderId() {
  // Short, unique, PayU-safe txnid
  return `CX${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function getOrderWithStore(id: string) {
  const [row] = await db
    .select({ order: orders, store: stores })
    .from(orders)
    .innerJoin(stores, eq(orders.storeId, stores.id))
    .where(eq(orders.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Pushes the order to Shopify once. Errors are saved on the order (retry from admin).
 * A short lock (shopify_push_at) makes sure two requests at the same moment can't both create it.
 */
export async function pushToShopify(store: Store, order: Order) {
  if (order.shopifyOrderId) return order;
  const [claimed] = await db.update(orders).set({ shopifyPushAt: new Date() })
    .where(and(
      eq(orders.id, order.id),
      isNull(orders.shopifyOrderId),
      or(isNull(orders.shopifyPushAt), lt(orders.shopifyPushAt, new Date(Date.now() - 2 * 60_000))),
    )).returning();
  if (!claimed) {
    // someone else is creating it (or already did)
    const [current] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
    return current ?? order;
  }
  try {
    const created = await createStoreOrder(store, claimed);
    const [updated] = await db
      .update(orders)
      .set({ shopifyOrderId: created.id, shopifyOrderName: created.name, error: null, shopifyPushAt: null, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    return updated;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shopify] order ${order.id} failed:`, msg);
    const [updated] = await db
      .update(orders)
      .set({ error: msg.slice(0, 2000), shopifyPushAt: null, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    return updated;
  }
}

/** Statuses an order can be finalised from. */
const OPEN_STATUSES = ["pending_payment", "failed", "cod_placing"];

/** Marks a successful order (paid / COD placed), counts coupon use, creates it in Shopify. */
export async function finalizeOrder(store: Store, order: Order, patch: Partial<Order>) {
  // Only one caller wins: PayU's return, its webhook and the order page can all arrive in the same second
  const [updated] = await db
    .update(orders)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), inArray(orders.status, OPEN_STATUSES)))
    .returning();
  if (!updated) {
    const [current] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
    return current ?? order;
  }
  await incrementCouponUse(store.id, updated.couponCode);
  await recordOrderForCod(store.id, updated.customer.phone, updated.paymentMethod === "prepaid" ? "prepaid" : "cod");
  // Platform sale fee from the store's wallet (idempotent per order; never blocks the customer)
  await chargeSaleFee(store, updated);
  // Address for faster checkout next time, on any store (only if the customer agreed)
  void saveOrderAddress(updated);
  void trackPurchase(store, updated);
  const pushed = await pushToShopify(store, updated);
  // Dropshipping stores (set by admin): prepaid orders pay product + shipping from the wallet
  if (store.dropshipEnabled) {
    await chargeDropship(store, pushed ?? updated);
    startDropshipWatcher();
  }
  // WhatsApp order confirmation (RTO Suite), after Shopify so it can quote the order number
  void sendOrderConfirmation(store, pushed ?? updated);
  return pushed;
}

/** Sends the purchase to Meta (CAPI) and Google Ads (click conversion upload), once each per order. Never blocks the customer. */
export async function trackPurchase(store: Store, order: Order) {
  await Promise.all([
    (async () => {
      if (order.capiSentAt) return;
      try {
        if (await sendCapiPurchase(store, order)) await db.update(orders).set({ capiSentAt: new Date() }).where(eq(orders.id, order.id));
      } catch (e) {
        console.error(`[capi] order ${order.id}:`, e instanceof Error ? e.message : e);
      }
    })(),
    (async () => {
      if (order.googleSentAt) return;
      try {
        if (await uploadPurchase(store, order)) await db.update(orders).set({ googleSentAt: new Date() }).where(eq(orders.id, order.id));
      } catch (e) {
        console.error(`[google-ads] order ${order.id}:`, e instanceof Error ? e.message : e);
      }
    })(),
  ]);
}

/** Best-effort client IP behind Railway's proxy. */
export function clientIp(request: Request) {
  const xff = request.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : request.headers.get("x-real-ip") ?? "").trim() || undefined;
}

export async function logPaymentEvent(e: { storeId: number | null; orderId: string | null; source: string; kind: string; status?: string | null; payload: Record<string, unknown> }) {
  try {
    await db.insert(paymentEvents).values({ ...e, status: e.status ?? null });
  } catch (err) {
    console.error("[payment_events]", err instanceof Error ? err.message : err);
  }
}

/** Records refunds reported by PayU against a paid order. */
export async function syncRefunds(store: Store, order: Order, source: string) {
  const r = await fetchRefundedPaise(store, order.id);
  await logPaymentEvent({ storeId: store.id, orderId: order.id, source, kind: "refund", status: r.refunded ? "refunded" : r.pending ? "pending" : "none", payload: r.raw });
  const paid = order.amountPaid ?? order.total;
  if (r.refunded > 0) {
    const [u] = await db.update(orders).set({ refunded: Math.min(paid, r.refunded), refundStatus: r.refunded >= paid ? "full" : "partial", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    if (u.refundStatus === "full") await reverseSaleFee(store, u);
    return u;
  }
  if (r.pending && !order.refundStatus) {
    const [u] = await db.update(orders).set({ refundStatus: "pending", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    return u;
  }
  return order;
}

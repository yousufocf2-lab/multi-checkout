import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, orders, paymentEvents, stores, type Order, type Store } from "~/db.server";
import { fetchRefundedPaise, verifyPayment } from "./payu.server";
import { recordOrderForCod } from "./cod.server";
import { incrementCouponUse } from "./coupons.server";
import { sendCapiPurchase } from "./meta.server";
import { createShopifyOrder } from "./shopify.server";

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

/** Pushes the order to Shopify. Errors are saved on the order (retry from admin). */
export async function pushToShopify(store: Store, order: Order) {
  if (order.shopifyOrderId) return order;
  try {
    const created = await createShopifyOrder(store, order);
    const [updated] = await db
      .update(orders)
      .set({ shopifyOrderId: created.id, shopifyOrderName: created.name, error: null, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    return updated;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shopify] order ${order.id} failed:`, msg);
    const [updated] = await db
      .update(orders)
      .set({ error: msg.slice(0, 2000), updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    return updated;
  }
}

/** Marks a successful order (paid / COD placed), counts coupon use, creates it in Shopify. */
export async function finalizeOrder(store: Store, order: Order, patch: Partial<Order>) {
  const [updated] = await db
    .update(orders)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(orders.id, order.id))
    .returning();
  await incrementCouponUse(store.id, updated.couponCode);
  await recordOrderForCod(store.id, updated.customer.phone, updated.paymentMethod === "cod" ? "cod" : "prepaid");
  void trackPurchase(store, updated);
  return pushToShopify(store, updated);
}

/** Fires the Meta CAPI Purchase once per order (never blocks the customer). */
export async function trackPurchase(store: Store, order: Order) {
  if (order.capiSentAt) return;
  try {
    if (await sendCapiPurchase(store, order)) {
      await db.update(orders).set({ capiSentAt: new Date() }).where(eq(orders.id, order.id));
    }
  } catch (e) {
    console.error(`[capi] order ${order.id}:`, e instanceof Error ? e.message : e);
  }
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

/**
 * Confirms a prepaid order's status with PayU (server to server) and updates it.
 * Used by webhooks, the order page and the dashboard "Check payment" button.
 */
export async function syncOrderWithPayu(store: Store, order: Order, source: string): Promise<Order> {
  if (order.paymentMethod !== "prepaid") return order;
  const v = await verifyPayment(store, order.id);
  await logPaymentEvent({ storeId: store.id, orderId: order.id, source, kind: "payment", status: v.status, payload: v.raw });

  if (v.status === "success" && (order.status === "pending_payment" || order.status === "failed")) {
    if (v.amountPaise != null && v.amountPaise !== order.total) {
      await db.update(orders).set({ error: `PayU amount ${v.amountPaise} doesn't match order total ${order.total}`, updatedAt: new Date() }).where(eq(orders.id, order.id));
      return order;
    }
    const debited = v.netDebitPaise ?? order.total;
    return finalizeOrder(store, order, {
      status: "paid",
      payuMihpayid: v.mihpayid ?? order.payuMihpayid,
      amountPaid: debited,
      bankDiscount: Math.max(0, order.total - debited),
      error: null,
    });
  }
  if (v.status === "failure" && order.status === "pending_payment") {
    const [u] = await db.update(orders).set({ status: "failed", error: "Payment failed (confirmed with PayU)", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    return u;
  }
  if (order.status === "paid" && source === "webhook") await syncRefunds(store, order, source);
  return order;
}

/** Records refunds reported by PayU against a paid order. */
export async function syncRefunds(store: Store, order: Order, source: string) {
  const r = await fetchRefundedPaise(store, order.id);
  await logPaymentEvent({ storeId: store.id, orderId: order.id, source, kind: "refund", status: r.refunded ? "refunded" : r.pending ? "pending" : "none", payload: r.raw });
  const paid = order.amountPaid ?? order.total;
  if (r.refunded > 0) {
    const [u] = await db.update(orders).set({ refunded: Math.min(paid, r.refunded), refundStatus: r.refunded >= paid ? "full" : "partial", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    return u;
  }
  if (r.pending && !order.refundStatus) {
    const [u] = await db.update(orders).set({ refundStatus: "pending", updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    return u;
  }
  return order;
}

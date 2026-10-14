import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, orders, stores, type Order, type Store } from "~/db.server";
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

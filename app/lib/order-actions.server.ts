// Orders page actions on one or many orders: ship with a chosen courier, cancel (with an optional refund).
import { and, eq, inArray, sql } from "drizzle-orm";
import { catalogVariants, courierAccounts, db, orders, type CourierAccount, type Order, type OrderEvent, type Store } from "~/db.server";
import { bookOrder, cancelBookedShipment } from "./auto-ship.server";
import { isCatalogVariant } from "./catalog.server";
import { courierById } from "./courier-catalog";
import { ADAPTERS, storeGateways } from "./gateways/index.server";
import { gatewayName } from "./gateways/catalog";
import { cancelStoreOrder } from "./platform.server";

const LIVE = ["paid", "cod_placed"];

/** Couriers this store can book shipments with from Growpefy (connected with their own API keys). */
export async function bookableCouriers(storeIds: number[]) {
  if (!storeIds.length) return [] as CourierAccount[];
  const rows = await db.select().from(courierAccounts).where(and(inArray(courierAccounts.storeId, storeIds), eq(courierAccounts.status, "connected")));
  return rows.filter((a) => !a.creds.viaShopify && (a.courier === "delhivery" ? Boolean(a.creds.token && a.creds.pickupName) : a.courier === "shiprocket" ? Boolean(a.creds.email && a.creds.password) : false))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** For the Orders page: { storeId: [{ id, name }] } of couriers that can take orders. */
export async function courierChoices(storeIds: number[]) {
  const out: Record<number, { id: string; name: string }[]> = {};
  for (const a of await bookableCouriers(storeIds)) (out[a.storeId] ??= []).push({ id: a.courier, name: courierById(a.courier)?.name ?? a.courier });
  return out;
}

const stamp = (by: string, text: string): OrderEvent => ({ at: new Date().toISOString(), by, text });
const name = (o: Order) => o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`;

/** Books each order with the chosen courier (or the store's first one). */
export async function shipOrders(store: Store, ids: string[], courier: string | null, by: string) {
  const accs = await bookableCouriers([store.id]);
  if (!accs.length) return { shipped: [] as string[], failed: [{ name: "", error: "Connect a courier first (Shipping & RTO → Shipments)." }] };
  const acc = (courier && accs.find((a) => a.courier === courier)) || accs[0];
  const list = await db.select().from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.id, ids.slice(0, 100))));
  const shipped: string[] = [], failed: { name: string; error: string }[] = [];
  for (const o of list) {
    if (!LIVE.includes(o.status)) { failed.push({ name: name(o), error: "Only paid or COD orders can be shipped." }); continue; }
    if (o.awb || o.courierRef) { failed.push({ name: name(o), error: "Already shipped." }); continue; }
    const r = await bookOrder(store, o, acc);
    if (r.ok) {
      shipped.push(name(o));
      await db.update(orders).set({ timeline: sql`${orders.timeline} || ${JSON.stringify([stamp(by, `Shipped with ${courierById(acc.courier)?.name ?? acc.courier}`)])}::jsonb` }).where(eq(orders.id, o.id));
    } else failed.push({ name: name(o), error: r.error ?? "The courier didn't accept it." });
  }
  return { shipped, failed, courier: courierById(acc.courier)?.name ?? acc.courier };
}

/** What can be refunded online for an order (prepaid / Partial COD advance that was actually paid). */
export function refundable(o: Pick<Order, "status" | "paymentMethod" | "amountPaid" | "advance" | "total" | "refunded">) {
  if (o.status !== "paid" && !(o.status === "cod_placed" && o.paymentMethod === "partial")) return 0;
  if (o.paymentMethod === "cod") return 0;
  const paid = o.amountPaid ?? (o.paymentMethod === "partial" ? o.advance ?? 0 : o.total);
  return Math.max(0, paid - (o.refunded ?? 0));
}

async function refundOrder(store: Store, o: Order): Promise<{ ok: true; pending: boolean } | { ok: false; error: string }> {
  const amount = refundable(o);
  if (amount <= 0) return { ok: false, error: "Nothing paid online to refund." };
  const gid = o.gateway ?? "payu";
  const cfg = storeGateways(store).find((g) => g.id === gid);
  const adapter = ADAPTERS[gid];
  if (!cfg || !adapter) return { ok: false, error: `${gatewayName(gid)} isn't connected any more. Refund it from the ${gatewayName(gid)} dashboard.` };
  if (!adapter.refund) return { ok: false, error: `Refund it from your ${gatewayName(gid)} dashboard (automatic refunds work with PayU and Razorpay).` };
  const last = [...(o.payAttempts ?? [])].reverse().find((a) => a.g === gid);
  try {
    const r = await adapter.refund(cfg, { txn: last?.txn ?? o.id, ref: o.payuMihpayid ?? o.gatewayRef ?? last?.ref ?? null, amountPaise: amount, refundId: `R${o.id.slice(-10)}${Date.now().toString(36).slice(-6)}` });
    if (!r.ok) return r;
    await db.update(orders).set(r.pending ? { refundStatus: "pending" } : { refunded: (o.refunded ?? 0) + amount, refundStatus: "full" }).where(eq(orders.id, o.id));
    return { ok: true, pending: r.pending };
  } catch (e) {
    return { ok: false, error: `${gatewayName(gid)}: ${e instanceof Error ? e.message : "couldn't start the refund"}` };
  }
}

/** Puts the stock of a cancelled website order back. */
async function restock(store: Store, o: Order) {
  for (const l of o.items) {
    if (!isCatalogVariant(l.variantId)) continue;
    await db.update(catalogVariants).set({ stock: sql`${catalogVariants.stock} + ${l.quantity}` })
      .where(and(eq(catalogVariants.id, Number(l.variantId.replace(/^gp:/, ""))), eq(catalogVariants.storeId, store.id), sql`${catalogVariants.stock} is not null`));
  }
}

export const CANCEL_REASONS = ["Customer changed their mind", "Fake or fraud order", "Out of stock", "Wrong or incomplete address", "Duplicate order", "Other"] as const;

/** Cancels orders: stops the shipment at the courier, cancels it in Shopify/WooCommerce, restocks, and refunds if asked. */
export async function cancelOrders(store: Store, ids: string[], opts: { refund: boolean; reason: string; by: string }) {
  const list = await db.select().from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.id, ids.slice(0, 100))));
  const done: string[] = [], failed: { name: string; error: string }[] = [], notes: string[] = [];
  let refunded = 0, refundsPending = 0;
  for (const o of list) {
    if (o.status === "cancelled") { failed.push({ name: name(o), error: "Already cancelled." }); continue; }
    if (!["paid", "cod_placed", "pending_payment", "cod_placing"].includes(o.status)) { failed.push({ name: name(o), error: "Failed payments can't be cancelled." }); continue; }
    if (o.shipStatus === "delivered") { failed.push({ name: name(o), error: "Already delivered. Use a return instead." }); continue; }
    const events: OrderEvent[] = [];
    // 1. Stop the parcel at the courier (only works before pickup)
    if (o.awb || o.courierRef) {
      await cancelBookedShipment(store.id, o).catch(() => null);
      const [after] = await db.select({ s: orders.shipStatus }).from(orders).where(eq(orders.id, o.id)).limit(1);
      if (after?.s === "cancelled") events.push(stamp(opts.by, `Shipment ${o.awb ?? ""} cancelled at ${courierById(o.courier ?? "")?.name ?? "the courier"}`.replace("  ", " ")));
      else notes.push(`${name(o)}: the courier didn't cancel the shipment (maybe already picked up). Cancel it in the courier panel.`);
    }
    // 2. The store's own platform
    if (o.shopifyOrderId && !o.shopifyOrderId.startsWith("gp:")) {
      const err = await cancelStoreOrder(store, o.shopifyOrderId, opts.reason).catch((e) => (e instanceof Error ? e.message : "error"));
      if (err) notes.push(`${name(o)}: couldn't cancel it in ${store.platform === "woocommerce" ? "WooCommerce" : "Shopify"} (${err}).`);
    } else await restock(store, o);
    // 3. Money back
    if (opts.refund && refundable(o) > 0) {
      const r = await refundOrder(store, o);
      if (r.ok) { r.pending ? refundsPending++ : refunded++; events.push(stamp(opts.by, `Refund of ₹${(refundable(o) / 100).toLocaleString("en-IN")} started at ${gatewayName(o.gateway ?? "payu")}`)); }
      else notes.push(`${name(o)}: refund not started. ${r.error}`);
    }
    events.push(stamp(opts.by, `Order cancelled: ${opts.reason}`));
    await db.update(orders).set({
      status: "cancelled", cancelledAt: new Date(), cancelReason: opts.reason.slice(0, 200), cancelledBy: opts.by.slice(0, 120), updatedAt: new Date(),
      timeline: sql`${orders.timeline} || ${JSON.stringify(events)}::jsonb`,
    }).where(eq(orders.id, o.id));
    done.push(name(o));
  }
  return { done, failed, notes, refunded, refundsPending };
}

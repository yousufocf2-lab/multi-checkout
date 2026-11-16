// Kitchen screen for restaurants / cloud kitchens: the live orders and moving them along.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, orders, type Store } from "~/db.server";
import { FULFILMENT_LABEL, KITCHEN_LABEL, nextStatus, resolveRestaurant, type Fulfilment, type KitchenStatus } from "./restaurant";
import { codAmount } from "./store-fulfil.server";

const LIVE: KitchenStatus[] = ["new", "accepted", "preparing", "ready", "out"];
const WINDOW_H = 36; // older unfinished orders drop off the board

/** Orders before this feature (no kitchen status yet) count as new. */
const status = sql<KitchenStatus>`coalesce(${orders.kitchenStatus}, 'new')`;

export async function kitchenBoard(store: Store) {
  const since = new Date(Date.now() - WINDOW_H * 3600_000);
  // "Accept automatically": new orders go straight to Preparing
  if (resolveRestaurant(store.restaurant).kitchen.autoAccept) {
    await db.update(orders).set({ kitchenStatus: "preparing", kitchenAt: new Date() })
      .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, since), sql`${orders.kitchenStatus} is null`));
  }
  const dayStart = (() => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000); })();
  const base = and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]));
  const [live, today] = await Promise.all([
    db.select().from(orders).where(and(base, gte(orders.createdAt, since), sql`${status} in ('new','accepted','preparing','ready','out')`)).orderBy(orders.createdAt).limit(200),
    db.select({
      done: sql<number>`count(*) filter (where ${orders.kitchenStatus} = 'done')::int`,
      rejected: sql<number>`count(*) filter (where ${orders.kitchenStatus} = 'rejected')::int`,
      sales: sql<number>`coalesce(sum(${orders.total}) filter (where coalesce(${orders.kitchenStatus}, '') <> 'rejected'), 0)::bigint`,
      all: sql<number>`count(*)::int`,
    }).from(orders).where(and(base, gte(orders.createdAt, dayStart))),
  ]);
  return {
    orders: live.map((o) => {
      const s = (o.kitchenStatus ?? "new") as KitchenStatus;
      const f = (o.fulfilment ?? "delivery") as Fulfilment;
      return {
        id: o.id, name: o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`, at: o.createdAt.toISOString(), statusAt: (o.kitchenAt ?? o.createdAt).toISOString(),
        status: s, statusLabel: KITCHEN_LABEL[s], fulfilment: f, fulfilmentLabel: FULFILMENT_LABEL[f], table: o.tableNo,
        next: nextStatus(s, f), cod: o.paymentMethod !== "prepaid" ? codAmount(o) : 0, total: o.total, paid: o.paymentMethod === "prepaid",
        customer: `${o.customer.firstName} ${o.customer.lastName}`.trim(), phone: o.customer.phone,
        address: f === "delivery" ? [o.customer.address1, o.customer.address2, o.customer.city].filter(Boolean).join(", ") : "",
        note: o.customerNote ?? "", staffNote: o.staffNote ?? "",
        items: o.items.map((l) => ({ qty: l.quantity, title: l.title, variant: l.variantTitle })),
      };
    }),
    today: { ...today[0], sales: Number(today[0]?.sales ?? 0) },
  };
}

/** Move an order to a kitchen status (or reject it). Returns an error message when it can't. */
export async function setKitchenStatus(store: Store, orderId: string, to: KitchenStatus, by: string, reason?: string) {
  const [o] = await db.select().from(orders).where(and(eq(orders.storeId, store.id), eq(orders.id, orderId))).limit(1);
  if (!o) return "Order not found.";
  const from = (o.kitchenStatus ?? "new") as KitchenStatus;
  if (from === to) return null;
  if (from === "done" || from === "rejected") return "This order is already closed.";
  if (to === "rejected" && !["new", "accepted"].includes(from)) return "Only new or accepted orders can be rejected.";
  if (!LIVE.includes(to) && to !== "done" && to !== "rejected") return "Unknown status.";
  const text = to === "rejected" ? `Rejected by the kitchen${reason ? `: ${reason.slice(0, 140)}` : ""}` : `Kitchen: ${KITCHEN_LABEL[to]}`;
  await db.update(orders).set({
    kitchenStatus: to, kitchenAt: new Date(), updatedAt: new Date(),
    timeline: [...(o.timeline ?? []), { at: new Date().toISOString(), by: by.slice(0, 120), text }],
  }).where(eq(orders.id, o.id));
  return null;
}

export async function recentKitchenOrders(store: Store, limit = 30) {
  return db.select({ id: orders.id, name: orders.shopifyOrderName, status: orders.kitchenStatus, at: orders.kitchenAt, total: orders.total, fulfilment: orders.fulfilment })
    .from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.kitchenStatus, ["done", "rejected"]))).orderBy(desc(orders.kitchenAt)).limit(limit);
}

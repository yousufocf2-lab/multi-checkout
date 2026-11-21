// Shipping label batches: "print new labels" picks every booked Delhivery shipment whose label hasn't been printed
// from Growpefy yet, prints them as one batch and remembers it, so nothing gets printed twice or missed.
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { courierAccounts, db, orders, type Store } from "~/db.server";
import { delhiveryPackingSlips } from "./couriers/delhivery.server";
import { labelsPdf, type LabelOrder } from "./labels.server";

const cols = {
  id: orders.id, awb: orders.awb, shopifyOrderName: orders.shopifyOrderName, paymentMethod: orders.paymentMethod, total: orders.total,
  amountPaid: orders.amountPaid, advance: orders.advance, customer: orders.customer, items: orders.items, createdAt: orders.createdAt,
};
/** Booked with Delhivery, not picked up, not cancelled, label not printed yet. */
const pendingWhere = (storeId: number) => and(
  eq(orders.storeId, storeId), eq(orders.courier, "delhivery"), isNotNull(orders.awb), isNull(orders.labelPrintedAt),
  eq(orders.shipStatus, "pickup_pending"), ne(orders.status, "cancelled"),
);

export async function labelSummary(storeId: number) {
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(pendingWhere(storeId));
  const batches = await db.select({ batch: orders.labelBatch, n: sql<number>`count(*)::int`, at: sql<string>`max(${orders.labelPrintedAt})` })
    .from(orders).where(and(eq(orders.storeId, storeId), isNotNull(orders.labelBatch), sql`${orders.labelPrintedAt} > now() - interval '15 days'`))
    .groupBy(orders.labelBatch).orderBy(desc(sql`max(${orders.labelPrintedAt})`)).limit(8);
  return { pending: p?.n ?? 0, batches: batches.map((b) => ({ batch: b.batch!, count: b.n, at: new Date(b.at).toISOString() })) };
}

async function render(store: Store, list: LabelOrder[], batch: string) {
  const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), eq(courierAccounts.courier, "delhivery"))).limit(1);
  const slips = acc?.creds.token ? await delhiveryPackingSlips(acc.creds.token, list.map((o) => o.awb!).filter(Boolean)) : new Map();
  return labelsPdf(list, slips, { name: store.name, pickup: acc?.creds.pickupName ?? null }, batch);
}

const batchName = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** Prints every label not printed yet (oldest first) as a new batch. */
export async function printNewLabels(store: Store) {
  const list = await db.select(cols).from(orders).where(pendingWhere(store.id)).orderBy(asc(orders.createdAt)).limit(300);
  if (!list.length) return null;
  const now = new Date();
  const batch = batchName(now);
  const pdf = await render(store, list, batch);
  await db.update(orders).set({ labelPrintedAt: now, labelBatch: batch }).where(and(inArray(orders.id, list.map((o) => o.id)), isNull(orders.labelPrintedAt)));
  console.log(`[labels] store ${store.id}: printed ${list.length} label(s), batch ${batch}`);
  return { pdf, batch, count: list.length };
}

/** Prints a past batch again (nothing is marked). */
export async function reprintBatch(store: Store, batch: string) {
  const list = await db.select(cols).from(orders).where(and(eq(orders.storeId, store.id), eq(orders.labelBatch, batch))).orderBy(asc(orders.createdAt));
  if (!list.length) return null;
  return { pdf: await render(store, list, batch), batch, count: list.length };
}

/** One shipment's label; marks it printed if it wasn't. */
export async function printOne(store: Store, orderId: string) {
  const [o] = await db.select({ ...cols, labelPrintedAt: orders.labelPrintedAt, labelBatch: orders.labelBatch, courier: orders.courier }).from(orders)
    .where(and(eq(orders.storeId, store.id), eq(orders.id, orderId))).limit(1);
  if (!o?.awb || o.courier !== "delhivery") return null;
  const batch = o.labelBatch ?? `Single ${batchName(new Date())}`;
  const pdf = await render(store, [o], batch);
  if (!o.labelPrintedAt) await db.update(orders).set({ labelPrintedAt: new Date(), labelBatch: batch }).where(eq(orders.id, o.id));
  return { pdf, batch, count: 1 };
}

// Dropshipping through Shipnex. Super admin only: stores never see a setting or a mention of it.
// - Prepaid orders on an enabled store: product price (SKU list) + zone shipping come out of the wallet right away.
// - 8 hours later the order is marked fulfilled in Shopify with a tracking number (no customer email).
// - Cancelled before fulfilment → product + shipping back; within 24 h after fulfilment → product back; later → nothing.
// - Admin marks RTO → RTO charge (store's RTO rate, else the order's shipping again).
// COD and Partial COD orders are never dropshipped (the store ships those with its own courier).
import crypto from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, notExists, or, sql } from "drizzle-orm";
import {
  db, dropshipOrders, dropshipSkus, orders, platformSettings, stores,
  type DropshipLine, type DropshipOrder, type Order, type OrderCustomer, type Store,
} from "~/db.server";
import { FULFIL_AFTER_HOURS, PRODUCT_REFUND_HOURS, cancelRefund, skuKey, zoneFor, zoneRates, type Zone } from "./dropship";
import { fetchFulfillmentTracking, fetchVariantSkus, fulfilStoreOrder, orderGid } from "./platform.server";
import { getPlatform, getWallet, postTransaction } from "./wallet.server";

const TRACKING_COMPANY = "Shipnex";

export async function zonesNow() {
  return zoneRates((await getPlatform()).dropshipZones);
}

/** Default price list merged with the store's own prices. Key = first 9 characters of the SKU. */
export async function pricesFor(store: Pick<Store, "dropship">) {
  const list = await db.select().from(dropshipSkus).orderBy(asc(dropshipSkus.sku));
  const map = new Map<string, { sku: string; name: string; pricePaise: number }>();
  for (const r of list) {
    const k = skuKey(r.sku);
    if (k) map.set(k, { sku: r.sku, name: r.name, pricePaise: r.pricePaise });
  }
  for (const [sku, price] of Object.entries(store.dropship?.prices ?? {})) {
    const k = skuKey(sku);
    if (!k || !Number.isFinite(price) || price < 0) continue;
    map.set(k, { sku: map.get(k)?.sku ?? sku, name: map.get(k)?.name ?? sku, pricePaise: Math.round(price) });
  }
  return map;
}

type LineIn = { variantId: string; title: string; variantTitle?: string | null; quantity: number };

/** What a dropship order costs the store: product prices from the SKU list + one zone shipping charge. */
export async function quoteDropship(store: Store, items: LineIn[], address: Pick<OrderCustomer, "state" | "pincode" | "city">) {
  const [skus, prices, zones] = await Promise.all([fetchVariantSkus(store, items.map((l) => l.variantId)), pricesFor(store), zonesNow()]);
  const zone: Zone = zoneFor(address);
  const lines: DropshipLine[] = [];
  const missing: string[] = [];
  let product = 0;
  for (const l of items) {
    if (l.quantity <= 0) continue;
    const sku = skus.get(l.variantId) || null;
    const hit = prices.get(skuKey(sku) ?? "");
    const title = `${l.title}${l.variantTitle ? ` · ${l.variantTitle}` : ""}`.slice(0, 160);
    if (!hit) missing.push(sku ? sku : `No SKU · ${title}`);
    lines.push({ sku, title, quantity: l.quantity, unitPaise: hit?.pricePaise ?? null });
    product += (hit?.pricePaise ?? 0) * l.quantity;
  }
  return { zone, lines, missing, productPaise: product, shippingPaise: lines.length ? zones[zone] : 0 };
}

export const dropshipEligible = (store: Pick<Store, "dropshipEnabled">, order: Pick<Order, "paymentMethod" | "status">) =>
  store.dropshipEnabled && order.paymentMethod === "prepaid" && order.status === "paid";

const ref = (o: Pick<Order, "id" | "shopifyOrderName">) => o.shopifyOrderName ?? o.id;

/** Charges a paid prepaid order once (safe to call again). Never throws. */
export async function chargeDropship(store: Store, order: Order) {
  try {
    if (!dropshipEligible(store, order)) return null;
    const [have] = await db.select({ id: dropshipOrders.orderId }).from(dropshipOrders).where(eq(dropshipOrders.orderId, order.id)).limit(1);
    if (have) return null;
    const q = await quoteDropship(store, order.items, order.customer);
    const [row] = await db.insert(dropshipOrders).values({
      orderId: order.id, storeId: store.id, zone: q.zone, lines: q.lines,
      productPaise: q.productPaise, shippingPaise: q.shippingPaise, missingSkus: q.missing,
      fulfilAfter: new Date(new Date(order.createdAt).getTime() + FULFIL_AFTER_HOURS * 3600_000),
    }).onConflictDoNothing().returning();
    if (!row) return null;
    const w = await getWallet(store.id);
    if (q.productPaise > 0) {
      await postTransaction({ walletId: w.id, type: "dropship_product", amountPaise: -q.productPaise, refType: "order", refId: order.id, note: ref(order) });
    }
    if (q.shippingPaise > 0) {
      await postTransaction({ walletId: w.id, type: "dropship_shipping", amountPaise: -q.shippingPaise, refType: "order", refId: order.id, note: ref(order) });
    }
    return row;
  } catch (e) {
    console.error(`[dropship] charge ${order.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export const BLOCK_MESSAGE = "This store can't take orders right now. Please try again in a little while.";

/**
 * Dropshipping stores can't take orders once the wallet is past its limit (default −₹500, set per store by admin).
 * A prepaid order is also refused if its own charge would take the wallet past the limit.
 */
export async function dropshipBlock(store: Store, method: string, items: LineIn[], address: Pick<OrderCustomer, "state" | "pincode" | "city">) {
  if (!store.dropshipEnabled) return null;
  const w = await getWallet(store.id);
  const floor = -w.negativeLimitPaise;
  if (w.balancePaise < floor) return BLOCK_MESSAGE;
  if (method !== "prepaid") return null;
  try {
    const q = await quoteDropship(store, items, address);
    if (w.balancePaise - q.productPaise - q.shippingPaise < floor) return BLOCK_MESSAGE;
  } catch (e) {
    console.error(`[dropship] quote for store ${store.id}:`, e instanceof Error ? e.message : e);
  }
  return null;
}

// ---------------- cancellations and RTO ----------------

/** Cancels a dropship order and gives back what the timing allows. Runs once per order. */
export async function cancelDropship(row: DropshipOrder, at = new Date()) {
  const refund = cancelRefund(row, at);
  const [u] = await db.update(dropshipOrders).set({ status: "cancelled", cancelledAt: at, refundPaise: refund, error: null })
    .where(and(eq(dropshipOrders.orderId, row.orderId), eq(dropshipOrders.status, row.status))).returning();
  if (!u) return null;
  if (refund > 0) {
    const [o] = await db.select({ id: orders.id, shopifyOrderName: orders.shopifyOrderName }).from(orders).where(eq(orders.id, row.orderId)).limit(1);
    const w = await getWallet(row.storeId);
    await postTransaction({
      walletId: w.id, type: "dropship_refund", amountPaise: refund, refType: "order", refId: row.orderId,
      note: `${o ? ref(o) : row.orderId} · ${row.status === "charged" ? "product + shipping" : "product"}`,
    });
  }
  return u;
}

export async function markRto(orderId: string, by: string) {
  const [row] = await db.select().from(dropshipOrders).where(eq(dropshipOrders.orderId, orderId)).limit(1);
  if (!row) throw new Error("Order not found");
  if (row.status !== "fulfilled") throw new Error("Only fulfilled orders can be marked RTO");
  const [store] = await db.select().from(stores).where(eq(stores.id, row.storeId)).limit(1);
  const rate = store?.dropship?.rtoPaise;
  const charge = typeof rate === "number" && rate >= 0 ? rate : row.shippingPaise;
  const [u] = await db.update(dropshipOrders).set({ status: "rto", rtoAt: new Date(), rtoPaise: charge })
    .where(and(eq(dropshipOrders.orderId, orderId), eq(dropshipOrders.status, "fulfilled"))).returning();
  if (!u) return null;
  const [o] = await db.select({ id: orders.id, shopifyOrderName: orders.shopifyOrderName }).from(orders).where(eq(orders.id, orderId)).limit(1);
  await db.update(orders).set({ shipStatus: "rto", shipStatusRaw: "RTO", shipStatusAt: new Date() }).where(eq(orders.id, orderId));
  if (charge > 0) {
    const w = await getWallet(row.storeId);
    await postTransaction({ walletId: w.id, type: "dropship_rto", amountPaise: -charge, refType: "order", refId: orderId, note: o ? ref(o) : orderId, createdBy: by });
  }
  return u;
}

// ---------------- background job ----------------

const newTracking = () => `SNX${crypto.randomInt(100_000, 999_999)}${crypto.randomInt(10_000, 99_999)}`;

/** Marks one due order fulfilled in Shopify. */
export async function fulfilDropship(row: DropshipOrder) {
  const [hit] = await db.select({ order: orders, store: stores }).from(orders).innerJoin(stores, eq(orders.storeId, stores.id)).where(eq(orders.id, row.orderId)).limit(1);
  if (!hit) return null;
  if (!hit.order.shopifyOrderId) {
    await db.update(dropshipOrders).set({ error: "Order isn't in Shopify yet" }).where(eq(dropshipOrders.orderId, row.orderId));
    return null;
  }
  let tracking = row.trackingNumber;
  for (let i = 0; !tracking && i < 5; i++) {
    const t = newTracking();
    const [u] = await db.update(dropshipOrders).set({ trackingNumber: t }).where(eq(dropshipOrders.orderId, row.orderId)).returning().catch(() => []);
    if (u) tracking = t;
  }
  if (!tracking) return null;
  try {
    const r = await fulfilStoreOrder(hit.store, hit.order.shopifyOrderId, { number: tracking, company: TRACKING_COMPANY });
    if (r.ok) {
      const [u] = await db.update(dropshipOrders).set({ status: "fulfilled", fulfilledAt: new Date(), error: null })
        .where(and(eq(dropshipOrders.orderId, row.orderId), eq(dropshipOrders.status, "charged"))).returning();
      return u ?? null;
    }
    if (r.cancelled) return cancelDropship(row);
    await db.update(dropshipOrders).set({ error: r.error.slice(0, 300) }).where(eq(dropshipOrders.orderId, row.orderId));
  } catch (e) {
    await db.update(dropshipOrders).set({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).where(eq(dropshipOrders.orderId, row.orderId));
  }
  return null;
}

/** Paid prepaid orders on dropship stores that didn't get charged (e.g. Shopify was down). */
async function chargeMissed() {
  const list = await db.select().from(stores).where(eq(stores.dropshipEnabled, true));
  for (const s of list) {
    const since = new Date(Math.max(Date.now() - 3 * 86400_000, s.dropship?.enabledAt ? new Date(s.dropship.enabledAt).getTime() : 0));
    const missed = await db.select().from(orders).where(and(
      eq(orders.storeId, s.id), eq(orders.status, "paid"), eq(orders.paymentMethod, "prepaid"), gte(orders.createdAt, since),
      notExists(db.select({ x: sql`1` }).from(dropshipOrders).where(eq(dropshipOrders.orderId, orders.id))),
    )).limit(50);
    for (const o of missed) await chargeDropship(s, o);
  }
}

/** Shopify cancellations: orders waiting to fulfil, and fulfilled orders still inside the 24-hour product refund. */
async function checkCancellations() {
  const rows = await db.select().from(dropshipOrders).where(or(
    eq(dropshipOrders.status, "charged"),
    and(eq(dropshipOrders.status, "fulfilled"), gt(dropshipOrders.fulfilledAt, new Date(Date.now() - PRODUCT_REFUND_HOURS * 3600_000))),
  ));
  if (!rows.length) return 0;
  const info = await db.select({ id: orders.id, gid: orders.shopifyOrderId, storeId: orders.storeId }).from(orders)
    .where(and(inArray(orders.id, rows.map((r) => r.orderId)), isNotNull(orders.shopifyOrderId)));
  const storeIds = [...new Set(info.map((i) => i.storeId))];
  const storeRows = storeIds.length ? await db.select().from(stores).where(inArray(stores.id, storeIds)) : [];
  let n = 0;
  for (const s of storeRows) {
    const mine = info.filter((i) => i.storeId === s.id);
    for (let i = 0; i < mine.length; i += 50) {
      const chunk = mine.slice(i, i + 50);
      const t = await fetchFulfillmentTracking(s, chunk.map((c) => orderGid(c.gid!))).catch(() => []);
      for (const c of chunk) {
        const tr = t.find((x) => x.orderId === orderGid(c.gid!));
        if (!tr?.cancelled) continue;
        const row = rows.find((r) => r.orderId === c.id)!;
        if (await cancelDropship(row)) n++;
      }
    }
  }
  return n;
}

export async function runDropship() {
  await chargeMissed();
  await checkCancellations();
  const due = await db.select().from(dropshipOrders)
    .where(and(eq(dropshipOrders.status, "charged"), lte(dropshipOrders.fulfilAfter, new Date())))
    .orderBy(asc(dropshipOrders.fulfilAfter)).limit(200);
  let done = 0;
  for (const r of due) if (await fulfilDropship(r)) done++;
  return { due: due.length, fulfilled: done };
}

const EVERY_MS = 10 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __dropshipWatcher: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __dropshipRunning: boolean | undefined;
}

async function tick() {
  if (globalThis.__dropshipRunning) return;
  globalThis.__dropshipRunning = true;
  try { await runDropship(); } catch (e) { console.error("[dropship] job:", e instanceof Error ? e.message : e); }
  finally { globalThis.__dropshipRunning = false; }
}

/** Every 10 minutes: charge missed orders, refund cancellations, fulfil orders that are 8 hours old. */
export function startDropshipWatcher() {
  if (globalThis.__dropshipWatcher || !process.env.DATABASE_URL) return;
  globalThis.__dropshipWatcher = setInterval(() => void tick(), EVERY_MS);
  globalThis.__dropshipWatcher.unref?.();
  setTimeout(() => void tick(), 30_000).unref?.();
}

// ---------------- admin ----------------

export async function savePriceList(rows: { sku: string; name: string; pricePaise: number }[]) {
  const clean = new Map<string, { sku: string; name: string; pricePaise: number }>();
  for (const r of rows) {
    const k = skuKey(r.sku);
    if (!k) throw new Error(`SKU "${r.sku}" is shorter than 9 characters`);
    if (!Number.isFinite(r.pricePaise) || r.pricePaise < 0) throw new Error(`Price for ${r.sku} isn't valid`);
    if (clean.has(k)) throw new Error(`${r.sku} and ${clean.get(k)!.sku} have the same first 9 characters`);
    clean.set(k, { sku: r.sku.trim().toUpperCase(), name: r.name.trim().slice(0, 120) || r.sku, pricePaise: Math.round(r.pricePaise) });
  }
  await db.transaction(async (tx) => {
    await tx.delete(dropshipSkus);
    if (clean.size) await tx.insert(dropshipSkus).values([...clean.values()].map((r) => ({ ...r, updatedAt: new Date() })));
  });
  return clean.size;
}

export async function saveZones(z: Record<Zone, number>) {
  await getPlatform();
  await db.update(platformSettings).set({ dropshipZones: z, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
}

export function recentDropshipOrders(limit = 100) {
  return db.select({ d: dropshipOrders, name: orders.shopifyOrderName, customer: orders.customer, total: orders.total, storeName: stores.name })
    .from(dropshipOrders).innerJoin(orders, eq(orders.id, dropshipOrders.orderId)).innerJoin(stores, eq(stores.id, dropshipOrders.storeId))
    .orderBy(desc(dropshipOrders.createdAt)).limit(limit);
}

export function dropshipAlerts() {
  return db.select({ d: dropshipOrders, name: orders.shopifyOrderName, storeName: stores.name })
    .from(dropshipOrders).innerJoin(orders, eq(orders.id, dropshipOrders.orderId)).innerJoin(stores, eq(stores.id, dropshipOrders.storeId))
    .where(and(eq(dropshipOrders.alertSeen, false), sql`jsonb_array_length(${dropshipOrders.missingSkus}) > 0`))
    .orderBy(desc(dropshipOrders.createdAt)).limit(100);
}

export async function dropshipAlertCount() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(dropshipOrders)
    .where(and(eq(dropshipOrders.alertSeen, false), sql`jsonb_array_length(${dropshipOrders.missingSkus}) > 0`));
  return Number(r?.n ?? 0);
}


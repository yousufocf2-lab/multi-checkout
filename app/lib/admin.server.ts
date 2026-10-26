// Admin overview numbers: orders and revenue across client stores (no store ad data, no store details).
import { and, gte, inArray, lt, sql } from "drizzle-orm";
import { db, orders, type Store } from "~/db.server";
import { orderValueSql } from "./order-value.server";
import { addDays, bucketKeys, bucketLabel, granularityFor, type Range } from "./dates";

const OK = ["paid", "cod_placed"];

export async function platformOrders(list: Store[], range: Range) {
  const ids = list.length ? list.map((s) => s.id) : [-1];
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400_000));
  const prevFrom = new Date(from.getTime() - days * 86400_000);
  const g = granularityFor(range) === "month" ? "month" : granularityFor(range) === "hour" ? "hour" : "day";
  const fmt = g === "hour" ? "YYYY-MM-DD HH24" : g === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  const where = (a: Date, b: Date) => and(inArray(orders.storeId, ids), inArray(orders.status, OK), gte(orders.createdAt, a), lt(orders.createdAt, b));
  const revenue = sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)`;

  const [byStore, byBucket, [prev]] = await Promise.all([
    db.select({
      storeId: orders.storeId, n: sql<number>`count(*)::int`, revenue,
      prepaid: sql<number>`count(*) filter (where ${orders.paymentMethod} <> 'cod')::int`,
    }).from(orders).where(where(from, to)).groupBy(orders.storeId),
    db.select({
      k: sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', ${sql.raw(`'${fmt}'`)})`,
      n: sql<number>`count(*)::int`,
      prepaid: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}) filter (where ${orders.paymentMethod} <> 'cod'), 0)`,
      cod: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}) filter (where ${orders.paymentMethod} = 'cod'), 0)`,
    }).from(orders).where(where(from, to)).groupBy(sql`1`),
    db.select({ n: sql<number>`count(*)::int`, revenue }).from(orders).where(where(prevFrom, from)),
  ]);

  const by = new Map(byStore.map((r) => [r.storeId, r]));
  const storesOut = list.map((s) => {
    const r = by.get(s.id);
    const n = r?.n ?? 0;
    return { id: s.id, name: s.name, orders: n, revenue: Number(r?.revenue ?? 0) / 100, prepaidShare: n ? Math.round(((r?.prepaid ?? 0) / n) * 100) : null };
  }).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);

  const totalOrders = storesOut.reduce((a, s) => a + s.orders, 0);
  const totalRevenue = storesOut.reduce((a, s) => a + s.revenue, 0);
  const prepaid = byStore.reduce((a, r) => a + r.prepaid, 0);
  const bmap = new Map(byBucket.map((b) => [b.k, b]));
  const series = bucketKeys(range, g).map((k) => ({ key: k, label: bucketLabel(k, g), longLabel: bucketLabel(k, g, true), orders: bmap.get(k)?.n ?? 0, prepaid: Number(bmap.get(k)?.prepaid ?? 0) / 100, cod: Number(bmap.get(k)?.cod ?? 0) / 100, adSpend: null }));

  return {
    totals: {
      orders: totalOrders, revenue: totalRevenue, aov: totalOrders ? totalRevenue / totalOrders : 0,
      prepaidShare: totalOrders ? Math.round((prepaid / totalOrders) * 100) : null,
      activeStores: storesOut.filter((s) => s.orders > 0).length,
    },
    previous: { orders: prev?.n ?? 0, revenue: Number(prev?.revenue ?? 0) / 100 },
    stores: storesOut, series,
  };
}

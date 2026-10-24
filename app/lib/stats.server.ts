import { and, desc, gte, inArray, lt, sql } from "drizzle-orm";
import { orderValueSql } from "~/lib/order-value.server";
import { checkoutSessions, db, orders, type Store } from "~/db.server";
import { addDays, bucketKeys, bucketLabel, granularityFor, type Granularity, type Range } from "./dates";
import { clickOrders, compare, metaReady, spendFor, totalOf } from "./ads.server";
import { googleReady } from "./google-ads.server";

const OK = ["paid", "cod_placed"];

export type Bucket = { key: string; label: string; longLabel: string; prepaid: number; cod: number; orders: number; adSpend: number | null; metaSpend: number | null; googleSpend: number | null };

export type Overview = {
  range: Range;
  granularity: Granularity;
  totals: {
    revenue: number; // rupees
    orders: number;
    prepaidOrders: number;
    codOrders: number;
    prepaidRevenue: number;
    codRevenue: number;
    aov: number;
    discounts: number;
    failedPayments: number;
    abandoned: number;
    abandonedValue: number; // rupees, selling price
    refunded: number; // rupees
    sessions: number;
    conversion: number | null; // 0..1
    adSpend: number | null; // null = no ad account connected
    roas: number | null;
    costPerOrder: number | null;
    metaPurchases: number | null;
    metaSpend: number | null; // null = Meta not connected on any store in scope
    googleSpend: number | null;
    googlePurchases: number | null;
  };
  ads: ReturnType<typeof compare>;
  previous: { revenue: number; orders: number } | null;
  buckets: Bucket[];
  topProducts: { title: string; image: string | null; quantity: number; revenue: number }[];
  recent: { id: string; storeName: string; name: string; city: string; method: string; status: string; total: number; createdAt: string }[];
  adErrors: { store: string; error: string }[];
  storesWithAds: number;
};

const istBounds = (r: Range) => ({
  from: new Date(`${r.since}T00:00:00+05:30`),
  to: new Date(`${addDays(r.until, 1)}T00:00:00+05:30`),
});

export async function earliestDate(storeList: Store[]) {
  if (!storeList.length) return undefined;
  const [row] = await db
    .select({ d: sql<string | null>`to_char(min(${orders.createdAt}) at time zone 'Asia/Kolkata', 'YYYY-MM-DD')` })
    .from(orders)
    .where(inArray(orders.storeId, storeList.map((s) => s.id)));
  const created = storeList.map((s) => s.createdAt.toISOString().slice(0, 10)).sort()[0];
  return row?.d && row.d < created ? row.d : created;
}

export async function loadOverview(storeList: Store[], range: Range): Promise<Overview> {
  const granularity = granularityFor(range);
  const ids = storeList.map((s) => s.id);
  const empty = ids.length === 0;
  const { from, to } = istBounds(range);
  const inRange = (col: typeof orders.createdAt) => and(gte(col, from), lt(col, to));
  const idsFilter = inArray(orders.storeId, empty ? [-1] : ids);

  const bucketExpr =
    granularity === "hour"
      ? sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24')`
      : granularity === "day"
        ? sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`
        : sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM')`;

  const days = Math.round((to.getTime() - from.getTime()) / 86400_000);
  const prevFrom = new Date(from.getTime() - days * 86400_000);

  const [rows, failed, sessions, prev, top, recent, abandonedRows, refundRows] = await Promise.all([
    db
      .select({
        bucket: bucketExpr,
        method: orders.paymentMethod,
        count: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)`,
        discounts: sql<string>`coalesce(sum(${orders.paymentDiscount} + ${orders.couponDiscount} + ${orders.bankDiscount} + ${orders.offerDiscount}), 0)`,
      })
      .from(orders)
      .where(and(idsFilter, inArray(orders.status, OK), inRange(orders.createdAt)))
      .groupBy(bucketExpr, orders.paymentMethod),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(idsFilter, sql`${orders.status} = 'failed'`, inRange(orders.createdAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(checkoutSessions)
      .where(and(inArray(checkoutSessions.storeId, empty ? [-1] : ids), gte(checkoutSessions.createdAt, from), lt(checkoutSessions.createdAt, to))),
    range.preset === "max"
      ? Promise.resolve(null)
      : db
          .select({
            n: sql<number>`count(*)::int`,
            revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)`,
          })
          .from(orders)
          .where(and(idsFilter, inArray(orders.status, OK), gte(orders.createdAt, prevFrom), lt(orders.createdAt, from))),
    db.execute<{ title: string; image: string | null; quantity: number; revenue: string }>(sql`
      select li->>'title' as title, max(li->>'image') as image,
             sum((li->>'quantity')::int)::int as quantity,
             sum((li->>'quantity')::bigint * (li->>'pricePaise')::bigint) as revenue
      from ${orders}, jsonb_array_elements(${orders.items}) li
      where ${idsFilter} and ${inArray(orders.status, OK)} and ${inRange(orders.createdAt)}
      group by 1 order by 4 desc limit 5`),
    db
      .select({
        id: orders.id, storeId: orders.storeId, customer: orders.customer, method: orders.paymentMethod,
        status: orders.status, total: orders.total, amountPaid: orders.amountPaid, bankDiscount: orders.bankDiscount, createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(idsFilter, inRange(orders.createdAt)))
      .orderBy(desc(orders.createdAt))
      .limit(8),
    db
      .select({ n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${checkoutSessions.cartValue}), 0)` })
      .from(checkoutSessions)
      .where(and(
        inArray(checkoutSessions.storeId, empty ? [-1] : ids),
        gte(checkoutSessions.createdAt, from),
        lt(checkoutSessions.createdAt, to),
        sql`${checkoutSessions.updatedAt} < now() - interval '30 minutes'`,
        sql`not exists (select 1 from ${orders} o where o.session_id = ${checkoutSessions.id} and o.status in ('paid','cod_placed'))`,
      )),
    db.select({ v: sql<string>`coalesce(sum(${orders.refunded}), 0)` }).from(orders).where(and(idsFilter, inRange(orders.createdAt))),
  ]);

  // Ad spend from every connected platform (Meta, Google) of every store
  const spends = await spendFor(storeList.filter((st) => metaReady(st) || googleReady(st)), { since: range.since, until: range.until }, granularity);
  const adErrors: Overview["adErrors"] = [];
  for (const sp of spends) {
    if (sp.meta?.error) adErrors.push({ store: `${sp.store.name} (Meta)`, error: sp.meta.error });
    if (sp.google?.error) adErrors.push({ store: `${sp.store.name} (Google)`, error: sp.google.error });
  }
  const sumOf = (pick: "meta" | "google", f: "spend" | "purchases") => {
    const list = spends.map((x) => x[pick]).filter((x) => x && !x.error);
    return spends.some((x) => x[pick]) ? list.reduce((a, x) => a + x![f], 0) : null;
  };
  const metaSpend = sumOf("meta", "spend"), googleSpend = sumOf("google", "spend");
  const metaPurchases = sumOf("meta", "purchases"), googlePurchases = sumOf("google", "purchases");
  const adSpend = spends.length ? spends.reduce((a, x) => a + (totalOf(x) ?? 0), 0) : null;
  const clicks = await clickOrders(ids, from, to);
  const ads = compare({
    meta: { connected: metaSpend != null, spend: metaSpend, reported: metaPurchases, clickOrders: clicks.meta.orders, clickRevenue: clicks.meta.revenue },
    google: { connected: googleSpend != null, spend: googleSpend, reported: googlePurchases, clickOrders: clicks.google.orders, clickRevenue: clicks.google.revenue },
  });
  const adStores = spends;

  const keys = bucketKeys(range, granularity);
  const map = new Map<string, Bucket>(
    keys.map((k) => [k, { key: k, label: bucketLabel(k, granularity), longLabel: bucketLabel(k, granularity, true), prepaid: 0, cod: 0, orders: 0,
      adSpend: adStores.length && granularity !== "hour" ? 0 : null,
      metaSpend: metaSpend != null && granularity !== "hour" ? 0 : null,
      googleSpend: googleSpend != null && granularity !== "hour" ? 0 : null }]),
  );

  const totals = { revenue: 0, orders: 0, prepaidOrders: 0, codOrders: 0, prepaidRevenue: 0, codRevenue: 0, discounts: 0 };
  for (const r of rows) {
    const rev = Number(r.revenue) / 100;
    const b = map.get(r.bucket);
    totals.revenue += rev;
    totals.orders += r.count;
    totals.discounts += Number(r.discounts) / 100;
    if (r.method !== "prepaid") { totals.codOrders += r.count; totals.codRevenue += rev; if (b) b.cod += rev; }
    else { totals.prepaidOrders += r.count; totals.prepaidRevenue += rev; if (b) b.prepaid += rev; }
    if (b) b.orders += r.count;
  }
  if (granularity !== "hour") {
    for (const sp of spends) for (const pf of ["meta", "google"] as const) {
      const x = sp[pf];
      if (!x || x.error) continue;
      for (const [k, v] of Object.entries(x.series)) {
        const b = map.get(k);
        if (!b) continue;
        b.adSpend = (b.adSpend ?? 0) + v;
        if (pf === "meta") b.metaSpend = (b.metaSpend ?? 0) + v; else b.googleSpend = (b.googleSpend ?? 0) + v;
      }
    }
  }

  const storeName = new Map(storeList.map((s) => [s.id, s.name]));
  const sessionCount = sessions[0]?.n ?? 0;

  return {
    range,
    granularity,
    totals: {
      ...totals,
      aov: totals.orders ? totals.revenue / totals.orders : 0,
      failedPayments: failed[0]?.n ?? 0,
      sessions: sessionCount,
      abandoned: Number(abandonedRows[0]?.n ?? 0),
      abandonedValue: Number(abandonedRows[0]?.value ?? 0) / 100,
      refunded: Number(refundRows[0]?.v ?? 0) / 100,
      conversion: sessionCount ? Math.min(1, totals.orders / sessionCount) : null,
      adSpend,
      roas: adSpend ? totals.revenue / adSpend : null,
      costPerOrder: adSpend != null && totals.orders ? adSpend / totals.orders : null,
      metaPurchases, metaSpend, googleSpend, googlePurchases,
    },
    ads,
    previous: prev ? { revenue: Number(prev[0]?.revenue ?? 0) / 100, orders: prev[0]?.n ?? 0 } : null,
    buckets: [...map.values()],
    topProducts: (top as unknown as { title: string; image: string | null; quantity: number; revenue: string }[]).map((t) => ({
      title: t.title, image: t.image, quantity: Number(t.quantity), revenue: Number(t.revenue) / 100,
    })),
    recent: recent.map((o) => ({
      id: o.id,
      storeName: storeName.get(o.storeId) ?? "",
      name: `${o.customer.firstName} ${o.customer.lastName}`.trim(),
      city: o.customer.city,
      method: o.method,
      status: o.status,
      total: (o.method === "partial" ? o.total - o.bankDiscount : o.amountPaid ?? o.total) / 100,
      createdAt: o.createdAt.toISOString(),
    })),
    adErrors,
    storesWithAds: adStores.length,
  };
}

/** Per-store revenue, orders and ad efficiency for the overview leaderboard. */
export async function loadLeaderboard(storeList: Store[], range: Range) {
  if (storeList.length < 2) return [];
  const { from, to } = istBounds(range);
  const rows = await db
    .select({
      storeId: orders.storeId,
      n: sql<number>`count(*)::int`,
      prepaid: sql<number>`count(*) filter (where ${orders.paymentMethod} <> 'cod')::int`,
      revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)`,
    })
    .from(orders)
    .where(and(inArray(orders.storeId, storeList.map((s) => s.id)), inArray(orders.status, OK), gte(orders.createdAt, from), lt(orders.createdAt, to)))
    .groupBy(orders.storeId);
  const by = new Map(rows.map((r) => [r.storeId, r]));
  const g = granularityFor(range);
  const out = await Promise.all(storeList.map(async (s) => {
    const r = by.get(s.id);
    const revenue = Number(r?.revenue ?? 0) / 100;
    const n = r?.n ?? 0;
    const [sp] = metaReady(s) || googleReady(s) ? await spendFor([s], { since: range.since, until: range.until }, g) : [null];
    const adSpend = sp ? totalOf(sp) : null;
    return {
      id: s.id, name: s.name, revenue, orders: n,
      prepaidShare: n ? Math.round(((r?.prepaid ?? 0) / n) * 100) : null,
      adSpend, roas: adSpend ? revenue / adSpend : null, costPerOrder: adSpend != null && n ? adSpend / n : null,
    };
  }));
  return out.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
}

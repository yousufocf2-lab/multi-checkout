import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { orderValueSql } from "~/lib/order-value.server";
import { checkoutSessions, db, orders, stores, type Store } from "~/db.server";
import { addDays, resolveRange, type Range } from "./dates";
import { storeBaseUrl } from "./urls.server";

export const PAGE = 50;

const OK = sql`('paid','cod_placed')`;
const amountCol = orderValueSql;

export type OrderFilters = {
  status: string; method: string; tag: string; product: string; state: string; q: string;
  min: string; max: string; range: Range;
};

/** WHERE clause for the orders list, the summary and the CSV export. Every filter combines with AND. */
export async function orderFilters(scope: Store[], params: URLSearchParams) {
  const ids = scope.map((s) => s.id);
  const p = new URLSearchParams(params);
  if (!p.get("range")) p.set("range", "max");
  const [first] = ids.length
    ? await db.select({ d: sql<string | null>`to_char(min(${orders.createdAt}) at time zone 'Asia/Kolkata', 'YYYY-MM-DD')` }).from(orders).where(inArray(orders.storeId, ids))
    : [{ d: null }];
  const range = resolveRange(p, first?.d ?? undefined);
  const f: OrderFilters = {
    status: params.get("status") ?? "", method: params.get("method") ?? "", tag: params.get("tag") ?? "",
    product: (params.get("product") ?? "").trim(), state: params.get("state") ?? "", q: (params.get("q") ?? "").trim(),
    min: (params.get("min") ?? "").replace(/[^\d]/g, ""), max: (params.get("max") ?? "").replace(/[^\d]/g, ""), range,
  };

  const where: SQL[] = [inArray(orders.storeId, ids.length ? ids : [-1])];
  // Status: completed (paid online + COD placed) unless asked otherwise
  if (f.status === "failed") where.push(eq(orders.status, "failed"));
  else if (f.status === "pending") where.push(sql`${orders.status} in ('pending_payment','cod_placing')`);
  else if (f.status !== "any") where.push(sql`${orders.status} in ${OK}`);

  if (f.method === "prepaid" || f.method === "cod" || f.method === "partial") where.push(eq(orders.paymentMethod, f.method));
  if (range.preset !== "max") {
    where.push(gte(orders.createdAt, new Date(`${range.since}T00:00:00+05:30`)));
    where.push(lt(orders.createdAt, new Date(`${addDays(range.until, 1)}T00:00:00+05:30`)));
  }
  if (f.min) where.push(sql`${amountCol} >= ${Number(f.min) * 100}`);
  if (f.max) where.push(sql`${amountCol} <= ${Number(f.max) * 100}`);
  if (f.product) where.push(sql`exists (select 1 from jsonb_array_elements(${orders.items}) li where li->>'title' = ${f.product})`);
  if (f.state) where.push(sql`${orders.customer}->>'state' = ${f.state}`);
  if (f.tag === "refunded") where.push(sql`(${orders.refunded} > 0 or ${orders.refundStatus} is not null)`);
  if (f.tag === "not_synced") where.push(sql`${orders.status} in ${OK} and ${orders.shopifyOrderId} is null`);
  if (f.tag === "coupon") where.push(isNotNull(orders.couponCode));
  if (f.tag === "bank") where.push(sql`${orders.bankDiscount} > 0`);
  if (f.tag === "paid_shipping") where.push(sql`${orders.shipping} > 0`);
  if (f.tag === "free_shipping") where.push(sql`${orders.shipping} = 0`);
  if (f.q) {
    const like = `%${f.q}%`;
    where.push(or(
      ilike(orders.id, like),
      ilike(orders.shopifyOrderName, like),
      sql`${orders.customer}->>'phone' ilike ${like}`,
      sql`(${orders.customer}->>'firstName') || ' ' || (${orders.customer}->>'lastName') ilike ${like}`,
      sql`${orders.customer}->>'city' ilike ${like}`,
    )!);
  }
  return { where: and(...where)!, filters: f };
}

export async function loadOrders(scope: Store[], params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page")) || 1);
  const ids = scope.map((s) => s.id);
  const { where, filters } = await orderFilters(scope, params);
  const [rows, [sum], products] = await Promise.all([
    db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(PAGE + 1).offset((page - 1) * PAGE),
    db.select({
      n: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${amountCol} - ${orders.refunded}), 0)`,
      prepaid: sql<number>`count(*) filter (where ${orders.paymentMethod} <> 'cod')::int`,
      cod: sql<number>`count(*) filter (where ${orders.paymentMethod} = 'cod')::int`,
    }).from(orders).where(where),
    db.execute<{ title: string }>(sql`
      select li->>'title' as title from ${orders}, jsonb_array_elements(${orders.items}) li
      where ${inArray(orders.storeId, ids.length ? ids : [-1])} and ${orders.status} in ${OK}
      group by 1 order by count(*) desc limit 300`),
  ]);
  const names = new Map(scope.map((s) => [s.id, s.name]));
  const n = sum?.n ?? 0;
  const value = Number(sum?.value ?? 0) / 100;
  return {
    orders: rows.slice(0, PAGE).map((o) => ({ ...o, storeName: names.get(o.storeId) ?? "" })),
    hasMore: rows.length > PAGE,
    page,
    filters,
    summary: { count: n, value, prepaid: sum?.prepaid ?? 0, cod: sum?.cod ?? 0, aov: n ? value / n : 0 },
    products: (products as unknown as { title: string }[]).map((r) => r.title).filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
}

/** Checkouts with no successful order, idle for 30+ minutes. */
export async function loadAbandoned(scope: Store[], params: URLSearchParams) {
  const ids = scope.map((s) => s.id);
  const p = new URLSearchParams(params);
  if (!p.get("range")) p.set("range", "7d");
  const range = resolveRange(p);
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const withPhone = params.get("all") !== "1";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const where: SQL[] = [
    inArray(checkoutSessions.storeId, ids.length ? ids : [-1]),
    gte(checkoutSessions.createdAt, from),
    lt(checkoutSessions.createdAt, to),
    sql`${checkoutSessions.updatedAt} < now() - interval '30 minutes'`,
    sql`not exists (select 1 from ${orders} o where o.session_id = ${checkoutSessions.id} and o.status in ('paid','cod_placed'))`,
    isNotNull(checkoutSessions.cartSnapshot),
  ];
  if (withPhone) where.push(sql`length(coalesce(${checkoutSessions.customer}->>'phone', '')) = 10`);

  const rows = await db
    .select({ s: checkoutSessions, store: { id: stores.id, name: stores.name, checkoutDomain: stores.checkoutDomain } })
    .from(checkoutSessions)
    .innerJoin(stores, eq(checkoutSessions.storeId, stores.id))
    .where(and(...where))
    .orderBy(desc(checkoutSessions.updatedAt))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);

  const [totals] = await db
    .select({ n: sql<number>`count(*)::int`, value: sql<string>`coalesce(sum(${checkoutSessions.cartValue}), 0)` })
    .from(checkoutSessions)
    .where(and(...where));

  return {
    range,
    withPhone,
    page,
    hasMore: rows.length > PAGE,
    count: totals?.n ?? 0,
    value: Number(totals?.value ?? 0) / 100,
    items: rows.slice(0, PAGE).map(({ s, store }) => {
      const c = s.customer ?? {};
      const link = `${storeBaseUrl(store)}/c/${s.id}`;
      const expired = Date.now() - s.createdAt.getTime() > 7 * 86400_000;
      return {
        id: s.id,
        storeName: store.name,
        name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        phone: c.phone ?? "",
        city: c.city ?? "",
        cart: s.cartSnapshot ?? [],
        value: (s.cartValue ?? 0) / 100,
        stage: s.paymentAttempted ? "Payment not completed" : c.phone ? "Left after contact details" : "Left at cart",
        lastActive: s.updatedAt.toISOString(),
        link: expired ? null : link,
      };
    }),
  };
}

import { json } from "@remix-run/node";
import { requireStore, type Viewer } from "./auth.server";
import { pushToShopify, syncOrderWithPayu } from "./orders.server";

/** Row actions on the orders list: send to Shopify, check payment with PayU. */
export async function handleOrderAction(viewer: Viewer, fd: FormData) {
  const store = await requireStore(viewer, String(fd.get("storeId") ?? ""));
  const [o] = await db.select().from(orders).where(and(eq(orders.id, String(fd.get("orderId"))), eq(orders.storeId, store.id)));
  if (!o) return json({ ok: null, error: "Order not found" });
  const intent = fd.get("intent");
  if (intent === "retry") {
    if (!["paid", "cod_placed"].includes(o.status)) return json({ ok: null, error: "This order can't be sent to Shopify" });
    const r = await pushToShopify(store, o);
    return r.shopifyOrderId ? json({ ok: `Created ${r.shopifyOrderName} in Shopify`, error: null }) : json({ ok: null, error: r.error ?? "Shopify rejected the order" });
  }
  if (intent === "verify") {
    try {
      const r = await syncOrderWithPayu(store, o, "dashboard");
      const label = r.status === "paid" ? "PayU confirms this payment succeeded. The order is marked paid." : r.status === "failed" ? "PayU says this payment failed." : "PayU hasn't confirmed this payment yet.";
      return json({ ok: label, error: null });
    } catch (e) {
      return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't reach PayU" });
    }
  }
  return json({ ok: null, error: "Unknown action" });
}

import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, notInArray, not as negate, or, sql, type SQL } from "drizzle-orm";
import { orderValueSql } from "~/lib/order-value.server";
import { checkoutSessions, db, orders, stores, type Store } from "~/db.server";
import { addDays, resolveRange, type Range } from "./dates";
import { storeBaseUrl } from "./urls.server";
import { liveSessions } from "./live.server";

export const PAGE = 50;

const OK = sql`('paid','cod_placed')`;
const amountCol = orderValueSql;

export type OrderFilters = {
  status: string; method: string; tag: string; product: string; state: string; q: string;
  min: string; max: string; paymentStatus: string; fulfillment: string; deliveryStatus: string; returnStatus: string; labelStatus: string; deliveryMethod: string; range: Range;
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
    paymentStatus: params.get("payment_status") ?? "", fulfillment: params.get("fulfillment") ?? "", deliveryStatus: params.get("delivery_status") ?? "",
    returnStatus: params.get("return_status") ?? "", labelStatus: params.get("label_status") ?? "", deliveryMethod: params.get("delivery_method") ?? "",
  };

  const where: SQL[] = [inArray(orders.storeId, ids.length ? ids : [-1])];
  const push = (key: string, condition: SQL) => where.push(params.get(`${key}_not`) === "1" ? negate(condition) : condition);
  // Status: completed (paid online + COD placed) unless asked otherwise
  if (f.status === "failed") push("status", eq(orders.status, "failed"));
  else if (f.status === "cancelled") push("status", eq(orders.status, "cancelled"));
  else if (f.status === "pending") push("status", sql`${orders.status} in ('pending_payment','cod_placing')`);
  else if (f.status === "refunded") push("status", sql`${orders.refundStatus} = 'full'`);
  else if (f.status === "open") push("status", sql`${orders.status} in ('paid','cod_placed','pending_payment','cod_placing')`);
  else if (f.status === "any") { /* All statuses */ }
  else if (f.status) push("status", sql`${orders.status} in ${OK}`);
  else where.push(sql`${orders.status} in ${OK}`);

  if (f.method === "prepaid" || f.method === "cod" || f.method === "partial") push("method", eq(orders.paymentMethod, f.method));
  if (f.paymentStatus === "paid") push("payment_status", sql`${orders.status} = 'paid'`);
  if (f.paymentStatus === "pending") push("payment_status", sql`${orders.paymentMethod} = 'cod' or ${orders.status} in ('pending_payment','cod_placing')`);
  if (f.paymentStatus === "refunded") push("payment_status", sql`${orders.refundStatus} = 'full'`);
  if (f.paymentStatus === "partially_refunded") push("payment_status", sql`${orders.refundStatus} = 'partial'`);
  if (f.paymentStatus === "failed") push("payment_status", eq(orders.status, "failed"));
  if (f.fulfillment === "fulfilled") push("fulfillment", isNotNull(orders.awb));
  if (f.fulfillment === "unfulfilled") push("fulfillment", sql`${orders.status} in ${OK} and ${orders.awb} is null`);
  if (f.deliveryStatus) push("delivery_status", sql`${orders.shipStatus} = ${f.deliveryStatus}`);
  if (f.returnStatus === "returned") push("return_status", sql`${orders.shipStatus} in ('rto','rto_transit','returned')`);
  if (f.returnStatus === "not_returned") push("return_status", sql`${orders.shipStatus} is null or ${orders.shipStatus} not in ('rto','rto_transit','returned')`);
  if (f.labelStatus === "added") push("label_status", isNotNull(orders.awb));
  if (f.labelStatus === "not_added") push("label_status", sql`${orders.awb} is null`);
  if (f.deliveryMethod) push("delivery_method", eq(orders.shippingTitle, f.deliveryMethod));
  if (range.preset !== "max") {
    where.push(gte(orders.createdAt, new Date(`${range.since}T00:00:00+05:30`)));
    where.push(lt(orders.createdAt, new Date(`${addDays(range.until, 1)}T00:00:00+05:30`)));
  }
  if (f.min) where.push(sql`${amountCol} >= ${Number(f.min) * 100}`);
  if (f.max) where.push(sql`${amountCol} <= ${Number(f.max) * 100}`);
  if (f.product) push("product", sql`exists (select 1 from jsonb_array_elements(${orders.items}) li where li->>'title' = ${f.product})`);
  if (f.state) push("state", sql`${orders.customer}->>'state' = ${f.state}`);
  if (f.tag === "refunded") push("tag", sql`(${orders.refunded} > 0 or ${orders.refundStatus} is not null)`);
  else if (f.tag === "not_synced") push("tag", sql`${orders.status} in ${OK} and ${orders.shopifyOrderId} is null`);
  else if (f.tag === "coupon") push("tag", isNotNull(orders.couponCode));
  else if (f.tag === "bank") push("tag", sql`${orders.bankDiscount} > 0`);
  else if (f.tag === "paid_shipping") push("tag", sql`${orders.shipping} > 0`);
  else if (f.tag === "free_shipping") push("tag", sql`${orders.shipping} = 0`);
  else if (f.tag === "Smart Checkout") push("tag", sql`${orders.checkoutChannel} = 'premium_checkout' or (${orders.checkoutChannel} is null and ${orders.sessionId} is not null and exists (select 1 from stores st where st.id = ${orders.storeId} and st.smart_checkout = true))`);
  else if (f.tag === "Shopify History") push("tag", sql`${orders.checkoutChannel} = 'shopify_history'`);
  else if (f.tag === "WhatsApp") push("tag", sql`${orders.confirmStatus} is not null or ${orders.waMessageId} is not null`);
  else if (f.tag) push("tag", sql`${orders.manualTags} @> ${JSON.stringify([f.tag])}::jsonb`);
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
  const [rows, [sum], products, tagRows] = await Promise.all([
    db.select({ order: orders, store: { platform: stores.platform, smartCheckout: stores.smartCheckout } }).from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId)).where(where).orderBy(desc(orders.createdAt)).limit(PAGE + 1).offset((page - 1) * PAGE),
    db.select({
      n: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${amountCol} - ${orders.refunded}), 0)`,
      prepaid: sql<number>`count(*) filter (where ${orders.paymentMethod} <> 'cod')::int`,
      cod: sql<number>`count(*) filter (where ${orders.paymentMethod} = 'cod')::int`,
      items: sql<number>`coalesce(sum((select coalesce(sum((li->>'quantity')::int), 0) from jsonb_array_elements(${orders.items}) li)), 0)::int`,
      fulfilled: sql<number>`count(*) filter (where ${orders.awb} is not null)::int`,
      delivered: sql<number>`count(*) filter (where ${orders.shipStatus} = 'delivered')::int`,
      returned: sql<number>`count(*) filter (where ${orders.shipStatus} in ('rto', 'rto_transit', 'returned') or ${orders.refundStatus} is not null)::int`,
    }).from(orders).where(where),
    db.execute<{ title: string }>(sql`
      select li->>'title' as title from ${orders}, jsonb_array_elements(${orders.items}) li
      where ${inArray(orders.storeId, ids.length ? ids : [-1])} and ${orders.status} in ${OK}
      group by 1 order by count(*) desc limit 300`),
    db.select({ manualTags: orders.manualTags }).from(orders).where(inArray(orders.storeId, ids.length ? ids : [-1])).limit(1000),
  ]);
  const names = new Map(scope.map((s) => [s.id, s.name]));
  const n = sum?.n ?? 0;
  const value = Number(sum?.value ?? 0) / 100;
  return {
    orders: rows.slice(0, PAGE).map(({ order: o, store }) => {
      const premium = o.checkoutChannel === "premium_checkout" || (!o.checkoutChannel && Boolean(o.sessionId && store.smartCheckout));
      const history = o.checkoutChannel === "shopify_history";
      return { ...o, storeName: names.get(o.storeId) ?? "", channel: history ? "Shopify History" : premium ? "Premium Checkout" : "Native", tags: [...new Set([...(o.manualTags ?? []), ...(history ? ["Shopify History"] : []), ...(premium ? ["Smart Checkout"] : []), ...(o.confirmStatus || o.waMessageId ? ["WhatsApp"] : [])])] };
    }),
    hasMore: rows.length > PAGE,
    page,
    filters,
    summary: { count: n, value, prepaid: sum?.prepaid ?? 0, cod: sum?.cod ?? 0, aov: n ? value / n : 0, items: sum?.items ?? 0, fulfilled: sum?.fulfilled ?? 0, delivered: sum?.delivered ?? 0, returned: sum?.returned ?? 0 },
    products: (products as unknown as { title: string }[]).map((r) => r.title).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    tagOptions: [...new Set(tagRows.flatMap((r) => r.manualTags ?? []).concat("Smart Checkout", "WhatsApp"))].sort((a, b) => a.localeCompare(b)),
    deliveryOptions: [...new Set(rows.map(({ order }) => order.shippingTitle).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b)),
    couriers: await courierChoices(ids),
    cancelReasons: [...CANCEL_REASONS],
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
    // Abandoned a few minutes after the last activity, as long as nobody is still on that checkout page
    sql`${checkoutSessions.updatedAt} < now() - interval '3 minutes'`,
    sql`not exists (select 1 from ${orders} o where o.session_id = ${checkoutSessions.id} and o.status in ('paid','cod_placed'))`,
    isNotNull(checkoutSessions.cartSnapshot),
  ];
  const stillOpen = [...liveSessions(ids)];
  if (stillOpen.length) where.push(notInArray(checkoutSessions.id, stillOpen));
  if (withPhone) where.push(sql`length(coalesce(${checkoutSessions.customer}->>'phone', '')) = 10`);

  const rows = await db
    .select({ s: checkoutSessions, store: { id: stores.id, name: stores.name, slug: stores.slug, checkoutDomain: stores.checkoutDomain } })
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
        stage: s.paymentAttempted ? "Payment not completed" : c.address1 ? "Left after address" : c.phone ? "Left after contact details" : "Left at cart",
        lastActive: s.updatedAt.toISOString(),
        link: expired ? null : link,
      };
    }),
  };
}

import { json } from "@remix-run/node";
import { can, requireStore, type Viewer } from "./auth.server";
import { CANCEL_REASONS, cancelOrders, courierChoices, shipOrders } from "./order-actions.server";
import { pushToShopify } from "./orders.server";
import { syncOrderPayment } from "./gateways/index.server";
import { gatewayName } from "./gateways/catalog";
import { importShopifyOrdersCsv } from "./shopify-order-import.server";
import { readAddress, updateOrderAddress, updateOrderNotes } from "./order-edit.server";

/** Row actions on the orders list: send to Shopify, check payment with the gateway. */
export async function handleOrderAction(viewer: Viewer, fd: FormData) {
  const intent = fd.get("intent");
  if (intent === "import_shopify_history") {
    const store = await requireStore(viewer, String(fd.get("storeId") ?? ""));
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return json({ ok: null, error: "Choose Shopify's Orders CSV first." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return json({ ok: null, error: "Order CSV must be smaller than 20 MB." }, { status: 400 });
    try {
      const result = await importShopifyOrdersCsv(store, await file.text());
      return json({ ok: `Imported ${result.imported} historical orders. ${result.alreadyPresent} were already present; no messages or purchase events were sent.`, error: null });
    } catch (e) {
      return json({ ok: null, error: e instanceof Error ? e.message : "Order import failed." }, { status: 400 });
    }
  }
  const by = viewer.role === "admin" ? (viewer.staff?.name ?? "Growpefy") : (viewer.member?.name ?? viewer.name);
  // Ship / cancel one or many orders (the list may hold orders of several stores)
  if (intent === "ship" || intent === "cancel") {
    if (!can(viewer, "orders")) return json({ ok: null, error: "You don't have permission to change orders." });
    const ids = String(fd.get("orderIds") ?? fd.get("orderId") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);
    if (!ids.length) return json({ ok: null, error: "Select at least one order." });
    const rows = await db.select({ id: orders.id, storeId: orders.storeId }).from(orders).where(inArray(orders.id, ids));
    const byStore = new Map<number, string[]>();
    for (const r of rows) byStore.set(r.storeId, [...(byStore.get(r.storeId) ?? []), r.id]);
    const ok: string[] = [], errs: string[] = [], notes: string[] = [];
    let refunded = 0, pending = 0;
    for (const [sid, list] of byStore) {
      const st = await requireStore(viewer, sid).catch(() => null);
      if (!st) continue;
      if (intent === "ship") {
        const r = await shipOrders(st, list, String(fd.get("courier") ?? "") || null, by);
        ok.push(...r.shipped);
        errs.push(...r.failed.map((f) => (f.name ? `${f.name}: ${f.error}` : f.error)));
        if (r.shipped.length && "courier" in r) notes.push(`Booked with ${r.courier}.`);
      } else {
        const r = await cancelOrders(st, list, { refund: fd.get("refund") === "1", reason: String(fd.get("reason") ?? "Other").slice(0, 200) || "Other", by });
        ok.push(...r.done); errs.push(...r.failed.map((f) => `${f.name}: ${f.error}`)); notes.push(...r.notes);
        refunded += r.refunded; pending += r.refundsPending;
      }
    }
    const verb = intent === "ship" ? "shipped" : "cancelled";
    const head = ok.length ? `${ok.length === 1 ? ok[0] : `${ok.length} orders`} ${verb}.` : "";
    const money = refunded + pending ? ` Refund started for ${refunded + pending} order${refunded + pending === 1 ? "" : "s"}; it reaches the customer in 5–7 working days.` : "";
    return json({ ok: head ? `${head}${money}${notes.length ? ` ${notes.join(" ")}` : ""}` : null, error: errs.length ? errs.slice(0, 6).join(" · ") + (errs.length > 6 ? ` · and ${errs.length - 6} more` : "") : head ? null : "Nothing was changed." });
  }
  const store = await requireStore(viewer, String(fd.get("storeId") ?? ""));
  const [o] = await db.select().from(orders).where(and(eq(orders.id, String(fd.get("orderId"))), eq(orders.storeId, store.id)));
  if (!o) return json({ ok: null, error: "Order not found" });
  if (intent === "tagAdd" || intent === "tagRemove") {
    const tag = String(fd.get("tag") ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
    if (!tag || tag.length < 2) return json({ ok: null, error: "Tags must contain 2–32 characters." });
    const tags = [...new Set(o.manualTags ?? [])];
    const next = intent === "tagAdd" ? [...new Set([...tags, tag])].slice(0, 12) : tags.filter((t) => t !== tag);
    await db.update(orders).set({ manualTags: next, updatedAt: new Date() }).where(eq(orders.id, o.id));
    return json({ ok: intent === "tagAdd" ? "Tag added." : "Tag removed.", error: null });
  }
  if (intent === "address") {
    const r = await updateOrderAddress(store, o, readAddress(fd), by);
    return "error" in r ? json({ ok: null, error: r.error }) : json({ ok: r.ok, error: null });
  }
  if (intent === "notes") {
    const r = await updateOrderNotes(o, { staff: String(fd.get("staffNote") ?? ""), customer: String(fd.get("customerNote") ?? "") }, by);
    return json({ ok: r.ok, error: null });
  }
  if (intent === "retry") {
    if (!["paid", "cod_placed"].includes(o.status)) return json({ ok: null, error: "This order can't be sent to Shopify" });
    const r = await pushToShopify(store, o);
    return r.shopifyOrderId ? json({ ok: `Created ${r.shopifyOrderName} in Shopify`, error: null }) : json({ ok: null, error: r.error ?? "Shopify rejected the order" });
  }
  if (intent === "verify") {
    try {
      const r = await syncOrderPayment(store, o, "dashboard");
      const by = gatewayName(r.gateway ?? o.gateway ?? "payu");
      const label = r.status === "paid" ? `${by} confirms this payment succeeded. The order is marked paid.` : r.status === "failed" ? `${by} says this payment failed.` : `${by} hasn't confirmed this payment yet.`;
      return json({ ok: label, error: null });
    } catch (e) {
      return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't reach the payment gateway" });
    }
  }
  return json({ ok: null, error: "Unknown action" });
}

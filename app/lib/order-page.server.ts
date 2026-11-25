// Everything the order page shows: the order, the customer's history, where the order came from, the IP and
// its location, the call log, and the next / previous order in the list the page was opened from.
import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { db, orderCallEvents, orders, stores, teamMembers, type Store } from "~/db.server";
import type { Viewer } from "./auth.server";
import { can, requireStore } from "./auth.server";
import { cleanGeo, type Geo } from "./geo";
import { lookupIp } from "./geo.server";
import { CANCEL_REASONS, courierChoices } from "./order-actions.server";
import { orderFilters } from "./orders-list.server";
import { orderSource } from "./order-source";
import { stateName } from "./states";
import { trackingUrl } from "./customer-accounts";
import { storeBaseUrl } from "./urls.server";

export async function loadOrderPage(viewer: Viewer, orderId: string, scope: Store[], listParams: URLSearchParams) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) throw new Response("Order not found", { status: 404 });
  const store = await requireStore(viewer, o.storeId); // 404 for orders of other owners' stores
  const t = o.tracking ?? {};
  const ip = t.ip ?? null;

  // City of the IP: saved on the order once it's known (looked up the first time the page opens)
  let geo: Geo | null = cleanGeo(t.geo);
  if (!geo && ip) {
    geo = await lookupIp(ip);
    if (geo) await db.execute(sql`update orders set tracking = coalesce(tracking, '{}'::jsonb) || jsonb_build_object('geo', ${JSON.stringify(geo)}::jsonb) where id = ${o.id}`).catch(() => null);
  }

  const phone = (o.customer?.phone ?? "").replace(/\D/g, "").slice(-10);
  const inScope = scope.some((s) => s.id === o.storeId) ? scope : [store];
  const { where } = await orderFilters(inScope, listParams);

  const [history, sameIp, calls, newer, older, couriers, members] = await Promise.all([
    phone.length === 10
      ? db.select({
          n: sql<number>`count(*)::int`,
          spent: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('paid','cod_placed')), 0)`,
          rto: sql<number>`count(*) filter (where ${orders.shipStatus} in ('rto','rto_transit'))::int`,
          delivered: sql<number>`count(*) filter (where ${orders.shipStatus} = 'delivered')::int`,
          first: sql<string | null>`min(${orders.createdAt})::text`,
        }).from(orders).where(and(eq(orders.storeId, o.storeId), sql`right(regexp_replace(${orders.customer}->>'phone', '\\D', '', 'g'), 10) = ${phone}`))
      : Promise.resolve([{ n: 1, spent: String(o.total), rto: 0, delivered: 0, first: null }]),
    ip
      ? db.select({ id: orders.id, name: orders.shopifyOrderName, phone: sql<string>`${orders.customer}->>'phone'`, createdAt: orders.createdAt, status: orders.status }).from(orders)
          .where(and(eq(orders.storeId, o.storeId), ne(orders.id, o.id), sql`${orders.tracking}->>'ip' = ${ip}`, gt(orders.createdAt, new Date(Date.now() - 90 * 86400_000))))
          .orderBy(desc(orders.createdAt)).limit(6)
      : Promise.resolve([]),
    db.select({ actor: orderCallEvents.actor, kind: orderCallEvents.kind, provider: orderCallEvents.provider, at: orderCallEvents.createdAt })
      .from(orderCallEvents).where(eq(orderCallEvents.orderId, o.id)).orderBy(desc(orderCallEvents.createdAt)).limit(20),
    db.select({ id: orders.id }).from(orders).where(and(where, sql`(${orders.createdAt}, ${orders.id}) > (${o.createdAt}, ${o.id})`))
      .orderBy(asc(orders.createdAt), asc(orders.id)).limit(1),
    db.select({ id: orders.id }).from(orders).where(and(where, sql`(${orders.createdAt}, ${orders.id}) < (${o.createdAt}, ${o.id})`))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(1),
    courierChoices([o.storeId]),
    o.assignedTo || o.ofdAssignedTo
      ? db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).where(sql`${teamMembers.id} in (${o.assignedTo ?? -1}, ${o.ofdAssignedTo ?? -1})`)
      : Promise.resolve([]),
  ]);
  const [storeRow] = await db.select({ name: stores.name, platform: stores.platform, smartCheckout: stores.smartCheckout }).from(stores).where(eq(stores.id, o.storeId)).limit(1);

  const premium = o.checkoutChannel === "premium_checkout" || (!o.checkoutChannel && Boolean(o.sessionId && storeRow?.smartCheckout));
  const historyImport = o.checkoutChannel === "shopify_history";
  const h = history[0];
  const deliveryState = stateName(o.customer.state);
  const ipState = geo?.cc === "IN" ? geo.region : null;
  const stateMismatch = Boolean(ipState && deliveryState && !sameState(ipState, deliveryState));
  const memberName = (id: number | null) => (id ? members.find((m) => m.id === id)?.name ?? null : null);

  return {
    order: {
      ...o,
      tracking: { ...t, geo: geo ?? undefined },
      storeName: storeRow?.name ?? store.name,
      channel: historyImport ? "Shopify History" : premium ? "Premium Checkout" : "Native",
      tags: [...new Set([...(o.manualTags ?? []), ...(historyImport ? ["Shopify History"] : []), ...(premium ? ["Smart Checkout"] : []), ...(o.confirmStatus || o.waMessageId ? ["WhatsApp"] : []), ...(o.callStatus ? [o.callStatus === "confirmed" ? "Confirmed on call" : o.callStatus === "cancelled" ? "Cancelled on call" : "Call follow-up"] : [])])],
    },
    source: orderSource(o.tracking, o.checkoutChannel),
    customer: {
      orders: h?.n ?? 1,
      spentPaise: Number(h?.spent ?? 0),
      rto: h?.rto ?? 0,
      delivered: h?.delivered ?? 0,
      since: h?.first ?? null,
      phone,
    },
    ip: ip ? { address: ip, geo, sameIp: sameIp.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), samePhone: (r.phone ?? "").replace(/\D/g, "").slice(-10) === phone })), stateMismatch, deliveryState } : null,
    ua: t.ua ?? null,
    landing: t.sourceUrl && !t.sourceUrl.startsWith("draft:") ? t.sourceUrl : null,
    calls: calls.map((c) => ({ ...c, at: c.at.toISOString() })),
    assigned: { confirm: memberName(o.assignedTo), ofd: memberName(o.ofdAssignedTo) },
    trackUrl: trackingUrl(o.courier, o.awb),
    customerLink: `${storeBaseUrl(store)}/order/${o.id}`,
    nav: { newer: newer[0]?.id ?? null, older: older[0]?.id ?? null },
    couriers,
    cancelReasons: [...CANCEL_REASONS],
    canEdit: can(viewer, "orders"),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/^nct(of)?/, "").replace(/^nationalcapitalterritoryof/, "");
/** "National Capital Territory of Delhi" vs "Delhi", "Orissa" vs "Odisha"… */
function sameState(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const alias: Record<string, string> = { orissa: "odisha", pondicherry: "puducherry", uttaranchal: "uttarakhand" };
  return (alias[x] ?? x) === (alias[y] ?? y);
}

// Delivery-day calling. When a parcel goes out for delivery, a team member with the "ofd_calls" permission gets it
// (round-robin) and calls the customer: Ready (will take it), Follow-up (call again) or Denied. Every new delivery
// attempt (2nd, 3rd…) comes back to them. Failed deliveries (NDR) can be sent for a re-attempt through the courier API.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db, ofdCallEvents, orders, stores, teamMembers, type OrderEvent, type Store } from "~/db.server";
import { accountForOrder } from "./logistics.server";
import { delhiveryReattempt } from "./couriers/delhivery.server";

export const OFD_PERM = "ofd_calls";
const WINDOW_DAYS = 4; // out-for-delivery parcels older than this aren't queued

export async function ofdCallersFor(store: Pick<Store, "id" | "ownerId">) {
  if (!store.ownerId) return [];
  const rows = await db.select({ id: teamMembers.id, name: teamMembers.name, perms: teamMembers.perms, storeIds: teamMembers.storeIds, expiresAt: teamMembers.expiresAt })
    .from(teamMembers).where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.ownerId, store.ownerId), eq(teamMembers.active, true))).orderBy(asc(teamMembers.id));
  return rows.filter((m) => m.perms.includes(OFD_PERM) && (!m.storeIds || m.storeIds.includes(store.id)) && (!m.expiresAt || m.expiresAt > new Date()))
    .map((m) => ({ id: m.id, name: m.name }));
}

/** Gives each parcel out for delivery (or failed, NDR) without a caller to the next caller in turn. */
export async function assignOfd(store: Store) {
  const team = await ofdCallersFor(store);
  if (!team.length) return 0;
  const ids = team.map((m) => m.id);
  const waiting = await db.select({ id: orders.id }).from(orders).where(and(
    eq(orders.storeId, store.id), inArray(orders.shipStatus, ["out_for_delivery", "ndr"]),
    gte(orders.ofdAt, new Date(Date.now() - WINDOW_DAYS * 86400_000)),
    or(isNull(orders.ofdAssignedTo), notInArray(orders.ofdAssignedTo, ids)),
  )).orderBy(asc(orders.ofdAt)).limit(1000);
  if (!waiting.length) return 0;
  let rr = store.ofdRr ?? 0;
  for (const o of waiting) {
    const m = team[rr % team.length];
    rr++;
    await db.update(orders).set({ ofdAssignedTo: m.id }).where(eq(orders.id, o.id));
  }
  await db.update(stores).set({ ofdRr: rr % 1_000_000 }).where(eq(stores.id, store.id));
  return waiting.length;
}

export async function assignAllOfd() {
  const owners = await db.selectDistinct({ ownerId: teamMembers.ownerId }).from(teamMembers)
    .where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.active, true), sql`${teamMembers.perms} @> ${JSON.stringify([OFD_PERM])}::jsonb`));
  const ids = owners.map((o) => o.ownerId).filter((x): x is number => x != null);
  if (!ids.length) return;
  for (const s of await db.select().from(stores).where(inArray(stores.ownerId, ids))) await assignOfd(s).catch((e) => console.error("[ofd-calls] assign", s.id, e));
}

export const OFD_TABS = ["to_call", "follow_up", "ready", "denied", "ndr", "delivered", "all"] as const;
export type OfdTab = (typeof OFD_TABS)[number];

/** Which tab a parcel is in. NDR and delivered win over the call outcome (that's what matters now). */
const bucket = sql<OfdTab>`case
  when ${orders.shipStatus} = 'delivered' then 'delivered'
  when ${orders.shipStatus} = 'ndr' then 'ndr'
  when ${orders.shipStatus} in ('rto','rto_transit','returned','cancelled') then 'all'
  when ${orders.ofdCallStatus} = 'ready' then 'ready'
  when ${orders.ofdCallStatus} = 'denied' then 'denied'
  when ${orders.ofdCallStatus} = 'follow_up' then 'follow_up'
  else 'to_call' end`;

import { ordinal } from "./ofd";
export { ordinal };

/**
 * The delivery-day board. `me` = caller's member id (null = owner / manager, who see everything).
 * `from`/`to` limit by when the parcel went out for delivery.
 */
export async function ofdBoard(store: Store, me: number | null, tab: OfdTab, from: Date | null, to: Date | null, query = "") {
  await assignOfd(store);
  const team = await ofdCallersFor(store);
  const nameOf = new Map(team.map((t) => [t.id, t.name]));
  const base = and(
    eq(orders.storeId, store.id), isNotNull(orders.ofdAt),
    me == null ? undefined : eq(orders.ofdAssignedTo, me),
    from ? gte(orders.ofdAt, from) : undefined, to ? lt(orders.ofdAt, to) : undefined,
  );
  // Live queue (to call / follow-up / NDR): every open parcel, whatever the date filter
  const live = and(eq(orders.storeId, store.id), me == null ? undefined : eq(orders.ofdAssignedTo, me), inArray(orders.shipStatus, ["out_for_delivery", "ndr"]),
    gte(orders.ofdAt, new Date(Date.now() - 30 * 86400_000)));
  const term = query.replace(/[\\%_]/g, "\\$&");
  const digits = query.replace(/\D/g, "");
  const match = query ? or(
    sql`${orders.shopifyOrderName} ilike ${`%${term}%`}`, sql`${orders.awb} ilike ${`%${term}%`}`,
    sql`concat_ws(' ', ${orders.customer}->>'firstName', ${orders.customer}->>'lastName') ilike ${`%${term}%`}`,
    digits.length >= 5 ? sql`${orders.customer}->>'phone' like ${`%${digits.slice(-10)}%`}` : undefined,
  ) : undefined;
  const scopeFor = (t: OfdTab) => (t === "to_call" || t === "follow_up" || t === "ndr" ? and(live, sql`${bucket} = ${t}`) : t === "all" ? base : and(base, sql`${bucket} = ${t}`));
  const [liveCounts, rangeCounts] = await Promise.all([
    db.select({ t: bucket, n: sql<number>`count(*)::int` }).from(orders).where(live).groupBy(bucket),
    db.select({ t: bucket, n: sql<number>`count(*)::int` }).from(orders).where(base).groupBy(bucket),
  ]);
  const lc = Object.fromEntries(liveCounts.map((r) => [r.t, r.n])) as Partial<Record<OfdTab, number>>;
  const rc = Object.fromEntries(rangeCounts.map((r) => [r.t, r.n])) as Partial<Record<OfdTab, number>>;
  const counts: Record<OfdTab, number> = {
    to_call: lc.to_call ?? 0, follow_up: lc.follow_up ?? 0, ndr: lc.ndr ?? 0,
    ready: rc.ready ?? 0, denied: rc.denied ?? 0, delivered: rc.delivered ?? 0,
    all: Object.values(rc).reduce((a, b) => a + (b ?? 0), 0),
  };
  const rows = await db.select({
    id: orders.id, name: orders.shopifyOrderName, customer: orders.customer, items: orders.items, method: orders.paymentMethod, total: orders.total,
    advance: orders.advance, amountPaid: orders.amountPaid, awb: orders.awb, courier: orders.courier, ship: orders.shipStatus, raw: orders.shipStatusRaw,
    attempts: orders.ofdAttempts, ofdAt: orders.ofdAt, ndrReason: orders.ndrReason, ndrAt: orders.ndrAt, reattemptAt: orders.reattemptAt,
    call: orders.ofdCallStatus, callAt: orders.ofdCallAt, callBy: orders.ofdCallBy, followUpAt: orders.ofdFollowUpAt, assignedTo: orders.ofdAssignedTo,
    timeline: orders.timeline, tab: bucket,
  }).from(orders).where(and(scopeFor(tab), match))
    // Fresh parcels (1st attempt) first, then 2nd, 3rd… attempts
    .orderBy(asc(orders.ofdAttempts), tab === "follow_up" ? sql`${orders.ofdFollowUpAt} asc nulls last` : desc(orders.ofdAt), desc(orders.id)).limit(200);

  const stats = await ofdStats(store.id, me, from, to);
  return {
    me, counts, stats,
    team: team.map((t) => ({ ...t, you: t.id === me })),
    items: rows.map((r) => ({
      id: r.id, name: r.name ?? `#${r.id.slice(-6).toUpperCase()}`,
      customer: { name: `${r.customer.firstName ?? ""} ${r.customer.lastName ?? ""}`.trim(), phone: r.customer.phone, city: r.customer.city, pincode: r.customer.pincode, address: [r.customer.address1, r.customer.address2].filter(Boolean).join(", "), state: r.customer.state },
      items: r.items.map((l) => `${l.title}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`),
      method: r.method, total: r.total, toCollect: r.method === "cod" ? r.total : r.method === "partial" ? r.total - (r.amountPaid ?? r.advance ?? 0) : 0,
      awb: r.awb, courier: r.courier, ship: r.ship, raw: r.raw, attempts: r.attempts, ofdAt: r.ofdAt?.toISOString() ?? null,
      ndrReason: r.ndrReason, ndrAt: r.ndrAt?.toISOString() ?? null, reattemptAt: r.reattemptAt?.toISOString() ?? null,
      call: r.call, callAt: r.callAt?.toISOString() ?? null, callBy: r.callBy, followUpAt: r.followUpAt?.toISOString() ?? null,
      assignee: r.assignedTo != null ? nameOf.get(r.assignedTo) ?? "Former member" : null, tab: r.tab,
      log: ((r.timeline ?? []) as OrderEvent[]).slice(-3).reverse(),
    })),
  };
}

/**
 * Outcome numbers for the charts: of the parcels a caller marked Ready / Denied / Follow-up (last call per parcel),
 * how many were delivered, returned or are still open; and how many were delivered before anyone called.
 */
export async function ofdStats(storeId: number, me: number | null, from: Date | null, to: Date | null) {
  const scope = and(eq(orders.storeId, storeId), isNotNull(orders.ofdAt), me == null ? undefined : eq(orders.ofdAssignedTo, me),
    from ? gte(orders.ofdAt, from) : undefined, to ? lt(orders.ofdAt, to) : undefined);
  const last = sql`(select e.outcome from ${ofdCallEvents} e where e.order_id = ${orders.id} order by e.created_at desc limit 1)`;
  const rows = await db.select({
    outcome: sql<string | null>`${last}`,
    ship: orders.shipStatus,
    n: sql<number>`count(*)::int`,
    value: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
  }).from(orders).where(scope).groupBy(sql`1`, orders.shipStatus);
  const blank = () => ({ total: 0, delivered: 0, rto: 0, open: 0, deliveredValue: 0 });
  const by: Record<"ready" | "denied" | "follow_up" | "none", ReturnType<typeof blank>> = { ready: blank(), denied: blank(), follow_up: blank(), none: blank() };
  let ofd = 0, ndr = 0, delivered = 0, deliveredValue = 0, multi = 0;
  for (const r of rows) {
    const k = (r.outcome === "ready" || r.outcome === "denied" || r.outcome === "follow_up" ? r.outcome : "none") as keyof typeof by;
    const n = Number(r.n);
    const x = by[k];
    x.total += n; ofd += n;
    if (r.ship === "delivered") { x.delivered += n; x.deliveredValue += Number(r.value); delivered += n; deliveredValue += Number(r.value); }
    else if (r.ship === "rto" || r.ship === "rto_transit" || r.ship === "returned" || r.ship === "cancelled") x.rto += n;
    else { x.open += n; if (r.ship === "ndr") ndr += n; }
  }
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(scope, sql`${orders.ofdAttempts} >= 2`));
  multi = Number(m?.n ?? 0);
  return { ofd, ndr, delivered, deliveredValue, multi, called: ofd - by.none.total, ...by, beforeCall: by.none.delivered };
}

const stamp = (by: string, text: string): OrderEvent => ({ at: new Date().toISOString(), by, text });

/** Ready / Follow-up / Denied from a delivery-day call. */
export async function recordOfdCall(store: Store, orderId: string, me: number | null, by: string, kind: "ready" | "follow_up" | "denied", opts: { followUpAt?: Date | null; note?: string } = {}) {
  const [o] = await db.select({ id: orders.id, assignedTo: orders.ofdAssignedTo, ship: orders.shipStatus, attempts: orders.ofdAttempts }).from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, store.id))).limit(1);
  if (!o) return { error: "Order not found." };
  if (me !== null && o.assignedTo !== me) return { error: "This parcel is assigned to someone else." };
  if (o.ship === "delivered") return { error: "Already delivered." };
  const note = (opts.note ?? "").trim().slice(0, 300);
  const now = new Date();
  const attempt = Math.max(1, o.attempts);
  const text = kind === "ready" ? `Delivery call (${ordinal(attempt)} attempt): customer ready`
    : kind === "denied" ? `Delivery call (${ordinal(attempt)} attempt): customer denied`
    : `Delivery call (${ordinal(attempt)} attempt): follow-up`;
  await db.update(orders).set({
    ofdCallStatus: kind, ofdCallAt: now, ofdCallBy: by.slice(0, 120), ofdCallAttempt: attempt,
    ofdFollowUpAt: kind === "follow_up" ? opts.followUpAt ?? new Date(now.getTime() + 3600_000) : null,
    ...(me != null && o.assignedTo == null ? { ofdAssignedTo: me } : {}),
    timeline: sql`${orders.timeline} || ${JSON.stringify([stamp(by, note ? `${text} (${note})` : text)])}::jsonb`, updatedAt: now,
  }).where(eq(orders.id, o.id));
  await db.insert(ofdCallEvents).values({ storeId: store.id, orderId: o.id, memberId: me ?? o.assignedTo, actor: by.slice(0, 120), attempt, outcome: kind, note: note || null });
  return { ok: kind === "ready" ? "Marked ready." : kind === "denied" ? "Marked denied." : "Moved to follow-up." };
}

/** Owner / manager: give a parcel to another delivery caller. */
export async function reassignOfd(store: Store, orderId: string, memberId: number) {
  const team = await ofdCallersFor(store);
  if (!team.some((t) => t.id === memberId)) return { error: "Choose someone from the delivery calling team." };
  await db.update(orders).set({ ofdAssignedTo: memberId }).where(and(eq(orders.id, orderId), eq(orders.storeId, store.id)));
  return { ok: "Reassigned." };
}

/** NDR: ask the courier to attempt delivery again (Delhivery API). Many orders at once. */
export async function reattemptOrders(store: Store, orderIds: string[], by: string) {
  const ids = [...new Set(orderIds)].slice(0, 300);
  if (!ids.length) return { error: "Choose at least one shipment." };
  const rows = await db.select({ id: orders.id, awb: orders.awb, courier: orders.courier, courierAccountId: orders.courierAccountId, ship: orders.shipStatus }).from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.id, ids)));
  const ok: string[] = [], failed: string[] = [];
  let skipped = 0;
  const groups = new Map<number, { token: string; rows: typeof rows }>();
  for (const r of rows) {
    if (!r.awb || r.courier !== "delhivery") { skipped++; continue; }
    const acc = await accountForOrder(store.id, { courier: "delhivery", courierAccountId: r.courierAccountId });
    if (!acc?.creds.token) { skipped++; continue; }
    const g = groups.get(acc.id) ?? { token: acc.creds.token, rows: [] };
    g.rows.push(r); groups.set(acc.id, g);
  }
  for (const g of groups.values()) {
    for (let i = 0; i < g.rows.length; i += 50) {
      const chunk = g.rows.slice(i, i + 50);
      const res = await delhiveryReattempt(g.token, chunk.map((r) => r.awb!));
      if (res.ok) ok.push(...chunk.map((r) => r.id));
      else { failed.push(...chunk.map((r) => r.id)); console.error(`[ndr] re-attempt ${store.name}:`, res.error); }
      if (!res.ok && chunk.length) return { error: `Delhivery: ${res.error}`, done: ok.length };
    }
  }
  if (ok.length) {
    await db.update(orders).set({
      reattemptAt: new Date(), updatedAt: new Date(),
      timeline: sql`${orders.timeline} || ${JSON.stringify([stamp(by, "Re-attempt requested from the courier")])}::jsonb`,
    }).where(inArray(orders.id, ok));
  }
  if (!ok.length) return { error: skipped ? "Re-attempt works for Delhivery shipments booked through Growpefy." : "Nothing was sent." };
  return { ok: `Re-attempt requested for ${ok.length} shipment${ok.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped (not Delhivery).` : ""}` };
}

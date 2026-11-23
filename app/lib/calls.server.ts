// Calling team: employees who phone customers to confirm orders. New orders are shared out round-robin;
// each caller sees full details (with the mobile number) only for their own orders, and a summary of teammates' work.
import { OUTSOURCE_TAG } from "./order-route";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, orderCallEvents, orders, stores, teamMembers, type Order, type OrderEvent, type Store } from "~/db.server";
import { cancelOrders } from "./order-actions.server";

export const CALL_PERM = "confirm";
const CALL_PAGE_SIZE = 50;
const WINDOW_DAYS = 14; // orders older than this aren't put in anyone's queue

/** Active team members of this store's owner who have the calling permission (explicitly), oldest first. */
export async function callersFor(store: Pick<Store, "id" | "ownerId">) {
  if (!store.ownerId) return [];
  const rows = await db.select({ id: teamMembers.id, name: teamMembers.name, perms: teamMembers.perms, storeIds: teamMembers.storeIds, expiresAt: teamMembers.expiresAt })
    .from(teamMembers).where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.ownerId, store.ownerId), eq(teamMembers.active, true))).orderBy(asc(teamMembers.id));
  return rows.filter((m) => m.perms.includes(CALL_PERM) && (!m.storeIds || m.storeIds.includes(store.id)) && (!m.expiresAt || m.expiresAt > new Date()))
    .map((m) => ({ id: m.id, name: m.name }));
}

const open = (storeId: number) => and(
  eq(orders.storeId, storeId), inArray(orders.status, ["paid", "cod_placed"]), isNull(orders.awb), isNull(orders.courierRef),
  or(isNull(orders.callStatus), eq(orders.callStatus, "follow_up")),
  gte(orders.createdAt, new Date(Date.now() - WINDOW_DAYS * 86400_000)),
);

/** Gives every waiting order (none, or a caller who left) to the next caller in turn. */
export async function assignCalls(store: Store) {
  const team = await callersFor(store);
  if (!team.length) return 0;
  const ids = team.map((m) => m.id);
  // Every order of the last 14 days gets a caller, also ones already shipped or prepaid, so the team sees all of them
  const waiting = (await db.select({ id: orders.id, assignedTo: orders.assignedTo, callStatus: orders.callStatus }).from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, new Date(Date.now() - WINDOW_DAYS * 86400_000))))
    .orderBy(asc(orders.createdAt)).limit(1000))
    // An order already confirmed on a call stays with whoever confirmed it (e.g. the abandoned-checkout caller who placed it)
    .filter((o) => o.assignedTo == null || (!ids.includes(o.assignedTo) && o.callStatus !== "confirmed"));
  if (!waiting.length) return 0;
  let rr = store.callRr ?? 0;
  for (const o of waiting) {
    const m = team[rr % team.length];
    rr++;
    await db.update(orders).set({ assignedTo: m.id, assignedAt: new Date() }).where(and(eq(orders.id, o.id), or(isNull(orders.assignedTo), sql`${orders.assignedTo} <> ${m.id}`)));
  }
  await db.update(stores).set({ callRr: rr % 1_000_000 }).where(eq(stores.id, store.id));
  return waiting.length;
}

const istStart = () => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * 3600_000); };

type Mine = Pick<Order, "id" | "shopifyOrderName" | "createdAt" | "paymentMethod" | "status" | "total" | "subtotal" | "shipping" | "advance" | "amountPaid" | "items" | "customer" | "confirmStatus" | "callStatus" | "followUpAt" | "staffNote" | "customerNote" | "callAt" | "callBy" | "assignedTo" | "timeline" | "awb" | "courier" | "manualTags">;

export const CALL_TABS = ["to_call", "follow_up", "confirmed", "cancelled", "shipped", "all"] as const;
export type CallTab = (typeof CALL_TABS)[number];

/**
 * Which tab an assigned order belongs to. Every assigned order is always in exactly one tab, so nothing disappears:
 * confirmed / cancelled on the call, or cancelled by the owner; shipped orders stay where they are.
 * Confirmed or cancelled on WhatsApp stays with the caller (To call / Follow-up): only the calling team moves an order on.
 */
const bucket = sql<CallTab>`case
  when ${orders.callStatus} = 'confirmed' then 'confirmed'
  when ${orders.callStatus} = 'cancelled' or ${orders.status} = 'cancelled' then 'cancelled'
  when ${orders.callStatus} = 'follow_up' then 'follow_up'
  else 'to_call' end`; // a WhatsApp "confirm" doesn't move the order: it stays in To call (with a double tick) until the team calls

/**
 * Everything the calling page shows. `me` = the caller's team member id (null for the owner / a manager, who see all,
 * phone numbers included). `since`/`until` are IST dates (YYYY-MM-DD). Each tab counts by the day of its own event:
 * To call / Follow-up / All by when the order came in, Confirmed / Cancelled by when it was confirmed or cancelled,
 * Shipped by when it shipped — an order placed on the 17th and confirmed on the 20th counts on the 20th.
 */
export async function callBoard(store: Store, me: number | null, tab: CallTab, since: string, until: string, query = "", requestedPage = 1) {
  await assignCalls(store);
  const team = await callersFor(store);
  const dayStart = istStart().toISOString();
  const from = new Date(`${since}T00:00:00+05:30`);
  const to = new Date(new Date(`${until}T00:00:00+05:30`).getTime() + 86400_000);
  // Orders nobody has acted on yet stay on the board whatever dates are picked, so a caller can't forget them:
  // not called yet (and not shipped) from the last 14 days, and every follow-up from the last 30 days.
  const carried = sql`((${bucket} = 'to_call' and ${orders.status} in ('paid','cod_placed') and ${orders.awb} is null and ${orders.courierRef} is null and ${orders.createdAt} >= now() - interval '14 days')
    or (${bucket} = 'follow_up' and ${orders.status} in ('paid','cod_placed') and ${orders.createdAt} >= now() - interval '30 days'))`;
  // The day an order belongs to in each tab
  const when = sql`(case
    when ${bucket} = 'confirmed' then coalesce(${orders.callAt}, ${orders.createdAt})
    when ${bucket} = 'cancelled' then coalesce(case when ${orders.callStatus} = 'cancelled' then ${orders.callAt} end, ${orders.cancelledAt}, ${orders.createdAt})
    else ${orders.createdAt} end)`;
  const inRange = (at: SQL) => sql`(${at} >= ${from.toISOString()}::timestamptz and ${at} < ${to.toISOString()}::timestamptz)`;
  const mine = and(
    eq(orders.storeId, store.id),
    me == null ? undefined : eq(orders.assignedTo, me), // owner / managers: every order of the store
    inArray(orders.status, ["paid", "cod_placed", "cancelled"]),
  );
  const base = and(mine, or(inRange(when), carried));
  const cols = {
    id: orders.id, shopifyOrderName: orders.shopifyOrderName, createdAt: orders.createdAt, paymentMethod: orders.paymentMethod, status: orders.status, manualTags: orders.manualTags,
    total: orders.total, subtotal: orders.subtotal, shipping: orders.shipping, advance: orders.advance, amountPaid: orders.amountPaid, items: orders.items, customer: orders.customer, confirmStatus: orders.confirmStatus,
    callStatus: orders.callStatus, followUpAt: orders.followUpAt, staffNote: orders.staffNote, customerNote: orders.customerNote,
    callAt: orders.callAt, callBy: orders.callBy, assignedTo: orders.assignedTo, timeline: orders.timeline, awb: orders.awb, courier: orders.courier,
  };
  const term = query.replace(/[\\%_]/g, "\\$&");
  const mobile = query.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  const match = query ? or(
    sql`${orders.shopifyOrderName} ilike ${`%${term}%`}`,
    sql`right(${orders.id}, 6) ilike ${term.replace(/^#/, "")}`,
    sql`trim(concat_ws(' ', ${orders.customer}->>'firstName', ${orders.customer}->>'lastName')) ilike ${`%${term}%`}`,
    mobile.length === 10 ? sql`${orders.customer}->>'phone' = ${mobile}` : undefined,
  ) : undefined;
  const shipped = and(mine, sql`(${orders.awb} is not null or ${orders.courierRef} is not null)`, inRange(sql`coalesce(${orders.shippedAt}, ${orders.createdAt})`));
  const tabScope = tab === "all" ? base : tab === "shipped" ? shipped : and(base, sql`${bucket} = ${tab}`);
  const listScope = and(tabScope, match);
  const [counts, [ship], searchCount] = await Promise.all([
    db.select({ tab: bucket, n: sql<number>`count(*)::int` }).from(orders).where(base).groupBy(bucket),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(shipped),
    match ? db.select({ n: sql<number>`count(*)::int` }).from(orders).where(listScope) : null,
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.tab, c.n])) as Partial<Record<CallTab, number>>;
  const all = Object.values(n).reduce((total, count) => total + (count ?? 0), 0);
  const total = searchCount?.[0]?.n ?? (tab === "all" ? all : tab === "shipped" ? ship.n : n[tab] ?? 0);
  const pages = Math.max(1, Math.ceil(total / CALL_PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, pages)) : 1;
  const offset = (page - 1) * CALL_PAGE_SIZE;
  const list = await db.select({ ...cols, tab: bucket }).from(orders).where(listScope)
    .orderBy(tab === "follow_up" ? sql`${orders.followUpAt} asc nulls last`
      : tab === "shipped" ? sql`coalesce(${orders.shippedAt}, ${orders.createdAt}) desc`
      : tab === "confirmed" || tab === "cancelled" ? sql`${when} desc` : desc(orders.createdAt), desc(orders.id))
    .limit(CALL_PAGE_SIZE).offset(offset);

  // Team summary: per caller, open work now and what they did today
  const stats = await db.select({
    m: orders.assignedTo,
    waiting: sql<number>`count(*) filter (where ${bucket} = 'to_call' and ${orders.status} in ('paid','cod_placed'))::int`,
    follow: sql<number>`count(*) filter (where ${bucket} = 'follow_up' and ${orders.status} in ('paid','cod_placed'))::int`,
    confirmed: sql<number>`count(*) filter (where ${orders.callStatus} = 'confirmed' and ${orders.callAt} >= ${dayStart}::timestamptz)::int`,
    cancelled: sql<number>`count(*) filter (where ${orders.callStatus} = 'cancelled' and ${orders.callAt} >= ${dayStart}::timestamptz)::int`,
  }).from(orders).where(and(eq(orders.storeId, store.id), inArray(orders.assignedTo, team.length ? team.map((t) => t.id) : [-1]),
    gte(orders.createdAt, new Date(Date.now() - 60 * 86400_000)))).groupBy(orders.assignedTo);
  const byM = new Map(stats.map((r) => [r.m, r]));

  const nameOf = new Map(team.map((t) => [t.id, t.name]));
  const full = (o: Mine & { tab: CallTab }) => ({
    id: o.id, name: o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`, at: o.createdAt.toISOString(), method: o.paymentMethod, status: o.status,
    outsource: (o.manualTags ?? []).includes(OUTSOURCE_TAG),
    total: o.total, toCollect: o.paymentMethod === "cod" ? o.total : o.paymentMethod === "partial" ? o.total - (o.amountPaid ?? o.advance ?? 0) : 0,
    items: o.items.map((l) => ({ title: l.title, variant: l.variantTitle, qty: l.quantity, variantId: l.variantId, productId: l.productId, image: l.image, pricePaise: l.pricePaise, comparePaise: l.comparePaise })),
    subtotal: o.subtotal, shippingPaise: o.shipping,
    customer: { ...o.customer, phone: "" }, wa: o.confirmStatus, call: o.callStatus, tab: o.tab, followUpAt: o.followUpAt?.toISOString() ?? null,
    staffNote: o.staffNote ?? "", customerNote: o.customerNote ?? "", callAt: o.callAt?.toISOString() ?? null, callBy: o.callBy,
    shipped: o.awb ? { awb: o.awb, courier: o.courier } : null,
    assignee: o.assignedTo != null ? nameOf.get(o.assignedTo) ?? "Former member" : null,
    log: (o.timeline ?? []).slice(-4).reverse() as OrderEvent[],
  });
  return {
    me, team: team.map((t) => ({ ...t, ...(byM.get(t.id) ?? { waiting: 0, follow: 0, confirmed: 0, cancelled: 0 }), you: t.id === me })),
    counts: { to_call: n.to_call ?? 0, follow_up: n.follow_up ?? 0, confirmed: n.confirmed ?? 0, cancelled: n.cancelled ?? 0, shipped: ship.n, all },
    orders: list.map(full),
    pagination: { page, pages, total, offset },
  };
}

/** A teammate's orders, without mobile numbers or street address (for callers looking at a colleague's work). */
export async function teammateOrders(store: Store, memberId: number, hidePhones: boolean) {
  const rows = await db.select({
    id: orders.id, name: orders.shopifyOrderName, at: orders.createdAt, method: orders.paymentMethod, total: orders.total, customer: orders.customer,
    call: orders.callStatus, followUpAt: orders.followUpAt, callAt: orders.callAt,
  }).from(orders).where(and(eq(orders.storeId, store.id), eq(orders.assignedTo, memberId), gte(orders.createdAt, new Date(Date.now() - WINDOW_DAYS * 86400_000))))
    .orderBy(desc(orders.createdAt)).limit(150);
  return rows.map((r) => ({
    id: r.id, name: r.name ?? `#${r.id.slice(-6).toUpperCase()}`, at: r.at.toISOString(), method: r.method, total: r.total,
    customer: `${r.customer.firstName} ${r.customer.lastName}`.trim(), city: r.customer.city,
    phone: hidePhones ? null : r.customer.phone,
    call: r.call, followUpAt: r.followUpAt?.toISOString() ?? null, callAt: r.callAt?.toISOString() ?? null,
  }));
}

const stamp = (by: string, text: string): OrderEvent => ({ at: new Date().toISOString(), by, text });

/** Confirm / follow-up / cancel from a call. A caller may only act on their own orders. */
export async function recordCall(store: Store, orderId: string, me: number | null, by: string, act: { kind: "confirmed" | "follow_up" | "cancelled"; followUpAt?: Date | null; note?: string; reason?: string }) {
  const note = (act.note ?? "").trim().slice(0, 300);
  const text = act.kind === "confirmed" ? "Confirmed on call"
    : act.kind === "follow_up" ? `Follow-up${act.followUpAt ? ` at ${act.followUpAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}`
    : `Cancelled on call${act.reason ? `: ${act.reason}` : ""}`;
  const saved = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, store.id))).for("update");
    if (!order) return { error: "Order not found." };
    if (me !== null && order.assignedTo !== me) return { error: "This order is assigned to someone else." };
    if (!["paid", "cod_placed"].includes(order.status)) return { error: "This order isn't open any more." };

    const now = new Date();
    await tx.update(orders).set({
      callStatus: act.kind, callAt: now, callBy: by.slice(0, 120), updatedAt: now,
      followUpAt: act.kind === "follow_up" ? act.followUpAt ?? new Date(now.getTime() + 3600_000) : null,
      ...(note ? { staffNote: order.staffNote ? `${order.staffNote}\n${note}` : note } : {}),
      timeline: sql`${orders.timeline} || ${JSON.stringify([stamp(by, note ? `${text} (${note})` : text)])}::jsonb`,
    }).where(and(eq(orders.id, order.id), eq(orders.storeId, store.id)));
    await tx.update(orderCallEvents).set({ resolvedAt: now }).where(and(
      eq(orderCallEvents.storeId, store.id), eq(orderCallEvents.orderId, order.id),
      eq(orderCallEvents.kind, "skip"), isNull(orderCallEvents.resolvedAt),
    ));
    return { order };
  });
  if (!saved.order) return { error: saved.error! };
  const o = saved.order;
  // A COD order cancelled on the call is cancelled for real (shipment stopped, stock back). Paid orders stay for the owner to refund.
  if (act.kind === "cancelled" && o.paymentMethod === "cod") {
    await cancelOrders(store, [o.id], { refund: false, reason: `Cancelled on call${act.reason ? `: ${act.reason}` : ""}`, by });
  }
  // Confirmed on the call: send it to the courier straight away (the store's shipping rule still decides)
  if (act.kind === "confirmed") void import("./auto-ship.server").then((m) => m.shipNowIfReady(store.id, o.id)).catch((e) => console.error("[auto-ship] now", e));
  return { ok: act.kind === "confirmed" ? "Order confirmed." : act.kind === "follow_up" ? "Moved to follow-up." : o.paymentMethod === "cod" ? "Order cancelled." : "Marked cancelled. The owner will cancel and refund this paid order." };
}

/** Owner / manager: move an order to another caller. */
export async function reassign(store: Store, orderId: string, memberId: number) {
  const team = await callersFor(store);
  if (!team.some((t) => t.id === memberId)) return { error: "Choose someone from the calling team." };
  await db.update(orders).set({ assignedTo: memberId, assignedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.storeId, store.id)));
  return { ok: "Order reassigned." };
}

/** Runs with the auto-ship timer: new orders reach callers within minutes even if nobody has the page open. */
export async function assignAllCalls() {
  const owners = await db.selectDistinct({ ownerId: teamMembers.ownerId }).from(teamMembers)
    .where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.active, true), sql`${teamMembers.perms} @> ${JSON.stringify([CALL_PERM])}::jsonb`));
  const ids = owners.map((o) => o.ownerId).filter((x): x is number => x != null);
  if (!ids.length) return;
  for (const s of await db.select().from(stores).where(inArray(stores.ownerId, ids))) await assignCalls(s).catch((e) => console.error("[calls] assign", s.id, e));
}

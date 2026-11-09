// Calling team: employees who phone customers to confirm orders. New orders are shared out round-robin;
// each caller sees full details (with the mobile number) only for their own orders, and a summary of teammates' work.
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, orders, stores, teamMembers, type Order, type OrderEvent, type Store } from "~/db.server";
import { cancelOrders } from "./order-actions.server";
import { needsCall, shipRuleOf } from "./ship-rule";

export const CALL_PERM = "confirm";
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
  const rule = shipRuleOf(store);
  const waiting = (await db.select({ id: orders.id, assignedTo: orders.assignedTo, paymentMethod: orders.paymentMethod, confirmStatus: orders.confirmStatus })
    .from(orders).where(open(store.id)).orderBy(asc(orders.createdAt)).limit(500))
    .filter((o) => (o.assignedTo == null || !ids.includes(o.assignedTo)) && needsCall(rule, o));
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

type Mine = Pick<Order, "id" | "shopifyOrderName" | "createdAt" | "paymentMethod" | "status" | "total" | "advance" | "amountPaid" | "items" | "customer" | "confirmStatus" | "callStatus" | "followUpAt" | "callAttempts" | "staffNote" | "customerNote" | "callAt" | "callBy" | "assignedTo" | "timeline" | "awb" | "courier">;

export const CALL_TABS = ["to_call", "follow_up", "confirmed", "cancelled", "all"] as const;
export type CallTab = (typeof CALL_TABS)[number];

/**
 * Which tab an assigned order belongs to. Every assigned order is always in exactly one tab, so nothing disappears:
 * confirmed / cancelled on the call, or by the customer on WhatsApp, or cancelled by the owner; shipped orders stay where they are.
 */
const bucket = sql<CallTab>`case
  when ${orders.callStatus} = 'confirmed' then 'confirmed'
  when ${orders.callStatus} = 'cancelled' or ${orders.status} = 'cancelled' or ${orders.confirmStatus} = 'cancelled' then 'cancelled'
  when ${orders.callStatus} = 'follow_up' then 'follow_up'
  when ${orders.confirmStatus} = 'confirmed' then 'confirmed'
  else 'to_call' end`;

/**
 * Everything the calling page shows. `me` = the caller's team member id (null for the owner / a manager, who see all,
 * phone numbers included). `since`/`until` are IST dates (YYYY-MM-DD) on when the order was placed.
 */
export async function callBoard(store: Store, me: number | null, tab: CallTab, since: string, until: string) {
  await assignCalls(store);
  const team = await callersFor(store);
  const dayStart = istStart().toISOString();
  const from = new Date(`${since}T00:00:00+05:30`);
  const to = new Date(new Date(`${until}T00:00:00+05:30`).getTime() + 86400_000);
  const base = and(
    eq(orders.storeId, store.id),
    me == null ? sql`${orders.assignedTo} is not null` : eq(orders.assignedTo, me),
    inArray(orders.status, ["paid", "cod_placed", "cancelled"]),
    gte(orders.createdAt, from), lt(orders.createdAt, to),
  );
  const cols = {
    id: orders.id, shopifyOrderName: orders.shopifyOrderName, createdAt: orders.createdAt, paymentMethod: orders.paymentMethod, status: orders.status,
    total: orders.total, advance: orders.advance, amountPaid: orders.amountPaid, items: orders.items, customer: orders.customer, confirmStatus: orders.confirmStatus,
    callStatus: orders.callStatus, followUpAt: orders.followUpAt, callAttempts: orders.callAttempts, staffNote: orders.staffNote, customerNote: orders.customerNote,
    callAt: orders.callAt, callBy: orders.callBy, assignedTo: orders.assignedTo, timeline: orders.timeline, awb: orders.awb, courier: orders.courier,
  };
  const [list, counts] = await Promise.all([
    db.select({ ...cols, tab: bucket }).from(orders).where(tab === "all" ? base : and(base, sql`${bucket} = ${tab}`))
      .orderBy(tab === "follow_up" ? sql`${orders.followUpAt} asc nulls last` : desc(orders.createdAt)).limit(300),
    db.select({ tab: bucket, n: sql<number>`count(*)::int` }).from(orders).where(base).groupBy(bucket),
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.tab, Number(c.n)])) as Partial<Record<CallTab, number>>;

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
    total: o.total, toCollect: o.paymentMethod === "cod" ? o.total : o.paymentMethod === "partial" ? o.total - (o.amountPaid ?? o.advance ?? 0) : 0,
    items: o.items.map((l) => ({ title: l.title, variant: l.variantTitle, qty: l.quantity })),
    customer: o.customer, wa: o.confirmStatus, call: o.callStatus, tab: o.tab, followUpAt: o.followUpAt?.toISOString() ?? null, attempts: o.callAttempts,
    staffNote: o.staffNote ?? "", customerNote: o.customerNote ?? "", callAt: o.callAt?.toISOString() ?? null, callBy: o.callBy,
    shipped: o.awb ? { awb: o.awb, courier: o.courier } : null,
    assignee: o.assignedTo != null ? nameOf.get(o.assignedTo) ?? "Former member" : null,
    log: (o.timeline ?? []).slice(-4).reverse() as OrderEvent[],
  });
  return {
    me, team: team.map((t) => ({ ...t, ...(byM.get(t.id) ?? { waiting: 0, follow: 0, confirmed: 0, cancelled: 0 }), you: t.id === me })),
    counts: { to_call: n.to_call ?? 0, follow_up: n.follow_up ?? 0, confirmed: n.confirmed ?? 0, cancelled: n.cancelled ?? 0, all: Object.values(n).reduce((a, b) => a + (b ?? 0), 0) },
    orders: list.map(full),
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
  const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, store.id))).limit(1);
  if (!o) return { error: "Order not found." };
  if (me != null && o.assignedTo !== me) return { error: "This order is assigned to someone else." };
  if (!["paid", "cod_placed"].includes(o.status)) return { error: "This order isn't open any more." };
  const note = (act.note ?? "").trim().slice(0, 300);
  const text = act.kind === "confirmed" ? "Confirmed on call"
    : act.kind === "follow_up" ? `Follow-up${act.followUpAt ? ` at ${act.followUpAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}`
    : `Cancelled on call${act.reason ? `: ${act.reason}` : ""}`;
  await db.update(orders).set({
    callStatus: act.kind, callAt: new Date(), callBy: by.slice(0, 120), updatedAt: new Date(),
    followUpAt: act.kind === "follow_up" ? act.followUpAt ?? new Date(Date.now() + 3600_000) : null,
    callAttempts: sql`${orders.callAttempts} + 1`,
    ...(note ? { staffNote: o.staffNote ? `${o.staffNote}\n${note}` : note } : {}),
    timeline: sql`${orders.timeline} || ${JSON.stringify([stamp(by, note ? `${text} (${note})` : text)])}::jsonb`,
  }).where(eq(orders.id, o.id));
  // A COD order cancelled on the call is cancelled for real (shipment stopped, stock back). Paid orders stay for the owner to refund.
  if (act.kind === "cancelled" && o.paymentMethod === "cod") {
    await cancelOrders(store, [o.id], { refund: false, reason: `Cancelled on call${act.reason ? `: ${act.reason}` : ""}`, by });
  }
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

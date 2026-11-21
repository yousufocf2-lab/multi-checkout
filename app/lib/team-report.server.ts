// Team performance: what each calling team member did in a period, across the three calling jobs
// (order confirmation, abandoned checkouts, out for delivery), and what it led to (deliveries, revenue).
import { and, asc, eq, sql } from "drizzle-orm";
import { db, teamMembers, type Store } from "~/db.server";

const CALL_PERMS = ["confirm", "abandoned_calls", "ofd_calls"];

export type MemberStats = {
  id: number; name: string; roles: string[];
  confirm: { assigned: number; attempts: number; skipped: number; confirmed: number; cancelled: number; followUp: number; delivered: number; rto: number; revenue: number; avgMins: number | null };
  abandoned: { assigned: number; converted: number; lost: number; followUp: number; revenue: number; delivered: number; deliveredRevenue: number };
  ofd: { calls: number; parcels: number; ready: number; followUp: number; denied: number; delivered: number; rto: number; revenue: number };
  actions: number; deliveredRevenue: number; deliveredOrders: number;
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0) || 0;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

export async function teamMembersFor(store: Pick<Store, "id" | "ownerId">) {
  if (!store.ownerId) return [];
  const list = await db.select({ id: teamMembers.id, name: teamMembers.name, perms: teamMembers.perms, storeIds: teamMembers.storeIds, active: teamMembers.active })
    .from(teamMembers).where(and(eq(teamMembers.scope, "owner"), eq(teamMembers.ownerId, store.ownerId))).orderBy(asc(teamMembers.id));
  return list.filter((m) => (!m.storeIds || m.storeIds.includes(store.id)) && m.perms.some((p) => CALL_PERMS.includes(p)))
    .map((m) => ({ id: m.id, name: m.name, active: m.active, roles: m.perms.filter((p) => CALL_PERMS.includes(p)) }));
}

export async function teamReport(store: Store, from: Date, to: Date) {
  const members = await teamMembersFor(store);
  const ids = members.map((m) => m.id);
  const S = store.id;
  const blank = (m: (typeof members)[number]): MemberStats => ({
    id: m.id, name: m.name, roles: m.roles,
    confirm: { assigned: 0, attempts: 0, skipped: 0, confirmed: 0, cancelled: 0, followUp: 0, delivered: 0, rto: 0, revenue: 0, avgMins: null },
    abandoned: { assigned: 0, converted: 0, lost: 0, followUp: 0, revenue: 0, delivered: 0, deliveredRevenue: 0 },
    ofd: { calls: 0, parcels: 0, ready: 0, followUp: 0, denied: 0, delivered: 0, rto: 0, revenue: 0 },
    actions: 0, deliveredRevenue: 0, deliveredOrders: 0,
  });
  const by = new Map(members.map((m) => [m.id, blank(m)]));
  if (!ids.length) return { members: [] as MemberStats[], daily: [] as { day: string; member: number; kind: string; n: number }[] };
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const F = from.toISOString(), T = to.toISOString();

  const [confirm, assigned, attempts, aband, abAssigned, ofd, delivered, daily] = await Promise.all([
    rows(sql`select assigned_to m, call_status s, count(*)::int c,
        count(*) filter (where ship_status = 'delivered')::int d,
        count(*) filter (where ship_status in ('rto','rto_transit','returned'))::int r,
        coalesce(sum(total) filter (where ship_status = 'delivered'), 0)::bigint rev,
        avg(extract(epoch from call_at - created_at) / 60) filter (where call_status in ('confirmed','cancelled')) mins
      from orders where store_id = ${S} and assigned_to in (${idList}) and call_at >= ${F}::timestamptz and call_at < ${T}::timestamptz and call_status is not null
      group by 1, 2`),
    rows(sql`select assigned_to m, count(*)::int c from orders where store_id = ${S} and assigned_to in (${idList}) and created_at >= ${F}::timestamptz and created_at < ${T}::timestamptz group by 1`),
    rows(sql`select member_id m, count(*) filter (where kind in ('manual','provider'))::int a, count(distinct order_id) filter (where kind = 'skip')::int s
      from order_call_events where store_id = ${S} and member_id in (${idList}) and created_at >= ${F}::timestamptz and created_at < ${T}::timestamptz group by 1`),
    rows(sql`select cs.call_assigned_to m, cs.call_status s, count(*)::int c,
        coalesce(sum(o.total), 0)::bigint rev,
        count(o.id) filter (where o.ship_status = 'delivered')::int d,
        coalesce(sum(o.total) filter (where o.ship_status = 'delivered'), 0)::bigint drev
      from checkout_sessions cs left join orders o on o.id = cs.call_order_id
      where cs.store_id = ${S} and cs.call_assigned_to in (${idList}) and cs.call_at >= ${F}::timestamptz and cs.call_at < ${T}::timestamptz and cs.call_status is not null
      group by 1, 2`),
    rows(sql`select call_assigned_to m, count(*)::int c from checkout_sessions where store_id = ${S} and call_assigned_to in (${idList}) and call_assigned_at >= ${F}::timestamptz and call_assigned_at < ${T}::timestamptz group by 1`),
    rows(sql`with ev as (
        select member_id m, order_id, outcome, row_number() over (partition by member_id, order_id order by created_at desc) rn, count(*) over (partition by member_id) calls
        from ofd_call_events where store_id = ${S} and member_id in (${idList}) and created_at >= ${F}::timestamptz and created_at < ${T}::timestamptz)
      select ev.m, max(ev.calls)::int calls, count(*)::int parcels,
        count(*) filter (where outcome = 'ready')::int ready, count(*) filter (where outcome = 'follow_up')::int fu, count(*) filter (where outcome = 'denied')::int denied,
        count(*) filter (where o.ship_status = 'delivered')::int d, count(*) filter (where o.ship_status in ('rto','rto_transit','returned'))::int r,
        coalesce(sum(o.total) filter (where o.ship_status = 'delivered'), 0)::bigint rev
      from ev join orders o on o.id = ev.order_id where ev.rn = 1 group by 1`),
    // Delivered orders each member worked on (any job), counted once
    rows(sql`select t.m, count(*)::int c, coalesce(sum(o.total), 0)::bigint rev from (
        select assigned_to m, id oid from orders where store_id = ${S} and assigned_to in (${idList}) and call_status = 'confirmed' and call_at >= ${F}::timestamptz and call_at < ${T}::timestamptz
        union select call_assigned_to, call_order_id from checkout_sessions where store_id = ${S} and call_assigned_to in (${idList}) and call_order_id is not null and call_order_id <> 'pending' and call_at >= ${F}::timestamptz and call_at < ${T}::timestamptz
        union select member_id, order_id from ofd_call_events where store_id = ${S} and member_id in (${idList}) and created_at >= ${F}::timestamptz and created_at < ${T}::timestamptz
      ) t join orders o on o.id = t.oid where o.ship_status = 'delivered' group by 1`),
    rows(sql`select to_char(at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') day, m, kind, count(*)::int n from (
        select call_at at, assigned_to m, 'confirm' kind from orders where store_id = ${S} and assigned_to in (${idList}) and call_at >= ${F}::timestamptz and call_at < ${T}::timestamptz and call_status is not null
        union all select created_at, member_id, 'confirm' from order_call_events where store_id = ${S} and member_id in (${idList}) and kind in ('manual','provider') and created_at >= ${F}::timestamptz and created_at < ${T}::timestamptz
        union all select call_at, call_assigned_to, 'abandoned' from checkout_sessions where store_id = ${S} and call_assigned_to in (${idList}) and call_at >= ${F}::timestamptz and call_at < ${T}::timestamptz and call_status is not null
        union all select created_at, member_id, 'ofd' from ofd_call_events where store_id = ${S} and member_id in (${idList}) and created_at >= ${F}::timestamptz and created_at < ${T}::timestamptz
      ) x group by 1, 2, 3 order by 1`),
  ]);

  for (const r of confirm) {
    const x = by.get(n(r.m)); if (!x) continue;
    const c = n(r.c);
    if (r.s === "confirmed") { x.confirm.confirmed += c; x.confirm.delivered += n(r.d); x.confirm.rto += n(r.r); x.confirm.revenue += n(r.rev); }
    else if (r.s === "cancelled") x.confirm.cancelled += c;
    else if (r.s === "follow_up") x.confirm.followUp += c;
    if (r.mins != null && (r.s === "confirmed" || r.s === "cancelled")) {
      const prev = x.confirm.avgMins, done = x.confirm.confirmed + x.confirm.cancelled;
      x.confirm.avgMins = prev == null ? n(r.mins) : (prev * (done - c) + n(r.mins) * c) / Math.max(1, done);
    }
  }
  for (const r of assigned) { const x = by.get(n(r.m)); if (x) x.confirm.assigned = n(r.c); }
  for (const r of attempts) { const x = by.get(n(r.m)); if (x) { x.confirm.attempts = n(r.a); x.confirm.skipped = n(r.s); } }
  for (const r of aband) {
    const x = by.get(n(r.m)); if (!x) continue;
    const c = n(r.c);
    if (r.s === "converted") { x.abandoned.converted += c; x.abandoned.revenue += n(r.rev); x.abandoned.delivered += n(r.d); x.abandoned.deliveredRevenue += n(r.drev); }
    else if (r.s === "not_interested") x.abandoned.lost += c;
    else if (r.s === "follow_up") x.abandoned.followUp += c;
  }
  for (const r of abAssigned) { const x = by.get(n(r.m)); if (x) x.abandoned.assigned = n(r.c); }
  for (const r of ofd) {
    const x = by.get(n(r.m)); if (!x) continue;
    Object.assign(x.ofd, { calls: n(r.calls), parcels: n(r.parcels), ready: n(r.ready), followUp: n(r.fu), denied: n(r.denied), delivered: n(r.d), rto: n(r.r), revenue: n(r.rev) });
  }
  for (const r of delivered) { const x = by.get(n(r.m)); if (x) { x.deliveredOrders = n(r.c); x.deliveredRevenue = n(r.rev); } }
  const dailyOut = daily.map((r) => ({ day: String(r.day), member: n(r.m), kind: String(r.kind), n: n(r.n) }));
  for (const d of dailyOut) { const x = by.get(d.member); if (x) x.actions += d.n; }
  const list = [...by.values()].filter((m) => members.find((x) => x.id === m.id)?.active || m.actions > 0);
  return { members: list, daily: dailyOut };
}

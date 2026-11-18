import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, orderCallEvents, orders } from "~/db.server";
import { callerProvider, type CallerProvider } from "./calling-providers.server";

const pending = or(isNull(orders.callStatus), and(eq(orders.callStatus, "follow_up"), lte(orders.followUpAt, sql`now()`)));

export async function skipOrders(storeId: number, memberId: number, actor: string, ids: string[]) {
  return db.transaction(async (tx) => {
    const eligible = await tx.select({ id: orders.id }).from(orders).where(and(
      eq(orders.storeId, storeId), eq(orders.assignedTo, memberId), inArray(orders.id, ids),
      inArray(orders.status, ["paid", "cod_placed"]), pending, isNull(orders.awb), isNull(orders.courierRef),
    )).orderBy(orders.id).for("update");
    if (!eligible.length) return 0;
    const inserted = await tx.insert(orderCallEvents).values(eligible.map(({ id }) => ({
      storeId, orderId: id, memberId, actor, kind: "skip" as const,
    }))).onConflictDoNothing().returning({ id: orderCallEvents.id });
    return inserted.length;
  });
}

export async function callActivity(storeId: number, memberId: number | null, since: string, until: string, showSkips: boolean, orderIds: string[]) {
  const scope = eq(orderCallEvents.storeId, storeId);
  const skip = eq(orderCallEvents.kind, "skip");
  const unresolved = isNull(orderCallEvents.resolvedAt);
  if (memberId !== null) {
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(orderCallEvents)
      .where(and(scope, skip, unresolved, eq(orderCallEvents.memberId, memberId)));
    return { warnings: count.n, skipped: 0, unresolved: 0, attempts: 0, skips: [], calls: [], daily: [] };
  }
  const range = and(gte(orderCallEvents.createdAt, new Date(`${since}T00:00:00+05:30`)),
    lt(orderCallEvents.createdAt, new Date(new Date(`${until}T00:00:00+05:30`).getTime() + 86400000)));
  const [counts, skips, calls, daily] = await Promise.all([
    db.select({ skipped: sql<number>`count(*) filter (where ${skip})::int`, unresolved: sql<number>`count(*) filter (where ${skip} and ${unresolved})::int`,
      attempts: sql<number>`count(*) filter (where ${orderCallEvents.kind} in ('manual', 'provider'))::int` })
      .from(orderCallEvents).where(and(scope, range)),
    showSkips ? db.select({ id: orderCallEvents.id, orderId: orders.id, name: orders.shopifyOrderName, customer: orders.customer,
      items: orders.items, total: orders.total, status: orders.status, actor: orderCallEvents.actor,
      at: orderCallEvents.createdAt, resolvedAt: orderCallEvents.resolvedAt,
    }).from(orderCallEvents).innerJoin(orders, and(eq(orders.id, orderCallEvents.orderId), eq(orders.storeId, storeId)))
      .where(and(scope, skip, range)).orderBy(desc(orderCallEvents.createdAt)) : [],
    orderIds.length ? db.select({ id: orderCallEvents.id, orderId: orderCallEvents.orderId, kind: orderCallEvents.kind,
      actor: orderCallEvents.actor, at: orderCallEvents.createdAt, provider: orderCallEvents.provider, verifiedAt: orderCallEvents.resolvedAt, linked: sql<boolean>`${orderCallEvents.providerRef} is not null`,
    }).from(orderCallEvents).where(and(scope, inArray(orderCallEvents.orderId, orderIds),
      inArray(orderCallEvents.kind, ["manual", "provider"]))).orderBy(desc(orderCallEvents.createdAt)) : [],
    db.select({ day: sql<string>`to_char(${orderCallEvents.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
      actor: orderCallEvents.actor, kind: orderCallEvents.kind, count: sql<number>`count(*)::int`,
    }).from(orderCallEvents).where(and(scope, range)).groupBy(sql`1`, orderCallEvents.actor, orderCallEvents.kind).orderBy(sql`1 desc`),
  ]);
  return { warnings: 0, ...counts[0], skips, calls, daily };
}

export async function startOrderCall(storeId: number, orderId: string, phone: string, memberId: number | null, actor: string, provider: CallerProvider) {
  if (!/^\d{10}$/.test(phone)) throw new Error("No valid customer number.");
  const [event] = await db.insert(orderCallEvents).values({ storeId, orderId, memberId, actor, kind: "provider", provider: provider.id })
    .returning({ id: orderCallEvents.id });
  const ref = await provider.start(phone, memberId);
  await db.update(orderCallEvents).set({ providerRef: ref }).where(eq(orderCallEvents.id, event.id));
  return { phone };
}

export async function providerCallInfo(storeId: number, eventId: number) {
  const [event] = await db.select().from(orderCallEvents)
    .where(and(eq(orderCallEvents.id, eventId), eq(orderCallEvents.storeId, storeId), eq(orderCallEvents.kind, "provider")));
  const provider = callerProvider(storeId);
  if (!event?.providerRef || !provider || provider.id !== event.provider) throw new Error("No provider record is linked.");
  const info = await provider.info(event.providerRef);
  if (info.verified && !event.resolvedAt) {
    await db.update(orderCallEvents).set({ resolvedAt: new Date() }).where(and(
      eq(orderCallEvents.id, event.id), eq(orderCallEvents.storeId, storeId), isNull(orderCallEvents.resolvedAt),
    ));
  }
  return { status: info.status, seconds: info.seconds, recording: info.recording };
}

/** A call attempt: the caller copied the customer's number (to dial it on the office phone). Every copy counts. */
export async function recordAttempt(storeId: number, orderId: string, memberId: number | null, actor: string) {
  await db.insert(orderCallEvents).values({ storeId, orderId, memberId, actor, kind: "manual" });
}

/** Call attempts per order (copies of the number and provider calls). */
export async function attemptCounts(storeId: number, orderIds: string[]) {
  if (!orderIds.length) return {} as Record<string, number>;
  const rows = await db.select({ orderId: orderCallEvents.orderId, n: sql<number>`count(*)::int` }).from(orderCallEvents)
    .where(and(eq(orderCallEvents.storeId, storeId), inArray(orderCallEvents.orderId, orderIds), inArray(orderCallEvents.kind, ["manual", "provider"])))
    .groupBy(orderCallEvents.orderId);
  return Object.fromEntries(rows.map((r) => [r.orderId, r.n])) as Record<string, number>;
}

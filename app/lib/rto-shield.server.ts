import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, orders, rtoShieldExempt, type Store } from "~/db.server";
import { hasCourier } from "./logistics.server";
import { decideShield, resolveShield, type ShieldHit, type ShipCounts, type ShipStatus } from "./rto-shield";

const STATUSES: ShipStatus[] = ["in_transit", "delivered", "rto_transit", "rto", "returned", "cancelled"];

export async function isExempt(storeId: number, phone: string) {
  const [r] = await db.select({ p: rtoShieldExempt.phone }).from(rtoShieldExempt).where(and(eq(rtoShieldExempt.storeId, storeId), eq(rtoShieldExempt.phone, phone))).limit(1);
  return Boolean(r);
}

/** This customer's shipments with the store, by status. */
export async function shipCounts(storeId: number, phone: string): Promise<ShipCounts> {
  const rows = await db.select({ s: orders.shipStatus, n: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.storeId, storeId), sql`${orders.customer}->>'phone' = ${phone}`, isNotNull(orders.shipStatus)))
    .groupBy(orders.shipStatus);
  return Object.fromEntries(rows.map((r) => [r.s, Number(r.n)])) as ShipCounts;
}

/** RTO Shield decision for a phone at checkout. Never throws (checkout must keep working). */
export async function shieldFor(store: Store, phone: string): Promise<ShieldHit | null> {
  try {
    const s = resolveShield(store.rtoShield);
    if (!s.enabled || !/^\d{10}$/.test(phone)) return null;
    if (!(await hasCourier(store.id))) return null;
    if (await isExempt(store.id, phone)) return null;
    return decideShield(s, await shipCounts(store.id, phone));
  } catch (e) {
    console.error("[rto-shield]", e instanceof Error ? e.message : e);
    return null;
  }
}

export type BlockedRow = { phone: string; name: string; counts: ShipCounts; hit: ShieldHit; exempt: boolean };

/** Customers the current rules would block (for the dashboard), worst first. */
export async function blockedCustomersNow(store: Store, limit = 200): Promise<BlockedRow[]> {
  const s = resolveShield(store.rtoShield);
  const agg = (st: ShipStatus) => sql<number>`count(*) filter (where ${orders.shipStatus} = ${st})::int`;
  const rows = await db.select({
    phone: sql<string>`${orders.customer}->>'phone'`,
    name: sql<string>`max(${orders.customer}->>'firstName')`,
    ...Object.fromEntries(STATUSES.map((st) => [st, agg(st)])) as Record<ShipStatus, ReturnType<typeof agg>>,
  }).from(orders)
    .where(and(eq(orders.storeId, store.id), isNotNull(orders.shipStatus)))
    .groupBy(sql`${orders.customer}->>'phone'`)
    .orderBy(desc(sql`count(*) filter (where ${orders.shipStatus} in ('rto','rto_transit','returned'))`))
    .limit(3000);
  const exempt = new Set((await db.select({ p: rtoShieldExempt.phone }).from(rtoShieldExempt).where(eq(rtoShieldExempt.storeId, store.id))).map((r) => r.p));
  const on = { ...s, enabled: true };
  const out: BlockedRow[] = [];
  for (const r of rows) {
    const counts = Object.fromEntries(STATUSES.map((st) => [st, Number((r as Record<string, unknown>)[st] ?? 0)])) as ShipCounts;
    const hit = decideShield(on, counts);
    if (hit) out.push({ phone: r.phone, name: r.name ?? "", counts, hit, exempt: exempt.has(r.phone) });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => Number(b.hit.scope === "all") - Number(a.hit.scope === "all"));
}

export async function setExempt(storeId: number, phone: string, on: boolean) {
  if (on) await db.insert(rtoShieldExempt).values({ storeId, phone }).onConflictDoNothing();
  else await db.delete(rtoShieldExempt).where(and(eq(rtoShieldExempt.storeId, storeId), eq(rtoShieldExempt.phone, phone)));
}

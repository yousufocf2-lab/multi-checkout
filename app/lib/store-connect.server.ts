// Store data connect: server side. Super admin only; stores never see the settings or the reason.
import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, orders, platformSettings, type StoreConnectGroup } from "~/db.server";
import { PLACED_WINDOW_DAYS, resolveGroups, type LinkedHit } from "./store-connect";

let cache: { at: number; groups: StoreConnectGroup[] } | null = null;
const TTL = 30_000;

export async function connectGroups(fresh = false): Promise<StoreConnectGroup[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.groups;
  const [row] = await db.select({ s: platformSettings.specialLogic }).from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  const groups = resolveGroups(row?.s?.storeConnect?.groups);
  cache = { at: Date.now(), groups };
  return groups;
}

export async function saveConnectGroups(groups: StoreConnectGroup[]) {
  const [row] = await db.select({ s: platformSettings.specialLogic }).from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  const next = { ...(row?.s ?? {}), storeConnect: { groups } };
  await db.update(platformSettings).set({ specialLogic: next, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
  cache = null;
}

/** The enabled group this store belongs to, if any. */
export async function groupFor(storeId: number) {
  return (await connectGroups()).find((g) => g.enabled && g.storeIds.includes(storeId)) ?? null;
}

/**
 * Live orders of this phone on the other connected stores (and this one, if the group says so)
 * that block Cash on Delivery. Cancelled, failed, RTO and returned orders never count.
 */
export async function linkedOrders(storeId: number, phone: string, group: StoreConnectGroup, limit = 5): Promise<LinkedHit[]> {
  const ids = group.storeIds.filter((id) => group.sameStore || id !== storeId);
  if (!ids.length || !/^\d{10}$/.test(phone)) return [];
  const states: SQL[] = [];
  const since = new Date(Date.now() - PLACED_WINDOW_DAYS * 86400_000);
  if (group.blockOn.placed) states.push(and(isNull(orders.shipStatus), gte(orders.createdAt, since))!);
  if (group.blockOn.inTransit) states.push(sql`${orders.shipStatus} in ('in_transit', 'pickup_pending')`);
  if (group.blockOn.delivered) states.push(sql`${orders.shipStatus} = 'delivered'`);
  if (!states.length) return [];
  const rows = await db.select({ id: orders.id, storeId: orders.storeId, ship: orders.shipStatus, createdAt: orders.createdAt }).from(orders)
    .where(and(
      inArray(orders.storeId, ids),
      sql`${orders.customer}->>'phone' = ${phone}`,
      or(inArray(orders.status, ["cod_placed", "paid"]), and(eq(orders.checkoutChannel, "shopify_history"), eq(orders.status, "pending_payment"))),
      isNull(orders.cancelledAt),
      sql`coalesce(${orders.confirmStatus}, '') <> 'cancelled'`,
      sql`coalesce(${orders.callStatus}, '') <> 'cancelled'`,
      or(...states),
    ))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    orderId: r.id, storeId: r.storeId, createdAt: r.createdAt.toISOString(),
    state: r.ship === "delivered" ? "delivered" : r.ship === "in_transit" || r.ship === "pickup_pending" ? "in_transit" : "placed",
  }));
}

/** Checkout check: true when COD must be blocked for this phone. Never throws (checkout must keep working). */
export async function linkedCodBlocked(storeId: number, phone: string): Promise<boolean> {
  try {
    const g = await groupFor(storeId);
    if (!g) return false;
    return (await linkedOrders(storeId, phone, g, 1)).length > 0;
  } catch (e) {
    console.error("[store-connect]", e instanceof Error ? e.message : e);
    return false;
  }
}

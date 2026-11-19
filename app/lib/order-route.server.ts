// Special logic → Order routing (super admin only; stores and customers never see it).
// Every Nth order on the "from" store is placed on the "to" store instead — only Cash on Delivery orders.
// If the Nth order is prepaid it stays where it is, and the next COD order goes instead.
// Routed orders: no pixel / Conversions API / Google events on either store, tagged "Order from outsource".
import { eq, sql } from "drizzle-orm";
import { catalogVariants, db, platformSettings, stores, type Store } from "~/db.server";
import type { OrderRoute } from "~/db/schema";
import { gpNum, isCatalogVariant } from "./catalog.server";

import { ROUTE_MAX, ROUTE_MIN } from "./order-route";
export { OUTSOURCE_TAG } from "./order-route";

export function resolveRoute(raw: unknown): OrderRoute {
  const r = (raw ?? {}) as Partial<OrderRoute>;
  const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : d);
  const from = Math.max(0, n(r.from)), to = Math.max(0, n(r.to));
  return {
    on: Boolean(r.on) && from > 0 && to > 0 && from !== to,
    from, to,
    every: Math.min(ROUTE_MAX, Math.max(ROUTE_MIN, n(r.every, 9))),
    count: Math.max(0, n(r.count)),
    routed: Math.max(0, n(r.routed)),
    onlyMeta: r.onlyMeta !== false, // default: only orders that came from a Meta ad
  };
}

export async function getRoute() {
  const [row] = await db.select({ s: platformSettings.specialLogic }).from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  return resolveRoute(row?.s?.orderRoute);
}

export async function saveRoute(next: Pick<OrderRoute, "on" | "from" | "to" | "every" | "onlyMeta">, resetCount: boolean) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ s: platformSettings.specialLogic }).from(platformSettings).where(eq(platformSettings.id, 1)).for("update");
    const cur = resolveRoute(row?.s?.orderRoute);
    const changed = cur.from !== next.from;
    const orderRoute = resolveRoute({ ...cur, ...next, count: resetCount || changed ? 0 : cur.count });
    await tx.update(platformSettings).set({ specialLogic: { ...(row?.s ?? {}), orderRoute }, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
  });
}

/**
 * Called once per order about to be placed on `store`. Counts it and says where it goes.
 * Returns the store to place it on, or null to keep it on its own store.
 */
/** The visitor came from a Meta ad (Facebook / Instagram): Meta's click cookie, or a Meta utm_source. */
export function fromMetaAd(t: { fbc?: string; src?: string } | null | undefined) {
  return Boolean(t?.fbc) || /^(facebook|fb|instagram|ig|meta|an|msg)\b/i.test(t?.src ?? "");
}

export async function routeTarget(store: Store, method: string, metaAd = false): Promise<Store | null> {
  try {
    const to = await db.transaction(async (tx) => {
      const [row] = await tx.select({ s: platformSettings.specialLogic }).from(platformSettings).where(eq(platformSettings.id, 1)).for("update");
      const r = resolveRoute(row?.s?.orderRoute);
      if (!r.on || r.from !== store.id) return null;
      if (r.onlyMeta && !metaAd) return null; // direct / other visitors: never routed and not counted
      const due = r.count >= r.every - 1;
      const go = due && method === "cod";
      const orderRoute: OrderRoute = go ? { ...r, count: 0, routed: r.routed + 1 } : { ...r, count: Math.min(r.count + 1, r.every - 1) };
      await tx.update(platformSettings).set({ specialLogic: { ...(row?.s ?? {}), orderRoute } }).where(eq(platformSettings.id, 1));
      return go ? r.to : null;
    });
    if (!to) return null;
    const [target] = await db.select().from(stores).where(eq(stores.id, to)).limit(1);
    return target ?? null;
  } catch (e) {
    console.error("[route]", e instanceof Error ? e.message : e);
    return null; // never block a customer
  }
}

/** Stock still comes off the products the customer actually bought (on the store they bought from). */
export async function takeSourceStock(fromStoreId: number, items: { variantId: string; quantity: number }[]) {
  for (const l of items) {
    if (!isCatalogVariant(l.variantId)) continue;
    await db.update(catalogVariants)
      .set({ stock: sql`greatest(0, ${catalogVariants.stock} - ${l.quantity})` })
      .where(sql`${catalogVariants.id} = ${gpNum(l.variantId)} and ${catalogVariants.storeId} = ${fromStoreId} and ${catalogVariants.stock} is not null`);
  }
}

/**
 * Routed orders placed before their Purchase went to the original store's Meta pixel: send it now.
 * Meta accepts Conversions API events up to 7 days old; same event id as the browser, so nothing is counted twice.
 */
export async function sendMissedRoutedEvents() {
  const { orders } = await import("~/db.server");
  const { trackPurchase } = await import("./orders.server");
  const { and, gt, isNull, sql: q } = await import("drizzle-orm");
  const list = await db.select().from(orders).where(and(
    q`${orders.tracking}->'outsource'->>'from' is not null`, isNull(orders.capiSentAt),
    gt(orders.createdAt, new Date(Date.now() - 6.9 * 86_400_000)),
  ));
  let sent = 0;
  const skipped: string[] = [];
  for (const o of list) {
    await trackPurchase(null as unknown as Store, o); // routed: it looks up the original store itself
    const [after] = await db.select({ at: orders.capiSentAt, status: orders.status }).from(orders).where(eq(orders.id, o.id)).limit(1);
    if (after?.at) sent++; else skipped.push(`${o.shopifyOrderName ?? o.id} (${after?.status ?? o.status})`);
  }
  console.log(`[route] missed events: ${sent} sent, ${skipped.length} not sent of ${list.length}`);
  return { found: list.length, sent, skipped };
}

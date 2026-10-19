// Courier connections and shipment status sync (feeds RTO Shield).
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { courierAccounts, db, orders, stores, type CourierAccount, type Store } from "~/db.server";
import { testDelhiveryToken, trackDelhivery } from "./couriers/delhivery.server";
import type { ShipStatus } from "./rto-shield";
import { fetchFulfillmentTracking } from "./shopify.server";

export type CourierId = "delhivery";

export type CourierInfo = {
  id: string;
  name: string;
  live: boolean;
  color: string;
  steps?: string[];
  link?: { label: string; href: string };
  fields?: { name: "token" | "clientName"; label: string; placeholder: string; hint?: string; optional?: boolean }[];
};

/** Couriers shown on the Logistics page. Only "live" ones can be connected today. */
export const COURIERS: CourierInfo[] = [
  {
    id: "delhivery", name: "Delhivery", live: true, color: "#e11d27",
    steps: [
      "Open Delhivery One and log in with your Delhivery account.",
      "Go to Settings → API Setup.",
      "Copy your live API token. If you don't see one, click “Request Live API Token”. A new token replaces the old one, so update other apps that use it.",
      "Paste it below and click Connect. We check it with Delhivery straight away.",
    ],
    link: { label: "Open Delhivery One", href: "https://one.delhivery.com/" },
    fields: [
      { name: "token", label: "API token", placeholder: "Paste your Delhivery live API token" },
      { name: "clientName", label: "Client name", placeholder: "As shown in Delhivery One (optional)", hint: "Helps us match shipments when you have more than one Delhivery account.", optional: true },
    ],
  },
  { id: "shiprocket", name: "Shiprocket", live: false, color: "#7c3aed" },
  { id: "xpressbees", name: "Xpressbees", live: false, color: "#f59e0b" },
  { id: "ekart", name: "Ekart", live: false, color: "#2563eb" },
  { id: "shadowfax", name: "Shadowfax", live: false, color: "#16a34a" },
  { id: "bluedart", name: "Blue Dart", live: false, color: "#1d4ed8" },
];

export const isLiveCourier = (id: string): id is CourierId => COURIERS.some((c) => c.id === id && c.live);

export async function courierAccountsFor(storeId: number) {
  return db.select().from(courierAccounts).where(eq(courierAccounts.storeId, storeId)).orderBy(asc(courierAccounts.createdAt));
}

/** RTO Shield unlocks once at least one courier is connected. */
export async function hasCourier(storeId: number) {
  const [r] = await db.select({ n: count() }).from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.status, "connected")));
  return Number(r?.n ?? 0) > 0;
}

export async function connectCourier(store: Store, courier: CourierId, input: { token: string; clientName?: string }) {
  const token = input.token.trim().replace(/^Token\s+/i, "");
  if (token.length < 10) return { ok: false as const, error: "Paste the full API token" };
  const t = await testDelhiveryToken(token);
  if (!t.ok) return t;
  const creds = { token, clientName: input.clientName?.trim().slice(0, 80) || undefined };
  await db.insert(courierAccounts).values({ storeId: store.id, courier, creds, status: "connected" })
    .onConflictDoUpdate({ target: [courierAccounts.storeId, courierAccounts.courier], set: { creds, status: "connected", lastError: null } });
  // First sync in the background so the page shows statuses soon
  void syncStoreShipments(store).catch((e) => console.error("[logistics] first sync:", e instanceof Error ? e.message : e));
  return { ok: true as const };
}

export async function disconnectCourier(storeId: number, courier: string) {
  await db.delete(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, courier)));
}

const FINAL: ShipStatus[] = ["rto", "returned", "cancelled"];
const LOOKBACK_DAYS = 90;
const RECHECK_MS = 3 * 3600_000;
const DELIVERED_WATCH_DAYS = 20; // delivered orders can still come back as returns

/** Links AWBs from Shopify fulfillments, then refreshes statuses from the courier. */
export async function syncStoreShipments(store: Store, opts: { force?: boolean } = {}) {
  const accounts = (await courierAccountsFor(store.id)).filter((a) => a.status === "connected" || opts.force);
  const delhivery = accounts.find((a) => a.courier === "delhivery");
  if (!delhivery) return { linked: 0, updated: 0 };
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
  let linked = 0, updated = 0;

  try {
    // 1. AWBs for orders that don't have one yet
    if (store.adminToken || (store.clientId && store.clientSecret)) {
      const pending = await db.select({ id: orders.id, gid: orders.shopifyOrderId }).from(orders)
        .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), isNotNull(orders.shopifyOrderId), isNull(orders.awb), gt(orders.createdAt, since),
          or(isNull(orders.shipCheckedAt), lt(orders.shipCheckedAt, new Date(Date.now() - RECHECK_MS)))))
        .orderBy(asc(orders.createdAt)).limit(200);
      for (let i = 0; i < pending.length; i += 50) {
        const chunk = pending.slice(i, i + 50);
        const found = await fetchFulfillmentTracking(store, chunk.map((o) => o.gid!));
        const byGid = new Map(found.map((f) => [f.orderId, f.tracking]));
        for (const o of chunk) {
          const t = byGid.get(o.gid!) ?? [];
          const pick = t.find((x) => /delhivery/i.test(x.company ?? "")) ?? (accounts.length === 1 ? t[0] : undefined);
          if (pick) {
            await db.update(orders).set({ awb: pick.number.slice(0, 40), courier: "delhivery", shipStatus: "in_transit", shipStatusRaw: "Shipped", shipStatusAt: new Date(), shipCheckedAt: new Date(0) }).where(eq(orders.id, o.id));
            linked++;
          } else {
            await db.update(orders).set({ shipCheckedAt: new Date() }).where(eq(orders.id, o.id));
          }
        }
      }
    }

    // 2. Live status for shipped orders
    const watch = await db.select({ id: orders.id, awb: orders.awb, shipStatus: orders.shipStatus }).from(orders)
      .where(and(eq(orders.storeId, store.id), eq(orders.courier, "delhivery"), isNotNull(orders.awb), gt(orders.createdAt, since),
        or(isNull(orders.shipStatus), notInArray(orders.shipStatus, FINAL)),
        or(sql`${orders.shipStatus} is distinct from 'delivered'`, gt(orders.shipStatusAt, new Date(Date.now() - DELIVERED_WATCH_DAYS * 86400_000))),
        opts.force ? undefined : or(isNull(orders.shipCheckedAt), lt(orders.shipCheckedAt, new Date(Date.now() - RECHECK_MS)))))
      .orderBy(asc(orders.shipCheckedAt)).limit(1000);
    for (let i = 0; i < watch.length; i += 50) {
      const chunk = watch.slice(i, i + 50);
      const results = await trackDelhivery(delhivery.creds.token, chunk.map((o) => o.awb!));
      const byAwb = new Map(results.map((r) => [r.awb, r]));
      for (const o of chunk) {
        const r = byAwb.get(o.awb!);
        if (r?.status && r.status !== o.shipStatus) {
          await db.update(orders).set({ shipStatus: r.status, shipStatusRaw: r.raw.slice(0, 120), shipStatusAt: r.at ?? new Date(), shipCheckedAt: new Date() }).where(eq(orders.id, o.id));
          updated++;
        } else {
          await db.update(orders).set({ shipCheckedAt: new Date(), ...(r?.raw ? { shipStatusRaw: r.raw.slice(0, 120) } : {}) }).where(eq(orders.id, o.id));
        }
      }
    }
    await db.update(courierAccounts).set({ lastSyncAt: new Date(), lastError: null, status: "connected" }).where(eq(courierAccounts.id, delhivery.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[logistics] ${store.name}:`, msg);
    await db.update(courierAccounts).set({ lastError: msg.slice(0, 500), status: /rejected|token/i.test(msg) ? "error" : delhivery.status }).where(eq(courierAccounts.id, delhivery.id));
  }
  return { linked, updated };
}

/** Shipment status counts for a store (last 90 days) for the dashboard. */
export async function shipmentSummary(storeId: number) {
  const rows = await db.select({ s: orders.shipStatus, n: count() }).from(orders)
    .where(and(eq(orders.storeId, storeId), isNotNull(orders.shipStatus), gt(orders.createdAt, new Date(Date.now() - LOOKBACK_DAYS * 86400_000))))
    .groupBy(orders.shipStatus);
  return Object.fromEntries(rows.map((r) => [r.s, Number(r.n)])) as Partial<Record<ShipStatus, number>>;
}

const SYNC_EVERY_MS = 60 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __shipmentWatcher: ReturnType<typeof setInterval> | undefined;
}

async function syncAll() {
  const rows = await db.selectDistinct({ storeId: courierAccounts.storeId }).from(courierAccounts).where(eq(courierAccounts.status, "connected"));
  if (!rows.length) return;
  const list = await db.select().from(stores).where(and(inArray(stores.id, rows.map((r) => r.storeId)), eq(stores.active, true)));
  for (const s of list) await syncStoreShipments(s).catch(() => {});
}

/** Refreshes shipment statuses every hour for stores with a courier connected. */
export function startShipmentWatcher() {
  if (globalThis.__shipmentWatcher || !process.env.DATABASE_URL) return;
  globalThis.__shipmentWatcher = setInterval(() => void syncAll().catch(() => {}), SYNC_EVERY_MS);
  globalThis.__shipmentWatcher.unref?.();
  setTimeout(() => void syncAll().catch(() => {}), 60_000).unref?.();
}

export type { CourierAccount };

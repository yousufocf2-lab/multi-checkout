// Orders from the store's own Shopify checkout, copied into shopify_native_orders for stores with the profit
// dashboard on, so the profit report and the Overview can count them without asking Shopify on every page view.
import { and, eq, gte, max, sql } from "drizzle-orm";
import { db, shopifyNativeOrders, stores, type Store } from "~/db.server";
import { fetchNativeOrders } from "./shopify.server";

const IST_MS = 330 * 60_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
/** Shopify returns at most the last 60 days of orders without read_all_orders. */
export const NATIVE_HISTORY_DAYS = 60;

/** Start of the partnership (YYYY-MM-DD, IST): the admin's chosen date, else the day the dashboard was turned on. */
export function profitStart(store: Pick<Store, "profitStartDate" | "profitEnabledAt" | "createdAt">) {
  if (store.profitStartDate && /^\d{4}-\d{2}-\d{2}$/.test(store.profitStartDate)) return store.profitStartDate;
  return istDay(store.profitEnabledAt ?? store.createdAt);
}

type SyncState = { at: number; error: string | null; complete: boolean; running?: Promise<void> };
const state = new Map<number, SyncState>();
const FRESH_MS = 10 * 60_000;

export function nativeSyncStatus(storeId: number) {
  const s = state.get(storeId);
  return s ? { at: s.at ? new Date(s.at).toISOString() : null, error: s.error, complete: s.complete, running: Boolean(s.running) } : null;
}

async function runSync(store: Store) {
  const start = profitStart(store);
  const floor = new Date(Date.now() - (NATIVE_HISTORY_DAYS - 1) * 86400_000);
  const startAt = new Date(`${start}T00:00:00+05:30`);
  const [last] = await db.select({ at: max(shopifyNativeOrders.createdAt) }).from(shopifyNativeOrders)
    .where(and(eq(shopifyNativeOrders.storeId, store.id), gte(shopifyNativeOrders.createdAt, startAt)));
  // Re-read the last 3 days every time so cancellations and payment updates are picked up
  let from = last?.at ? new Date(last.at.getTime() - 3 * 86400_000) : startAt;
  if (from < startAt) from = startAt;
  if (from < floor) from = floor;
  const { orders, complete } = await fetchNativeOrders(store, from.toISOString());
  for (let i = 0; i < orders.length; i += 200) {
    const chunk = orders.slice(i, i + 200).map((o) => ({
      id: o.id, storeId: store.id, name: o.name, createdAt: new Date(o.createdAt), totalPaise: o.totalPaise,
      prepaid: o.prepaid, financialStatus: o.financialStatus, gateway: o.gateway, cancelled: o.cancelled, syncedAt: new Date(),
    }));
    await db.insert(shopifyNativeOrders).values(chunk).onConflictDoUpdate({
      target: shopifyNativeOrders.id,
      set: {
        totalPaise: sql`excluded.total_paise`, prepaid: sql`excluded.prepaid`, financialStatus: sql`excluded.financial_status`,
        gateway: sql`excluded.gateway`, cancelled: sql`excluded.cancelled`, syncedAt: sql`excluded.synced_at`,
      },
    });
  }
  return complete;
}

/**
 * Brings the store's Shopify-checkout orders up to date. `wait` = wait for it (first load);
 * otherwise a fresh-enough copy is used and an update runs in the background.
 */
export async function syncNativeOrders(store: Store, opts: { wait?: boolean; force?: boolean } = {}) {
  if (store.platform !== "shopify" || !store.profitEnabled || !store.adminToken) return;
  const cur = state.get(store.id);
  if (cur?.running) { if (opts.wait) await cur.running; return; }
  if (!opts.force && cur && Date.now() - cur.at < FRESH_MS) return;
  const running = runSync(store)
    .then((complete) => { state.set(store.id, { at: Date.now(), error: null, complete }); })
    .catch((e) => {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[native-orders] store ${store.id}:`, error);
      state.set(store.id, { at: Date.now(), error, complete: false });
    });
  state.set(store.id, { at: cur?.at ?? 0, error: cur?.error ?? null, complete: cur?.complete ?? false, running });
  if (opts.wait || !cur) await running;
}

/** Forget the copy (start date changed or dashboard turned off and on): the next sync starts fresh. */
export async function resetNativeOrders(storeId: number) {
  state.delete(storeId);
  await db.delete(shopifyNativeOrders).where(eq(shopifyNativeOrders.storeId, storeId));
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Every 15 minutes: refresh every store with the profit dashboard on. */
export function startNativeOrdersWatcher() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const list = await db.select().from(stores).where(and(eq(stores.profitEnabled, true), eq(stores.platform, "shopify")));
      for (const s of list) await syncNativeOrders(s);
    } catch (e) { console.error("[native-orders] watcher:", e instanceof Error ? e.message : e); }
  }, 15 * 60_000);
  timer.unref?.();
}

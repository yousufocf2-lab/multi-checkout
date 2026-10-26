import { and, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db, metaRecharges, metaSnapshots, stores, type MarketingSettings, type Store } from "~/db.server";
import { fetchAccount, type MetaAccount } from "./meta.server";
import { getMarketing } from "./marketing.server";

import { GST } from "./gst";
export { GST, withGst } from "./gst";

const MIN_CREDIT_PAISE = 50_00; // ignore balance wobble below ₹50
const SNAPSHOT_EVERY_MS = 30 * 60_000;

/**
 * Recharge amount from the rise in available funds. Meta's prepaid "available balance" already includes GST,
 * so the rise is the recharge itself; only Meta's paise rounding is snapped (₹999.99 → ₹1,000).
 */
export function roundRecharge(paise: number) {
  const r = paise / 100;
  const ten = Math.round(r / 10) * 10;
  return Math.round((Math.abs(r - ten) <= 2 ? ten : Math.round(r)) * 100);
}

/** Whose ad account: a store id, or null for Growpefy's own (Super admin → Marketing). */
export type AdOwner = number | null;
const of = (col: typeof metaSnapshots.storeId | typeof metaRecharges.storeId, owner: AdOwner): SQL => (owner == null ? isNull(col) : eq(col, owner));

/** Growpefy's own Meta ad account in the shape the Meta helpers expect. */
export function platformMetaStore(m: MarketingSettings) {
  return { id: 0, metaAdAccountId: m.metaAdAccountId ?? null, metaAccessToken: m.metaAccessToken ?? null, metaApiVersion: "v23.0" } as unknown as Store;
}

export const creditFromGross = (grossPaise: number) => Math.round(grossPaise / (1 + GST));

/**
 * Saves a balance reading and records a recharge if funds went up by more than what was spent.
 * Available balance includes GST and spend doesn't, so spend takes spend × 1.18 out of the balance:
 * recharge = (available now − before) + (spent now − before) × 1.18
 */
export async function recordSnapshot(store: { id: AdOwner }, account: MetaAccount, force = false) {
  if (account.available == null) return null;
  const availablePaise = Math.round(account.available * 100);
  const spentPaise = Math.round(account.amountSpent * 100);
  const [last] = await db.select().from(metaSnapshots).where(of(metaSnapshots.storeId, store.id)).orderBy(desc(metaSnapshots.takenAt)).limit(1);
  if (last && !force && Date.now() - last.takenAt.getTime() < 10 * 60_000 && last.availablePaise === availablePaise && last.spentPaise === spentPaise) return null;

  const now = new Date();
  await db.insert(metaSnapshots).values({ storeId: store.id, availablePaise, spentPaise, takenAt: now });
  if (!last) return null;
  const added = availablePaise - last.availablePaise + Math.max(0, spentPaise - last.spentPaise) * (1 + GST);
  if (added < MIN_CREDIT_PAISE) return null;
  const amount = roundRecharge(added);
  const [row] = await db.insert(metaRecharges).values({
    storeId: store.id, amountPaise: amount, creditPaise: creditFromGross(amount), source: "auto",
    note: "Detected from the ad account balance", rechargedAt: now,
  }).returning();
  return row;
}

export async function listRecharges(storeId: AdOwner, from?: Date, to?: Date) {
  const where = [of(metaRecharges.storeId, storeId)];
  if (from) where.push(gte(metaRecharges.rechargedAt, from));
  if (to) where.push(lt(metaRecharges.rechargedAt, to));
  return db.select().from(metaRecharges).where(and(...where)).orderBy(desc(metaRecharges.rechargedAt)).limit(500);
}

export async function rechargeTotals(storeId: AdOwner) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${metaRecharges.amountPaise}), 0)`, first: sql<Date | null>`min(${metaRecharges.rechargedAt})` })
    .from(metaRecharges).where(of(metaRecharges.storeId, storeId));
  return { count: r?.n ?? 0, amount: Number(r?.amount ?? 0) / 100, first: r?.first ? new Date(r.first).toISOString() : null };
}

export async function lastSnapshot(storeId: AdOwner) {
  const [s] = await db.select().from(metaSnapshots).where(of(metaSnapshots.storeId, storeId)).orderBy(desc(metaSnapshots.takenAt)).limit(1);
  return s ?? null;
}

export async function watchingSince(storeId: AdOwner) {
  const [s] = await db.select({ at: sql<Date | null>`min(${metaSnapshots.takenAt})` }).from(metaSnapshots).where(of(metaSnapshots.storeId, storeId));
  return s?.at ? new Date(s.at).toISOString() : null;
}

// ---------------- background watcher ----------------

declare global {
  // eslint-disable-next-line no-var
  var __rechargeWatcher: NodeJS.Timeout | undefined;
}

async function snapshotAll() {
  // Growpefy's own ad account (Marketing) too
  try {
    const m = await getMarketing();
    if (m.metaAdAccountId && m.metaAccessToken) await recordSnapshot({ id: null }, await fetchAccount(platformMetaStore(m)));
  } catch (e) {
    console.error("[recharges] Growpefy:", e instanceof Error ? e.message : e);
  }
  const list = await db.select().from(stores).where(and(isNotNull(stores.metaAdAccountId), isNotNull(stores.metaAccessToken)));
  for (const s of list) {
    try {
      await recordSnapshot(s, await fetchAccount(s));
    } catch (e) {
      console.error(`[recharges] ${s.name}:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Reads every ad account balance every 30 minutes so recharges are caught between page visits. */
export function startRechargeWatcher() {
  if (globalThis.__rechargeWatcher || !process.env.DATABASE_URL) return;
  globalThis.__rechargeWatcher = setInterval(() => void snapshotAll().catch(() => {}), SNAPSHOT_EVERY_MS);
  globalThis.__rechargeWatcher.unref?.();
  setTimeout(() => void snapshotAll().catch(() => {}), 15_000).unref?.();
}

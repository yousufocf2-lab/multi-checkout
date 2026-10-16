import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db, metaRecharges, metaSnapshots, stores, type Store } from "~/db.server";
import { fetchAccount, type MetaAccount } from "./meta.server";

import { GST } from "./gst";
export { GST, withGst } from "./gst";

const MIN_CREDIT_PAISE = 50_00; // ignore balance wobble below ₹50
const SNAPSHOT_EVERY_MS = 30 * 60_000;

/** Gross recharge from the ad credit, snapped to a round figure (₹999.46 → ₹1,000). */
export function grossFromCredit(creditPaise: number) {
  const g = (creditPaise / 100) * (1 + GST);
  const ten = Math.round(g / 10) * 10;
  return Math.round((Math.abs(g - ten) <= 2 ? ten : Math.round(g)) * 100);
}

export const creditFromGross = (grossPaise: number) => Math.round(grossPaise / (1 + GST));

/**
 * Saves a balance reading and records a recharge if funds went up by more than what was spent.
 * credit added = (available now − before) + (spent now − before)
 */
export async function recordSnapshot(store: Store, account: MetaAccount, force = false) {
  if (account.available == null) return null;
  const availablePaise = Math.round(account.available * 100);
  const spentPaise = Math.round(account.amountSpent * 100);
  const [last] = await db.select().from(metaSnapshots).where(eq(metaSnapshots.storeId, store.id)).orderBy(desc(metaSnapshots.takenAt)).limit(1);
  if (last && !force && Date.now() - last.takenAt.getTime() < 10 * 60_000 && last.availablePaise === availablePaise && last.spentPaise === spentPaise) return null;

  const now = new Date();
  await db.insert(metaSnapshots).values({ storeId: store.id, availablePaise, spentPaise, takenAt: now });
  if (!last) return null;
  const credit = availablePaise - last.availablePaise + Math.max(0, spentPaise - last.spentPaise);
  if (credit < MIN_CREDIT_PAISE) return null;
  const [row] = await db.insert(metaRecharges).values({
    storeId: store.id, creditPaise: credit, amountPaise: grossFromCredit(credit), source: "auto",
    note: "Detected from the ad account balance", rechargedAt: now,
  }).returning();
  return row;
}

export async function listRecharges(storeId: number, from?: Date, to?: Date) {
  const where = [eq(metaRecharges.storeId, storeId)];
  if (from) where.push(gte(metaRecharges.rechargedAt, from));
  if (to) where.push(lt(metaRecharges.rechargedAt, to));
  return db.select().from(metaRecharges).where(and(...where)).orderBy(desc(metaRecharges.rechargedAt)).limit(500);
}

export async function rechargeTotals(storeId: number) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${metaRecharges.amountPaise}), 0)`, first: sql<Date | null>`min(${metaRecharges.rechargedAt})` })
    .from(metaRecharges).where(eq(metaRecharges.storeId, storeId));
  return { count: r?.n ?? 0, amount: Number(r?.amount ?? 0) / 100, first: r?.first ? new Date(r.first).toISOString() : null };
}

export async function lastSnapshot(storeId: number) {
  const [s] = await db.select().from(metaSnapshots).where(eq(metaSnapshots.storeId, storeId)).orderBy(desc(metaSnapshots.takenAt)).limit(1);
  return s ?? null;
}

export async function watchingSince(storeId: number) {
  const [s] = await db.select({ at: sql<Date | null>`min(${metaSnapshots.takenAt})` }).from(metaSnapshots).where(eq(metaSnapshots.storeId, storeId));
  return s?.at ? new Date(s.at).toISOString() : null;
}

// ---------------- background watcher ----------------

declare global {
  // eslint-disable-next-line no-var
  var __rechargeWatcher: NodeJS.Timeout | undefined;
}

async function snapshotAll() {
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

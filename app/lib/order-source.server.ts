// Saves each order's source channel (tracking.ch) so the Orders page can filter by it.
// New website orders get it when they're placed; a small job fills it in for older orders and for orders made by
// other paths (recovered checkouts, imports), every 15 minutes.
import { sql } from "drizzle-orm";
import { db, orders } from "~/db.server";
import type { TrackingInfo } from "~/db/schema";
import { orderSource } from "./order-source";

export function withSource(t: TrackingInfo, checkoutChannel?: string | null): TrackingInfo {
  return { ...t, ch: orderSource(t, checkoutChannel).channel };
}

const BATCH = 1000;

async function fillOnce() {
  let done = 0;
  for (let round = 0; round < 200; round++) {
    const rows = await db.select({ id: orders.id, tracking: orders.tracking, channel: orders.checkoutChannel }).from(orders)
      .where(sql`(${orders.tracking} is null or ${orders.tracking}->>'ch' is null)`).limit(BATCH);
    if (!rows.length) break;
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const ch = orderSource(r.tracking, r.channel).channel;
      groups.set(ch, [...(groups.get(ch) ?? []), r.id]);
    }
    for (const [ch, ids] of groups) {
      await db.execute(sql`update orders set tracking = coalesce(tracking, '{}'::jsonb) || jsonb_build_object('ch', ${ch}::text)
        where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    }
    done += rows.length;
    if (rows.length < BATCH) break;
  }
  return done;
}

/**
 * Once after this deploy: orders saved as "other_ads" are worked out again (Meta ads shown on WhatsApp / Messenger,
 * utm_source=wa / msg, were filed as other ads). Remove after it has run.
 */
async function refileOtherAds() {
  const rows = await db.select({ id: orders.id, tracking: orders.tracking, channel: orders.checkoutChannel }).from(orders)
    .where(sql`${orders.tracking}->>'ch' = 'other_ads'`).limit(20_000);
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const ch = orderSource(r.tracking, r.channel).channel;
    if (ch !== "other_ads") groups.set(ch, [...(groups.get(ch) ?? []), r.id]);
  }
  let n = 0;
  for (const [ch, ids] of groups) {
    for (let i = 0; i < ids.length; i += 1000) {
      const part = ids.slice(i, i + 1000);
      await db.execute(sql`update orders set tracking = tracking || jsonb_build_object('ch', ${ch}::text) where id in (${sql.join(part.map((id) => sql`${id}`), sql`, `)})`);
      n += part.length;
    }
  }
  console.log(`[order-source] refiled ${n} of ${rows.length} "other ads" orders`);
}

const g = globalThis as unknown as { __gpSourceFill?: ReturnType<typeof setInterval> };
/** Starts the fill-in job once per server. */
export function startSourceFill() {
  if (g.__gpSourceFill) return;
  const run = () => void fillOnce()
    .then((n) => { if (n) console.log(`[order-source] filled source for ${n} orders`); })
    .catch((e) => console.error("[order-source]", e instanceof Error ? e.message : e));
  setTimeout(run, 50_000).unref?.();
  setTimeout(() => void refileOtherAds().catch((e) => console.error("[order-source] refile:", e instanceof Error ? e.message : e)), 70_000).unref?.();
  g.__gpSourceFill = setInterval(run, 15 * 60_000);
  g.__gpSourceFill.unref?.();
}

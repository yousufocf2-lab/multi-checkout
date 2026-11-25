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

const g = globalThis as unknown as { __gpSourceFill?: ReturnType<typeof setInterval> };
/** Starts the fill-in job once per server. */
export function startSourceFill() {
  if (g.__gpSourceFill) return;
  const run = () => void fillOnce()
    .then((n) => { if (n) console.log(`[order-source] filled source for ${n} orders`); })
    .catch((e) => console.error("[order-source]", e instanceof Error ? e.message : e));
  setTimeout(run, 50_000).unref?.();
  g.__gpSourceFill = setInterval(run, 15 * 60_000);
  g.__gpSourceFill.unref?.();
}

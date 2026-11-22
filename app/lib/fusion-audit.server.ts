// One-off: Fusion Prime, last 8 days (IST, up to the current hour each day): checkouts and orders from Meta ads vs
// routed in from another store, to explain a bad ad day.
import { sql } from "drizzle-orm";
import { db } from "~/db.server";

let done = false;
export async function logFusionAudit() {
  if (done) return;
  done = true;
  try {
    const meta = (t: string) => sql.raw(`(${t}.tracking->>'fbc' is not null or coalesce(${t}.tracking->>'src','') ~* '^(facebook|fb|instagram|ig|meta|an|msg)')`);
    const hour = sql`(extract(hour from created_at at time zone 'Asia/Kolkata'))::int <= (extract(hour from now() at time zone 'Asia/Kolkata'))::int`;
    const day = sql`to_char(created_at at time zone 'Asia/Kolkata', 'MM-DD')`;
    const s = (await db.execute(sql`select ${day} d, count(*)::int open, count(*) filter (where ${meta("checkout_sessions")})::int meta_open,
        count(*) filter (where ${hour})::int open_h, count(*) filter (where ${hour} and ${meta("checkout_sessions")})::int meta_open_h
      from checkout_sessions where store_id = 8 and created_at > now() - interval '8 days' group by 1 order by 1`)) as unknown as unknown[];
    const o = (await db.execute(sql`select ${day} d,
        count(*) filter (where status in ('cod_placed','paid') and tracking->'outsource' is null)::int own,
        count(*) filter (where status in ('cod_placed','paid') and tracking->'outsource' is null and ${meta("orders")})::int own_meta,
        count(*) filter (where status in ('cod_placed','paid') and tracking->'outsource' is not null)::int routed_in,
        count(*) filter (where status = 'cancelled')::int cancelled,
        count(*) filter (where tracking->'outsource' is null and capi_sent_at is not null)::int own_purchase_sent,
        count(*) filter (where ${hour} and status in ('cod_placed','paid','cancelled') and tracking->'outsource' is null and ${meta("orders")})::int own_meta_h
      from orders where store_id = 8 and created_at > now() - interval '8 days' group by 1 order by 1`)) as unknown as unknown[];
    const hrs = (await db.execute(sql`select (extract(hour from created_at at time zone 'Asia/Kolkata'))::int h, count(*)::int open,
        count(*) filter (where ${meta("checkout_sessions")})::int meta_open
      from checkout_sessions where store_id = 8 and created_at > date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' group by 1 order by 1`)) as unknown as unknown[];
    console.log(`[fusion-audit] sessions=${JSON.stringify(s)}`);
    console.log(`[fusion-audit] orders=${JSON.stringify(o)}`);
    console.log(`[fusion-audit] todayByHour=${JSON.stringify(hrs)}`);
  } catch (e) {
    console.error("[fusion-audit]", e instanceof Error ? e.message : e);
  }
}

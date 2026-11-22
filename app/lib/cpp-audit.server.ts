// One-off: daily checkout → order → Meta Purchase numbers for the last 8 days (IST), to explain an ad-cost jump.
import { sql } from "drizzle-orm";
import { db } from "~/db.server";

let done = false;
export async function logCppAudit() {
  if (done) return;
  done = true;
  try {
    const day = sql`to_char(created_at at time zone 'Asia/Kolkata', 'MM-DD')`;
    const hourNow = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
    const sess = (await db.execute(sql`select store_id s, ${day} d, count(*)::int open,
        count(*) filter (where (extract(hour from created_at at time zone 'Asia/Kolkata'))::int < ${hourNow})::int open_by_hour
      from checkout_sessions where created_at > now() - interval '8 days' and store_id in (3, 8) group by 1, 2 order by 1, 2`)) as unknown as Record<string, unknown>[];
    const ord = (await db.execute(sql`select store_id s, ${day} d,
        count(*) filter (where status in ('cod_placed','paid'))::int placed,
        count(*) filter (where status = 'cancelled')::int cancelled,
        count(*) filter (where capi_sent_at is not null)::int meta_sent,
        count(*) filter (where status in ('cod_placed','paid') and capi_sent_at is null)::int meta_missing,
        count(*) filter (where status in ('cod_placed','paid') and (extract(hour from created_at at time zone 'Asia/Kolkata'))::int < ${hourNow})::int placed_by_hour,
        round(avg(total) filter (where status in ('cod_placed','paid')) / 100)::int aov,
        count(*) filter (where status in ('cod_placed','paid') and 'OTP skipped' = any(select jsonb_array_elements_text(coalesce(manual_tags,'[]'::jsonb))))::int otp_skipped
      from orders where created_at > now() - interval '8 days' and store_id in (3, 8) group by 1, 2 order by 1, 2`)) as unknown as Record<string, unknown>[];
    console.log(`[cpp-audit] hourNowIST=${hourNow} sessions=${JSON.stringify(sess)}`);
    console.log(`[cpp-audit] orders=${JSON.stringify(ord)}`);
  } catch (e) {
    console.error("[cpp-audit]", e instanceof Error ? e.message : e);
  }
}

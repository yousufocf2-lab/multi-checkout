// One-off: which checkout fields showed errors on Fusion Prime today (IST), and did those customers still order?
import { sql } from "drizzle-orm";
import { db } from "~/db.server";

let done = false;
export async function logFormAudit() {
  if (done) return;
  done = true;
  try {
    const since = sql`date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' - interval '1 day'`;
    const rows = (await db.execute(sql`
      select to_char(e.at at time zone 'Asia/Kolkata', 'MM-DD') d, f.field, count(*)::int times, count(distinct e.session_id)::int sessions,
        count(distinct e.session_id) filter (where exists (select 1 from orders o where o.session_id = e.session_id and o.status in ('cod_placed','paid','cancelled')))::int ordered
      from checkout_events e, jsonb_array_elements_text(coalesce(e.data->'fields', '[]'::jsonb)) f(field)
      where e.store_id = 8 and e.type = 'error' and e.at > ${since}
      group by 1, 2 order by 1, 3 desc`)) as unknown as unknown[];
    const forms = (await db.execute(sql`select e.data->>'form' form, count(*)::int n from checkout_events e
      where e.store_id = 8 and e.type = 'error' and e.at > ${since} and e.data->>'form' is not null group by 1 order by 2 desc limit 10`)) as unknown as unknown[];
    // Shape of what customers typed in failing fields (letters → a, digits → #; no real text logged)
    const samples = (await db.execute(sql`select distinct on (s.id) f.field,
        left(regexp_replace(regexp_replace(coalesce(s.customer->>f.field, ''), '[0-9]', '#', 'g'), '[A-Za-z]', 'a', 'g'), 40) typed, length(coalesce(s.customer->>f.field, '')) len
      from checkout_events e join checkout_sessions s on s.id = e.session_id, jsonb_array_elements_text(coalesce(e.data->'fields', '[]'::jsonb)) f(field)
      where e.store_id = 8 and e.type = 'error' and e.at > ${since} order by s.id, e.at desc limit 40`)) as unknown as unknown[];
    console.log(`[form-audit] fields=${JSON.stringify(rows)}`);
    console.log(`[form-audit] formMessages=${JSON.stringify(forms)}`);
    console.log(`[form-audit] samples=${JSON.stringify(samples)}`);
  } catch (e) {
    console.error("[form-audit]", e instanceof Error ? e.message : e);
  }
}

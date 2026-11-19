// What a store spent on OTP and WhatsApp messages, at the rates charged when each was sent.
// Reads both billing styles: monthly-plan usage (billing_usage) and prepaid wallet debits (wallet_transactions).
import { sql } from "drizzle-orm";
import { db } from "~/db.server";
import { addDays, type Range } from "./dates";
import { MSG_KINDS, PAGE_SIZE, type MsgFilter } from "./message-usage";


const typesFor = (f: MsgFilter) =>
  f === "all" ? MSG_KINDS.map((k) => k.id)
  : f === "whatsapp" ? MSG_KINDS.filter((k) => k.group !== "otp").map((k) => k.id)
  : MSG_KINDS.filter((k) => k.group === f).map((k) => k.id);

function source(storeId: number) {
  return sql`(
    select 'b' || u.id as id, u.type, u.amount_paise::bigint as amount, u.note, u.ref_id, u.created_at
      from billing_usage u where u.store_id = ${storeId}
    union all
    select 'w' || t.id as id, t.type, (-t.amount_paise)::bigint as amount, t.note, t.ref_id, t.created_at
      from wallet_transactions t join wallets w on w.id = t.wallet_id where w.store_id = ${storeId}
  )`;
}

export async function messageUsage(storeId: number, range: Range, filter: MsgFilter, page: number) {
  const since = new Date(`${range.since}T00:00:00+05:30`);
  const until = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const all = MSG_KINDS.map((k) => k.id);
  const inList = (ids: string[]) => sql.join(ids.map((t) => sql`${t}`), sql`, `);
  const when = sql`x.created_at >= ${since.toISOString()}::timestamptz and x.created_at < ${until.toISOString()}::timestamptz`;

  // Totals for every kind in the period (the breakdown); the list follows the filter
  const byType = (await db.execute(sql`
    select x.type, count(*)::int as n, coalesce(sum(x.amount), 0)::bigint as paise
    from ${source(storeId)} x where x.type in (${inList(all)}) and ${when} group by x.type`)) as unknown as { type: string; n: number; paise: string | number }[];

  const types = typesFor(filter);
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  // OTPs to the same number within 15 minutes are one request: the first send plus resends (like the MSG91 log).
  // Every send is still charged; the row shows how many went and the total.
  const rows = (await db.execute(sql`
    with x as (
      select x.*, o.phone_key, o.verified
      from ${source(storeId)} x
      left join lateral (
        select coalesce(co.phone, cu.target) as phone_key, coalesce(co.verified_at, cu.verified_at) is not null as verified
        from (select 1) one
        left join checkout_otps co on co.id = x.ref_id
        left join customer_otps cu on cu.id = x.ref_id
      ) o on x.type = 'otp'
      where x.type in (${inList(types)}) and ${when}
    ),
    k as (
      select x.*, case when x.type = 'otp' then x.type || ':' || coalesce(x.phone_key, x.note, x.id) || ':' || coalesce(split_part(x.note, ' ', 1), '') else x.id end as gkey
      from x
    ),
    b as (
      select k.*, case when k.type = 'otp' and k.created_at - lag(k.created_at) over (partition by k.gkey order by k.created_at) <= interval '15 minutes' then 0 else 1 end as brk
      from k
    ),
    g as (
      select b.*, sum(b.brk) over (partition by b.gkey order by b.created_at, b.id rows unbounded preceding) as grp from b
    )
    select min(g.id) as id, min(g.type) as type, min(g.note) as note, min(g.ref_id) as ref_id,
      min(g.created_at) as created_at, max(g.created_at) as last_at, count(*)::int as sends,
      sum(g.amount)::bigint as amount, bool_or(coalesce(g.verified, false)) as verified, bool_or(g.type = 'otp' and g.phone_key is not null) as known
    from g group by g.gkey, g.grp
    order by min(g.created_at) desc, min(g.id) desc limit ${PAGE_SIZE + 1} offset ${offset}`)) as unknown as {
      id: string; type: string; amount: string | number; note: string | null; ref_id: string; created_at: string | Date; last_at: string | Date; sends: number; verified: boolean; known: boolean;
    }[];

  return {
    totals: byType.map((r) => ({ type: r.type, count: Number(r.n), paise: Number(r.paise) })),
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id, type: r.type, paise: Number(r.amount), note: r.note, ref: r.ref_id,
      at: new Date(r.created_at).toISOString(), lastAt: new Date(r.last_at).toISOString(),
      resent: Math.max(0, Number(r.sends) - 1), verified: r.type === "otp" && r.known ? Boolean(r.verified) : null,
    })),
    hasMore: rows.length > PAGE_SIZE,
    page: Math.max(1, page),
  };
}

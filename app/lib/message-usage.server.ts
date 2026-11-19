// What a store spent on OTP and WhatsApp messages, at the rates charged when each was sent.
// Reads both billing styles: monthly-plan usage (billing_usage) and prepaid wallet debits (wallet_transactions).
import { sql } from "drizzle-orm";
import { db } from "~/db.server";
import { addDays, type Range } from "./dates";
import { MSG_KINDS, type MsgFilter } from "./message-usage";

export const PAGE_SIZE = 50;

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
  const rows = (await db.execute(sql`
    select x.id, x.type, x.amount, x.note, x.ref_id, x.created_at
    from ${source(storeId)} x where x.type in (${inList(types)}) and ${when}
    order by x.created_at desc, x.id desc limit ${PAGE_SIZE + 1} offset ${offset}`)) as unknown as { id: string; type: string; amount: string | number; note: string | null; ref_id: string; created_at: string | Date }[];

  return {
    totals: byType.map((r) => ({ type: r.type, count: Number(r.n), paise: Number(r.paise) })),
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id, type: r.type, paise: Number(r.amount), note: r.note, ref: r.ref_id,
      at: new Date(r.created_at).toISOString(),
    })),
    hasMore: rows.length > PAGE_SIZE,
    page: Math.max(1, page),
  };
}

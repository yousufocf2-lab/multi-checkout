// Best-selling order for storefront product rows: units sold in the last 60 days (placed orders, not cancelled).
import { sql } from "drizzle-orm";
import { db } from "~/db.server";

const WINDOW_DAYS = 60;
const TTL_MS = 10 * 60_000;
const cache = new Map<number, { at: number; units: Map<number, number> }>();

/** Units sold per catalog item id (gp:<id> lines) for one store. Cached for 10 minutes. */
export async function unitsSold(storeId: number) {
  const hit = cache.get(storeId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.units;
  const units = new Map<number, number>();
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const rows = (await db.execute(sql`
      select li->>'productId' as pid, sum(coalesce((li->>'quantity')::int, 0))::int as n
      from orders o, jsonb_array_elements(o.items) li
      where o.store_id = ${storeId} and o.status in ('paid', 'cod_placed') and o.created_at >= ${since.toISOString()}::timestamptz
        and coalesce(o.confirm_status, '') <> 'cancelled' and coalesce(o.call_status, '') <> 'cancelled'
        and coalesce((li->>'free')::boolean, false) = false
      group by 1`)) as unknown as { pid: string | null; n: number }[];
    for (const r of rows) {
      const id = r.pid?.startsWith("gp:") ? parseInt(r.pid.slice(3), 10) : NaN;
      if (Number.isFinite(id)) units.set(id, (units.get(id) ?? 0) + Number(r.n || 0));
    }
  } catch (e) {
    console.error("[sales-rank]", e instanceof Error ? e.message : e);
  }
  cache.set(storeId, { at: Date.now(), units });
  return units;
}

/** Most units first; products with equal sales keep their current order. */
export function byUnits<T extends { id: number }>(list: T[], units: Map<number, number>) {
  return list.map((p, i) => ({ p, i, n: units.get(p.id) ?? 0 })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.p);
}

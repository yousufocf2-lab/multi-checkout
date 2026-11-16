// Shipping → Remittance: money from delivered orders, worked out from the orders themselves.
// COD = the cash the courier collected (and owes the store); prepaid = the amount paid online.
// Only delivered orders count, dated by when they were delivered (IST).
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { addDays, bucketKeys, bucketLabel, granularityFor, type Range } from "./dates";
import { codAmount } from "./store-fulfil.server";

import type { PayFilter } from "./remittance";

const COURIER_NAME: Record<string, string> = { delhivery: "Delhivery", shiprocket: "Shiprocket", shipnex: "Shipnex", other: "Other" };

export async function remittance(storeId: number, range: Range, pay: PayFilter) {
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const rows = await db.select({
    id: orders.id, name: orders.shopifyOrderName, method: orders.paymentMethod, total: orders.total, advance: orders.advance, amountPaid: orders.amountPaid,
    courier: orders.courier, awb: orders.awb, at: orders.shipStatusAt, customer: orders.customer, status: orders.status,
  }).from(orders).where(and(
    eq(orders.storeId, storeId), eq(orders.shipStatus, "delivered"), inArray(orders.status, ["paid", "cod_placed"]),
    gte(orders.shipStatusAt, from), lt(orders.shipStatusAt, to),
  )).limit(20000);

  const g = granularityFor(range);
  const keys = bucketKeys(range, g);
  const buckets = new Map(keys.map((k) => [k, { key: k, label: bucketLabel(k, g), longLabel: bucketLabel(k, g, true), prepaid: 0, cod: 0, orders: 0, adSpend: null as number | null }]));
  const keyOf = (d: Date) => {
    const s = new Date(d.getTime() + 5.5 * 3600_000).toISOString();
    return g === "hour" ? `${s.slice(0, 10)} ${s.slice(11, 13)}` : g === "day" ? s.slice(0, 10) : s.slice(0, 7);
  };

  const t = { cod: 0, codOrders: 0, prepaid: 0, prepaidOrders: 0, advance: 0 };
  const byCourier = new Map<string, { name: string; cod: number; codOrders: number; prepaid: number; prepaidOrders: number }>();
  const list: { id: string; name: string; method: string; amount: number; courier: string; awb: string | null; at: string; customer: string; city: string }[] = [];

  for (const r of rows) {
    if (!r.at) continue;
    const isCod = r.method !== "prepaid";
    if (pay === "cod" && !isCod) continue;
    if (pay === "prepaid" && isCod) continue;
    // COD: cash collected at the door (total minus any advance paid online). Prepaid: paid online.
    const amount = (isCod ? codAmount({ paymentMethod: r.method, total: r.total, advance: r.advance } as Parameters<typeof codAmount>[0]) : (r.amountPaid ?? r.total)) / 100;
    const adv = isCod ? Math.max(0, r.total / 100 - amount) : 0;
    const b = buckets.get(keyOf(r.at));
    const c = byCourier.get(r.courier ?? "other") ?? { name: COURIER_NAME[r.courier ?? "other"] ?? r.courier ?? "Other", cod: 0, codOrders: 0, prepaid: 0, prepaidOrders: 0 };
    if (isCod) { t.cod += amount; t.codOrders++; t.advance += adv; c.cod += amount; c.codOrders++; if (b) b.cod += amount; }
    else { t.prepaid += amount; t.prepaidOrders++; c.prepaid += amount; c.prepaidOrders++; if (b) b.prepaid += amount; }
    if (b) b.orders++;
    byCourier.set(r.courier ?? "other", c);
    list.push({ id: r.id, name: r.name ?? `#${r.id.slice(-6).toUpperCase()}`, method: isCod ? "COD" : "Prepaid", amount, courier: c.name, awb: r.awb, at: r.at.toISOString(), customer: `${r.customer.firstName} ${r.customer.lastName}`.trim(), city: r.customer.city });
  }
  list.sort((a, b) => b.at.localeCompare(a.at));
  return {
    totals: { ...t, total: t.cod + t.prepaid, orders: t.codOrders + t.prepaidOrders },
    buckets: [...buckets.values()],
    couriers: [...byCourier.values()].sort((a, b) => b.cod + b.prepaid - (a.cod + a.prepaid)),
    list: list.slice(0, 300),
    listTotal: list.length,
  };
}

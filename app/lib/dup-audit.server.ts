// One-off: why Sakir Molla (#1006 and #34523, Fusion Prime) got two orders
import { and, eq, sql } from "drizzle-orm";
import { db, orders, stores } from "~/db.server";

export async function dupAudit() {
  try {
    const [s] = await db.select({ shield: stores.rtoShield }).from(stores).where(eq(stores.id, 8)).limit(1);
    console.log("[dup-audit] shield", JSON.stringify(s?.shield));
    const target = await db.select({ phone: sql<string>`${orders.customer}->>'phone'` }).from(orders)
      .where(and(eq(orders.storeId, 8), sql`${orders.shopifyOrderName} in ('#34523', '#1006', '#1005')`));
    const phones = [...new Set(target.map((t) => t.phone))];
    const rows = await db.select({
      id: orders.id, store: orders.storeId, name: orders.shopifyOrderName, status: orders.status, call: orders.callStatus, ship: orders.shipStatus, awb: orders.awb,
      total: orders.total, created: orders.createdAt, session: orders.sessionId, channel: orders.checkoutChannel, items: sql`${orders.items}::text`, assigned: orders.assignedTo,
      city: sql`${orders.customer}->>'city'`, phone: sql<string>`right(${orders.customer}->>'phone', 4)`,
    }).from(orders).where(sql`${orders.customer}->>'phone' in (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`).orderBy(orders.createdAt);
    for (const r of rows) console.log("[dup-audit] order", JSON.stringify({ ...r, items: String(r.items).slice(0, 160) }));
  } catch (e) { console.error("[dup-audit]", e); }
}

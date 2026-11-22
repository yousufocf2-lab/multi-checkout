// One-off (Fusion Prime): only the 12-label batch was really printed; labels downloaded while testing go back to
// "not printed" so they come in the next print. Only touches labels marked before this fix shipped.
import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, orders } from "~/db.server";

const STORE = 8;
const CUTOFF = new Date("2026-11-22T05:15:00Z");
let ran = false; // v2: keep only picked-up parcels as printed
export async function resetTestLabels() {
  if (ran) return;
  ran = true;
  try {
    const batches = await db.select({ batch: orders.labelBatch, n: sql<number>`count(*)::int`, first: sql<string>`min(${orders.labelPrintedAt})` }).from(orders)
      .where(and(eq(orders.storeId, STORE), isNotNull(orders.labelPrintedAt), lt(orders.labelPrintedAt, CUTOFF)))
      .groupBy(orders.labelBatch).orderBy(asc(sql`min(${orders.labelPrintedAt})`));
    console.log(`[label-reset] batches before: ${JSON.stringify(batches)}`);
    // Printed for real = already picked up by the courier. Labels of parcels still waiting for pickup go back.
    const res = await db.update(orders).set({ labelPrintedAt: null, labelBatch: null })
      .where(and(eq(orders.storeId, STORE), isNotNull(orders.labelPrintedAt), lt(orders.labelPrintedAt, CUTOFF), eq(orders.shipStatus, "pickup_pending")))
      .returning({ id: orders.id });
    const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.storeId, STORE), isNotNull(orders.labelPrintedAt)));
    console.log(`[label-reset] ${res.length} label(s) of parcels not picked up yet back to not printed; ${left?.n ?? 0} stay printed`);
  } catch (e) {
    console.error("[label-reset]", e instanceof Error ? e.message : e);
  }
}

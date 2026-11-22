// One-off (Fusion Prime): only the 12-label batch was really printed; labels downloaded while testing go back to
// "not printed" so they come in the next print. Only touches labels marked before this fix shipped.
import { and, asc, eq, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db, orders } from "~/db.server";

const STORE = 8;
const CUTOFF = new Date("2026-11-22T05:15:00Z");
let ran = false;
export async function resetTestLabels() {
  if (ran) return;
  ran = true;
  try {
    const batches = await db.select({ batch: orders.labelBatch, n: sql<number>`count(*)::int`, first: sql<string>`min(${orders.labelPrintedAt})` }).from(orders)
      .where(and(eq(orders.storeId, STORE), isNotNull(orders.labelPrintedAt), lt(orders.labelPrintedAt, CUTOFF)))
      .groupBy(orders.labelBatch).orderBy(asc(sql`min(${orders.labelPrintedAt})`));
    console.log(`[label-reset] batches before: ${JSON.stringify(batches)}`);
    const keep = batches.find((b) => b.n === 12);
    if (!keep?.batch) { console.log("[label-reset] no batch of exactly 12 found; nothing changed"); return; }
    const res = await db.update(orders).set({ labelPrintedAt: null, labelBatch: null })
      .where(and(eq(orders.storeId, STORE), isNotNull(orders.labelPrintedAt), lt(orders.labelPrintedAt, CUTOFF), ne(orders.labelBatch, keep.batch)))
      .returning({ id: orders.id });
    console.log(`[label-reset] kept batch "${keep.batch}" (12 printed); ${res.length} label(s) back to not printed`);
  } catch (e) {
    console.error("[label-reset]", e instanceof Error ? e.message : e);
  }
}

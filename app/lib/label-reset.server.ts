// One-off (Fusion Prime): the parcels already with the courier are the ones whose labels were really printed
// (21 Nov batch); mark them printed again. Labels of parcels still waiting for pickup stay "not printed".
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, orders } from "~/db.server";

let ran = false;
export async function resetTestLabels() {
  if (ran) return;
  ran = true;
  try {
    const res = await db.update(orders).set({ labelPrintedAt: new Date("2026-11-21T11:25:13Z"), labelBatch: "21 Nov, 4:55 pm" })
      .where(and(eq(orders.storeId, 8), eq(orders.courier, "delhivery"), isNull(orders.labelPrintedAt),
        inArray(orders.shipStatus, ["in_transit", "out_for_delivery", "ndr", "delivered"]), gt(orders.createdAt, new Date("2026-11-18T00:00:00Z"))))
      .returning({ id: orders.id });
    const [p] = await db.select({ printed: sql<number>`count(*) filter (where ${orders.labelPrintedAt} is not null)::int`, waiting: sql<number>`count(*) filter (where ${orders.labelPrintedAt} is null and ${orders.shipStatus} = 'pickup_pending')::int` })
      .from(orders).where(eq(orders.storeId, 8));
    console.log(`[label-reset] marked ${res.length} picked-up parcel(s) printed; now printed ${p?.printed}, waiting to print ${p?.waiting}`);
  } catch (e) {
    console.error("[label-reset]", e instanceof Error ? e.message : e);
  }
}

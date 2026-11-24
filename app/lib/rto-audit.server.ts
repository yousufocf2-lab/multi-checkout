// One-off: two AWBs show "RTO - In transit" on Delhivery but not in Growpefy (Fusion Prime)
import { inArray } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { trackDelhivery } from "~/lib/couriers/delhivery.server";
import { courierAccountsFor } from "~/lib/logistics.server";

const AWBS = ["45596510089526", "45596510089714"];
export async function rtoAudit() {
  try {
    const rows = await db.select({ id: orders.id, store: orders.storeId, name: orders.shopifyOrderName, status: orders.status, awb: orders.awb, courier: orders.courier, acc: orders.courierAccountId,
      ship: orders.shipStatus, raw: orders.shipStatusRaw, at: orders.shipStatusAt, checked: orders.shipCheckedAt, created: orders.createdAt }).from(orders).where(inArray(orders.awb, AWBS));
    console.log("[rto-audit] db", JSON.stringify(rows));
    const accs = (await courierAccountsFor(8)).filter((a) => a.courier === "delhivery");
    for (const a of accs) {
      const r = await trackDelhivery(a.creds.token ?? "", AWBS).catch((e) => String(e));
      console.log("[rto-audit] live acc", a.id, a.name, a.status, JSON.stringify(r));
    }
  } catch (e) { console.error("[rto-audit]", e); }
}

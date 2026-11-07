// Live shipment updates pushed by Shiprocket (Settings → API → Webhooks). Header x-api-key = the key shown in Growpefy.
// The path avoids words Shiprocket doesn't allow in webhook URLs.
import type { ActionFunctionArgs } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { courierAccounts, db, orders } from "~/db.server";
import { applyPushedStatuses } from "~/lib/logistics.server";

export const loader = () => new Response("ok"); // Shiprocket checks the URL with a GET

const same = (a: string, b: string) => {
  const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

export async function action({ request, params }: ActionFunctionArgs) {
  const storeId = Number(params.storeId);
  if (!storeId) return new Response("ok");
  const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, "shiprocket"))).limit(1);
  const key = request.headers.get("x-api-key") ?? "";
  if (!acc?.creds.token || !key || !same(key, acc.creds.token)) return new Response("unauthorized", { status: 401 });
  const b = (await request.json().catch(() => null)) as Record<string, any> | null;
  if (!b) return new Response("ok");
  const awb = String(b.awb ?? b.awb_code ?? "").trim();
  const status = String(b.current_status ?? b.shipment_status ?? "").trim();
  const srId = String(b.sr_order_id ?? "").trim();
  // An AWB assigned in the Shiprocket panel: put it on the order first (matched by Shiprocket's order id)
  if (awb && srId) {
    await db.update(orders).set({ awb }).where(and(eq(orders.storeId, storeId), eq(orders.courier, "shiprocket"), eq(orders.courierRef, srId)));
  }
  if (awb && status) {
    await applyPushedStatuses(storeId, "shiprocket", [{ awb, status, ref: b.order_id != null ? String(b.order_id) : undefined, at: b.current_timestamp ? String(b.current_timestamp) : undefined }]).catch((e) => console.error("[ship-hook]", e));
  }
  return new Response("ok");
}

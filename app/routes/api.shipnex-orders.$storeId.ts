// Shipnex pulls a Growpefy Store's orders that are ready to ship (orders that live in Growpefy, not on Shopify).
// GET /api/shipnex-orders/:storeId?since=2026-11-01T00:00:00Z   header X-Growpefy-Secret: <same secret as status updates>
// Shipnex then sends the AWB and status changes to /api/shipnex/:storeId with order_id = the order_id given here.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { courierAccounts, db, stores } from "~/db.server";
import { ordersToShip, shippingRows } from "~/lib/store-fulfil.server";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function loader({ request, params }: LoaderFunctionArgs) {
  const storeId = Number(params.storeId);
  if (!Number.isInteger(storeId) || storeId <= 0) return json({ ok: false, error: "Unknown store" }, { status: 404 });
  const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, storeId), eq(courierAccounts.courier, "shipnex"))).limit(1);
  const url = new URL(request.url);
  const given = request.headers.get("x-growpefy-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("secret") ?? "";
  if (!acc?.creds.token || !same(given, acc.creds.token)) return json({ ok: false, error: "Wrong or missing secret" }, { status: 401 });
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return json({ ok: false, error: "Unknown store" }, { status: 404 });
  const since = url.searchParams.get("since") ? new Date(url.searchParams.get("since")!) : undefined;
  const list = await ordersToShip(storeId, since && !Number.isNaN(since.getTime()) ? since : undefined);
  return json({ ok: true, orders: await shippingRows(store, list) });
}

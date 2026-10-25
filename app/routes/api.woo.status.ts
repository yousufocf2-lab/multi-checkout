// The WooCommerce plugin asks whether a checkout it sent us became an order, so it can empty the shopper's cart.
// Only says yes/no for a random session id the plugin already knows.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { and, eq, inArray } from "drizzle-orm";
import { db, orders, stores } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const u = new URL(request.url);
  const slug = String(u.searchParams.get("store") ?? "");
  const sid = String(u.searchParams.get("sid") ?? "");
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!slug || !/^[\w-]{10,40}$/.test(sid)) return new Response(JSON.stringify({ done: false }), { status: 400, headers });
  const [hit] = await db.select({ id: orders.id }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(stores.slug, slug), eq(orders.sessionId, sid), inArray(orders.status, ["paid", "cod_placed"]))).limit(1);
  return new Response(JSON.stringify({ done: Boolean(hit) }), { headers });
}

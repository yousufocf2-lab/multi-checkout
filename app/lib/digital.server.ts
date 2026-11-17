// Digital products: files attached to a catalog item (Physical switched off) unlock once the order is paid.
import { and, eq, inArray } from "drizzle-orm";
import { catalogItems, db, orders, type Order } from "~/db.server";
import { digitalFiles } from "./catalog.server";
import { streamPrivate } from "./media.server";

export type OrderDownload = { itemId: number; title: string; files: { name: string; bytes: number; url: string }[] };

/** Paid, not cancelled or fully refunded: the customer can download. */
function unlocked(o: Pick<Order, "status" | "confirmStatus" | "callStatus" | "refundStatus">) {
  return o.status === "paid" && o.confirmStatus !== "cancelled" && o.callStatus !== "cancelled" && o.refundStatus !== "full";
}

const itemIdOf = (productId: string) => (productId.startsWith("gp:") ? parseInt(productId.slice(3), 10) || 0 : 0);

export function hasDigital(o: Pick<Order, "items">) {
  return o.items.some((l) => l.digital);
}

/** Download buttons for an order (empty until it is paid). */
export async function orderDownloads(o: Order): Promise<{ locked: boolean; list: OrderDownload[] }> {
  if (!hasDigital(o)) return { locked: false, list: [] };
  if (!unlocked(o)) return { locked: true, list: [] };
  const ids = [...new Set(o.items.filter((l) => l.digital).map((l) => itemIdOf(l.productId ?? "")).filter(Boolean))];
  if (!ids.length) return { locked: false, list: [] };
  const rows = await db.select({ id: catalogItems.id, title: catalogItems.title, extra: catalogItems.extra }).from(catalogItems)
    .where(and(eq(catalogItems.storeId, o.storeId), inArray(catalogItems.id, ids)));
  const list = rows.map((r) => ({
    itemId: r.id, title: r.title,
    files: digitalFiles(r.extra).map((f, i) => ({ name: f.name, bytes: f.bytes, url: `/order/${o.id}/file/${r.id}/${i}` })),
  })).filter((x) => x.files.length);
  return { locked: false, list };
}

/** Streams one file after checking the order bought that product and is paid. */
export async function downloadForOrder(orderId: string, itemId: number, index: number) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o || !o.items.some((l) => l.digital && itemIdOf(l.productId ?? "") === itemId)) return new Response("Not found", { status: 404 });
  if (!unlocked(o)) return new Response("This download unlocks after payment.", { status: 403 });
  const [it] = await db.select({ extra: catalogItems.extra }).from(catalogItems).where(and(eq(catalogItems.id, itemId), eq(catalogItems.storeId, o.storeId))).limit(1);
  const f = it ? digitalFiles(it.extra)[index] : undefined;
  if (!f || !f.key.startsWith(`private/${o.storeId}/`)) return new Response("Not found", { status: 404 });
  console.log(`[digital] order=${o.id} item=${itemId} file=${index}`);
  return streamPrivate(f.key, f.name);
}

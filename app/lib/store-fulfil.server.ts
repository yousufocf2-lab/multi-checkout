// Growpefy Store orders (kept in Growpefy, "gp:" ids): what is ready to ship, marking shipped, and the Shipnex feed.
import { and, asc, eq, gt, inArray, isNull, like } from "drizzle-orm";
import { db, orders, type Order } from "~/db.server";
import { catalogSkus } from "./catalog.server";
import type { Store } from "~/db.server";

const READY = ["paid", "cod_placed"];

/** Paise the courier collects on delivery. */
export const codAmount = (o: Pick<Order, "paymentMethod" | "total" | "advance">) =>
  o.paymentMethod === "prepaid" ? 0 : o.paymentMethod === "partial" ? Math.max(0, o.total - (o.advance ?? 0)) : o.total;

export async function ordersToShip(storeId: number, since?: Date) {
  return db.select().from(orders)
    .where(and(eq(orders.storeId, storeId), inArray(orders.status, READY), like(orders.shopifyOrderId, "gp:%"), isNull(orders.awb), since ? gt(orders.createdAt, since) : undefined))
    .orderBy(asc(orders.createdAt)).limit(500);
}

export async function markShipped(storeId: number, orderId: string, courier: string, awb: string) {
  const a = awb.trim().replace(/\s+/g, "").slice(0, 40);
  if (!a) throw new Error("Enter the AWB / tracking number.");
  const r = await db.update(orders).set({ awb: a, courier: courier || "other", shipStatus: "in_transit", shipStatusRaw: "Shipped", shipStatusAt: new Date(), shipCheckedAt: new Date(0), updatedAt: new Date() })
    .where(and(eq(orders.storeId, storeId), eq(orders.id, orderId))).returning({ id: orders.id });
  if (!r.length) throw new Error("Order not found.");
}

/** Orders in the shape a courier / 3PL needs: address, items with SKU, COD amount. */
export async function shippingRows(store: Store, list: Order[]) {
  const skus = await catalogSkus(store, list.flatMap((o) => o.items.map((l) => l.variantId)));
  return list.map((o) => ({
    order_id: o.id,
    order_number: o.shopifyOrderName ?? o.id,
    created_at: o.createdAt.toISOString(),
    payment: o.paymentMethod === "prepaid" ? "prepaid" : "cod",
    cod_amount: codAmount(o) / 100,
    order_total: o.total / 100,
    customer: {
      name: `${o.customer.firstName} ${o.customer.lastName}`.trim(), phone: o.customer.phone, email: o.customer.email,
      address1: o.customer.address1, address2: o.customer.address2, city: o.customer.city, state: o.customer.state, pincode: o.customer.pincode,
    },
    items: o.items.map((l) => ({ sku: skus.get(l.variantId) || "", name: l.variantTitle ? `${l.title} - ${l.variantTitle}` : l.title, quantity: l.quantity, price: l.pricePaise / 100 })),
  }));
}

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** One row per item: works for courier bulk uploads (Shiprocket, Shipnex and others take similar columns). */
export function shippingCsv(rows: Awaited<ReturnType<typeof shippingRows>>) {
  const head = ["Order Number", "Order Date", "Payment", "COD Amount", "Order Total", "Name", "Phone", "Email", "Address 1", "Address 2", "City", "State", "Pincode", "SKU", "Product", "Quantity", "Unit Price"];
  const lines = [head.join(",")];
  for (const r of rows) for (const it of r.items) {
    lines.push([r.order_number, r.created_at.slice(0, 10), r.payment, r.cod_amount, r.order_total, r.customer.name, r.customer.phone, r.customer.email, r.customer.address1, r.customer.address2, r.customer.city, r.customer.state, r.customer.pincode, it.sku, it.name, it.quantity, it.price].map(csvCell).join(","));
  }
  return lines.join("\n");
}

// Changes to an order after it was placed: delivery address (also sent to the courier), items / prices and notes.
import { and, eq, sql } from "drizzle-orm";
import { accountForOrder } from "./logistics.server";
import { db, orders, type Order, type OrderCustomer, type OrderEvent, type OrderLine, type Store } from "~/db.server";
import { editDelhiveryAddress } from "./couriers/delhivery.server";
import { updateShiprocketAddress } from "./couriers/shiprocket-orders.server";
import { stateName } from "./states";

const clean = (v: unknown, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const event = (by: string, text: string): OrderEvent => ({ at: new Date().toISOString(), by, text });
const withEvent = (o: Pick<Order, "timeline">, e: OrderEvent) => [...(o.timeline ?? []), e].slice(-80);

export type AddressInput = Pick<OrderCustomer, "firstName" | "lastName" | "phone" | "email" | "address1" | "address2" | "city" | "state" | "pincode">;

export function readAddress(fd: FormData): AddressInput {
  return {
    firstName: clean(fd.get("firstName"), 60), lastName: clean(fd.get("lastName"), 60),
    phone: clean(fd.get("phone"), 20).replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""),
    email: clean(fd.get("email"), 120).toLowerCase(),
    address1: clean(fd.get("address1"), 200), address2: clean(fd.get("address2"), 200),
    city: clean(fd.get("city"), 60), state: clean(fd.get("state"), 60), pincode: clean(fd.get("pincode"), 6).replace(/\D/g, ""),
  };
}

export function addressError(a: AddressInput) {
  if (!a.firstName) return "Enter the customer's name.";
  if (!/^[6-9]\d{9}$/.test(a.phone)) return "Enter a valid 10-digit mobile number.";
  if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) return "Enter a valid email or leave it empty.";
  if (!a.address1) return "Enter the address.";
  if (!a.city || !a.state) return "Enter the city and state.";
  if (!/^\d{6}$/.test(a.pincode)) return "Enter a 6-digit pincode.";
  return null;
}

/**
 * Saves the new address on the order. If the order is already with the courier, the courier gets it too
 * (Delhivery / Shiprocket allow this until pickup). Returns a message for the owner.
 */
export async function updateOrderAddress(store: Store, o: Order, a: AddressInput, by: string): Promise<{ ok: string } | { error: string }> {
  const err = addressError(a);
  if (err) return { error: err };
  const before = o.customer;
  const customer: OrderCustomer = { ...before, ...a };
  const one = (c: Partial<OrderCustomer>) => [c.address1, c.address2, c.city, c.state, c.pincode].filter(Boolean).join(", ");

  let courierMsg = "";
  if (o.courier === "shiprocket" && o.courierRef) {
    const acc = await accountForOrder(store.id, o);
    const r = acc ? await updateShiprocketAddress(acc.creds, o.courierRef, { name: `${a.firstName} ${a.lastName}`.trim(), phone: a.phone, address1: a.address1, address2: a.address2, city: a.city, state: stateName(a.state) || a.state, pincode: a.pincode, email: a.email || undefined }) : { ok: false, error: "Shiprocket isn't connected" };
    courierMsg = r.ok ? " Updated in Shiprocket too." : ` Shiprocket didn't accept the change (${r.error}). If it's already picked up, change it with the courier.`;
  } else if (o.courier === "delhivery" && o.awb) {
    const acc = await accountForOrder(store.id, o);
    const r = acc?.creds.token ? await editDelhiveryAddress(acc.creds.token, o.awb, { name: `${a.firstName} ${a.lastName}`.trim(), phone: a.phone, address: `${one(a)}` }) : { ok: false, error: "Delhivery isn't connected" };
    courierMsg = r.ok ? " Updated with Delhivery too." : ` Delhivery didn't accept the change (${r.error}). If it's already picked up, change it with the courier.`;
  } else if (o.awb) {
    courierMsg = " This order is already with the courier: change the address in your courier's panel too.";
  }

  const e = event(by, `Address changed from “${one(before)}” to “${one(a)}”.${courierMsg}`);
  await db.update(orders).set({ customer, timeline: withEvent(o, e), updatedAt: new Date() }).where(eq(orders.id, o.id));
  return { ok: `Address saved.${courierMsg}` };
}

export async function updateOrderNotes(o: Order, notes: { staff: string; customer: string }, by: string) {
  const staff = notes.staff.trim().slice(0, 2000) || null;
  const customerNote = notes.customer.trim().slice(0, 2000) || null;
  const changes: string[] = [];
  if ((o.staffNote ?? null) !== staff) changes.push("staff note");
  if ((o.customerNote ?? null) !== customerNote) changes.push("note for the customer");
  if (!changes.length) return { ok: "Nothing changed." };
  const e = event(by, `Updated the ${changes.join(" and ")}.`);
  await db.update(orders).set({ staffNote: staff, customerNote, timeline: withEvent(o, e), updatedAt: new Date() }).where(eq(orders.id, o.id));
  return { ok: "Notes saved." };
}

export type ItemEdit = { variantId: string; productId?: string; title: string; variantTitle: string | null; image: string | null; quantity: number; pricePaise: number; comparePaise?: number | null };

/** Reads the items editor's JSON ("lines") and delivery charge from a form. */
export function readItems(fd: FormData): { lines: ItemEdit[]; shippingPaise: number } | null {
  try {
    const raw = JSON.parse(String(fd.get("lines") ?? "[]")) as ItemEdit[];
    if (!Array.isArray(raw)) return null;
    const lines = raw.slice(0, 50).map((l) => ({
      variantId: String(l.variantId ?? "").slice(0, 120), productId: l.productId ? String(l.productId).slice(0, 120) : undefined,
      title: clean(l.title, 200) || "Item", variantTitle: clean(l.variantTitle, 120) || null,
      image: typeof l.image === "string" && /^https?:\/\//.test(l.image) ? l.image : null,
      quantity: Math.max(1, Math.min(99, Math.round(Number(l.quantity) || 1))),
      pricePaise: Math.max(0, Math.min(10_000_000, Math.round(Number(l.pricePaise) || 0))),
      comparePaise: l.comparePaise != null ? Math.max(0, Math.round(Number(l.comparePaise) || 0)) : null,
    }));
    return { lines, shippingPaise: Math.max(0, Math.min(100_000, Math.round(Number(fd.get("shippingPaise")) || 0))) };
  } catch {
    return null;
  }
}

/**
 * Changes the products, quantities and prices of a cash-on-delivery order before it's booked with the courier.
 * The amount to collect moves by the same amount as the items and delivery charge; discounts and fees stay.
 */
export async function updateOrderItems(o: Order, edit: { lines: ItemEdit[]; shippingPaise: number }, by: string): Promise<{ ok: string } | { error: string }> {
  if (o.status === "cancelled" || o.cancelledAt) return { error: "This order is cancelled." };
  if (o.paymentMethod !== "cod" || o.status !== "cod_placed") return { error: "Only cash on delivery orders can be changed here (the payment is already fixed for paid orders)." };
  if (o.awb) return { error: `Already booked with the courier (AWB ${o.awb}), so the amount to collect can't change now.` };
  if (!edit.lines.length) return { error: "Keep at least one product." };
  if (edit.lines.some((l) => !l.variantId)) return { error: "A product is missing. Remove it and add it again from the search." };
  const before = new Map(o.items.map((l) => [l.variantId, l]));
  const items: OrderLine[] = edit.lines.map((l) => {
    const old = before.get(l.variantId);
    return {
      ...(old ?? {}),
      variantId: l.variantId, productId: l.productId ?? old?.productId, title: l.title, variantTitle: l.variantTitle, image: l.image ?? old?.image ?? null,
      quantity: l.quantity, pricePaise: l.pricePaise, comparePaise: l.comparePaise ?? old?.comparePaise ?? null,
      free: l.pricePaise === 0 ? old?.free : undefined,
    };
  });
  const subtotal = items.reduce((s, l) => s + l.pricePaise * l.quantity, 0);
  const total = Math.max(0, o.total - o.subtotal - o.shipping + subtotal + edit.shippingPaise);
  const desc = (l: Pick<OrderLine, "title" | "variantTitle" | "quantity" | "pricePaise">) => `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} ×${l.quantity} @ ₹${(l.pricePaise / 100).toLocaleString("en-IN")}`;
  const same = JSON.stringify(o.items.map(desc)) === JSON.stringify(items.map(desc)) && o.shipping === edit.shippingPaise;
  if (same) return { ok: "Nothing changed." };
  const onShopify = Boolean(o.shopifyOrderId && !o.shopifyOrderId.startsWith("gp:"));
  const e = event(by, `Items changed: ${o.items.map(desc).join(", ")} → ${items.map(desc).join(", ")}. ${o.shipping !== edit.shippingPaise ? `Delivery ₹${o.shipping / 100} → ₹${edit.shippingPaise / 100}. ` : ""}To collect ₹${(o.total / 100).toLocaleString("en-IN")} → ₹${(total / 100).toLocaleString("en-IN")}.`);
  await db.update(orders).set({ items, subtotal, shipping: edit.shippingPaise, total, timeline: withEvent(o, e), updatedAt: new Date() }).where(and(eq(orders.id, o.id), sql`${orders.awb} is null`));
  return { ok: `Items saved. Collect ₹${(total / 100).toLocaleString("en-IN")} on delivery.${onShopify ? " Change the order in Shopify too." : ""}` };
}

// Changes to an order after it was placed: delivery address (also sent to the courier) and notes.
import { and, eq } from "drizzle-orm";
import { courierAccounts, db, orders, type Order, type OrderCustomer, type OrderEvent, type Store } from "~/db.server";
import { editDelhiveryAddress } from "./couriers/delhivery.server";
import { updateShiprocketAddress } from "./couriers/shiprocket-orders.server";
import { stateName } from "./states";

const clean = (v: unknown, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const event = (by: string, text: string): OrderEvent => ({ at: new Date().toISOString(), by, text });
const withEvent = (o: Pick<Order, "timeline">, e: OrderEvent) => [...(o.timeline ?? []), e].slice(-50);

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
    const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), eq(courierAccounts.courier, "shiprocket"))).limit(1);
    const r = acc ? await updateShiprocketAddress(acc.creds, o.courierRef, { name: `${a.firstName} ${a.lastName}`.trim(), phone: a.phone, address1: a.address1, address2: a.address2, city: a.city, state: stateName(a.state) || a.state, pincode: a.pincode, email: a.email || undefined }) : { ok: false, error: "Shiprocket isn't connected" };
    courierMsg = r.ok ? " Updated in Shiprocket too." : ` Shiprocket didn't accept the change (${r.error}). If it's already picked up, change it with the courier.`;
  } else if (o.courier === "delhivery" && o.awb) {
    const [acc] = await db.select().from(courierAccounts).where(and(eq(courierAccounts.storeId, store.id), eq(courierAccounts.courier, "delhivery"))).limit(1);
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

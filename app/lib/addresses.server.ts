import { and, desc, eq, sql } from "drizzle-orm";
import { customerAddresses, db, type CustomerAddress, type Order } from "~/db.server";
import { addressKey, maskName, maskText, type MaskedAddress } from "./addresses";

const MAX_PER_PHONE = 5;

export function toMasked(a: CustomerAddress): MaskedAddress {
  return {
    id: a.id,
    name: maskName(a.firstName, a.lastName),
    line: [maskText(a.address1), a.address2 ? maskText(a.address2) : ""].filter(Boolean).join(", "),
    city: a.city,
    state: a.state,
    pincode: a.pincode,
  };
}

/** Saved addresses for a phone (any store), newest first, masked. */
export async function lookupAddresses(phone: string): Promise<MaskedAddress[]> {
  if (!/^\d{10}$/.test(phone)) return [];
  const rows = await db.select().from(customerAddresses).where(eq(customerAddresses.phone, phone)).orderBy(desc(customerAddresses.lastUsedAt)).limit(MAX_PER_PHONE);
  return rows.map(toMasked);
}

/** Full address, only for its own phone. Call after the phone is OTP-verified. */
export async function revealAddress(id: number, phone: string) {
  const [a] = await db.select().from(customerAddresses).where(and(eq(customerAddresses.id, id), eq(customerAddresses.phone, phone))).limit(1);
  return a ?? null;
}

/** Saves (or refreshes) the order's address for next time, if the customer agreed. Never throws. */
export async function saveOrderAddress(order: Order) {
  try {
    if (!order.saveAddress) return;
    const c = order.customer;
    if (!/^\d{10}$/.test(c.phone) || !c.address1 || !/^\d{6}$/.test(c.pincode)) return;
    const key = addressKey(c.address1, c.pincode);
    const values = {
      phone: c.phone, addrKey: key, firstName: c.firstName.slice(0, 80), lastName: (c.lastName ?? "").slice(0, 80), email: (c.email ?? "").slice(0, 160),
      address1: c.address1.slice(0, 300), address2: (c.address2 ?? "").slice(0, 300), city: c.city.slice(0, 80), state: c.state.slice(0, 4), pincode: c.pincode,
      sourceStoreId: order.storeId, lastUsedAt: new Date(),
    };
    await db.insert(customerAddresses).values(values).onConflictDoUpdate({
      target: [customerAddresses.phone, customerAddresses.addrKey],
      set: { firstName: values.firstName, lastName: values.lastName, email: sql`coalesce(nullif(${values.email}, ''), ${customerAddresses.email})`, address1: values.address1, address2: values.address2, city: values.city, state: values.state, lastUsedAt: values.lastUsedAt },
    });
    // Keep only the latest few per phone
    await db.execute(sql`delete from customer_addresses where phone = ${c.phone} and id not in (select id from customer_addresses where phone = ${c.phone} order by last_used_at desc limit ${MAX_PER_PHONE})`);
  } catch (e) {
    console.error(`[addresses] order ${order.id}:`, e instanceof Error ? e.message : e);
  }
}

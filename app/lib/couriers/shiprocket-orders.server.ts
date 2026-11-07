// Shiprocket orders: website orders are created in the store's Shiprocket panel (like Shopify's Shiprocket app),
// and what happens there (AWB assigned, picked up, cancelled) is read back.
import type { CourierCreds, Order } from "~/db.server";
import { http, withSession, CourierAuthError } from "./common.server";
import { SR, shiprocketLogin } from "./providers.server";

const session = <R,>(c: CourierCreds, fn: (token: string) => Promise<R>) =>
  withSession(`shiprocket:${c.email}`, 8 * 86400_000, () => shiprocketLogin(c), fn);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const msg = (b: Record<string, any> | null) => {
  if (!b) return "";
  if (b.errors && typeof b.errors === "object") return Object.values(b.errors).flat().join(" ").slice(0, 200);
  return String(b.message ?? b.error ?? "").slice(0, 200);
};
const rupees = (paise: number) => Math.round(paise) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const istDate = (d: Date) => { const t = new Date(d.getTime() + 330 * 60_000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`; };

/** First pickup address name on the account, when the store didn't type one. */
async function pickupLocation(c: CourierCreds, token: string) {
  if (c.pickupName) return c.pickupName;
  const r = await http(`${SR()}/settings/company/pickup`, { headers: bearer(token), label: "Shiprocket" });
  const list = r.body?.data?.shipping_address;
  const first = Array.isArray(list) ? (list.find((p: any) => p.is_primary_location) ?? list[0]) : null;
  if (!first?.pickup_location) throw new Error("Add a pickup address in Shiprocket (Settings → Pickup addresses) first.");
  return String(first.pickup_location);
}

export type ShiprocketOrderInput = { order: Order; ref: string; codPaise: number; weightGrams: number; skus: Map<string, string> };

/** Creates the order in the Shiprocket panel. Returns Shiprocket's order id (and AWB if one was assigned straight away). */
export async function createShiprocketOrder(c: CourierCreds, input: ShiprocketOrderInput): Promise<{ ok: true; ref: string; awb: string | null } | { ok: false; error: string }> {
  const { order: o } = input;
  const cu = o.customer;
  try {
    return await session(c, async (token) => {
      const lines = o.items.filter((l) => l.quantity > 0);
      const itemsPaise = lines.reduce((s, l) => s + l.pricePaise * l.quantity, 0);
      const chargesPaise = o.shipping + o.paymentFee + o.tip;
      const collect = o.paymentMethod === "prepaid" ? o.total : input.codPaise;
      const discountPaise = Math.max(0, itemsPaise + chargesPaise - collect);
      const phone = String(cu.phone ?? "").replace(/\D/g, "").slice(-10);
      const body = {
        order_id: input.ref,
        order_date: istDate(o.createdAt),
        pickup_location: await pickupLocation(c, token),
        billing_customer_name: (cu.firstName || "Customer").slice(0, 60),
        billing_last_name: (cu.lastName || "").slice(0, 60),
        billing_address: (cu.address1 || "").slice(0, 190),
        billing_address_2: (cu.address2 || "").slice(0, 190),
        billing_city: cu.city,
        billing_pincode: String(cu.pincode ?? "").replace(/\D/g, ""),
        billing_state: cu.state,
        billing_country: "India",
        billing_email: cu.email || "",
        billing_phone: phone,
        shipping_is_billing: true,
        order_items: lines.map((l) => ({
          name: `${l.title}${l.variantTitle ? ` - ${l.variantTitle}` : ""}`.slice(0, 200),
          sku: (input.skus.get(l.variantId) || l.variantId).slice(0, 50),
          units: l.quantity,
          selling_price: rupees(l.pricePaise),
          discount: 0, tax: "", hsn: "",
        })),
        payment_method: o.paymentMethod === "prepaid" ? "Prepaid" : "COD",
        shipping_charges: rupees(chargesPaise),
        giftwrap_charges: 0, transaction_charges: 0,
        total_discount: rupees(discountPaise),
        sub_total: rupees(itemsPaise),
        length: 15, breadth: 12, height: 8,
        weight: Math.max(0.1, Math.round(input.weightGrams) / 1000),
      };
      const r = await http(`${SR()}/orders/create/adhoc`, { method: "POST", headers: bearer(token), body: JSON.stringify(body), label: "Shiprocket" });
      if (r.status === 401) throw new CourierAuthError("Shiprocket session expired");
      const ref = r.body?.order_id ?? r.body?.data?.order_id;
      if (!r.ok || !ref) return { ok: false as const, error: `Shiprocket: ${msg(r.body) || `error ${r.status}`}` };
      return { ok: true as const, ref: String(ref), awb: r.body?.awb_code ? String(r.body.awb_code) : null };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Shiprocket didn't respond" };
  }
}

export type ShiprocketOrderState = { status: string; awb: string | null; courierName: string | null };

/** What the Shiprocket panel shows for this order now (status, AWB once a courier is assigned). */
export async function shiprocketOrderState(c: CourierCreds, ref: string): Promise<ShiprocketOrderState | null> {
  return session(c, async (token) => {
    const r = await http(`${SR()}/orders/show/${encodeURIComponent(ref)}`, { headers: bearer(token), label: "Shiprocket" });
    if (r.status === 401) throw new CourierAuthError("Shiprocket session expired");
    const d = r.body?.data;
    if (!r.ok || !d) return null;
    const ship = Array.isArray(d.shipments) ? d.shipments[0] : d.shipments;
    const awb = ship?.awb || d.awb_data?.awb || null;
    return { status: String(d.status ?? ""), awb: awb ? String(awb) : null, courierName: ship?.courier ? String(ship.courier) : null };
  });
}

export async function cancelShiprocketOrder(c: CourierCreds, ref: string): Promise<{ ok: boolean; error?: string }> {
  try {
    return await session(c, async (token) => {
      const r = await http(`${SR()}/orders/cancel`, { method: "POST", headers: bearer(token), body: JSON.stringify({ ids: [Number(ref) || ref] }), label: "Shiprocket" });
      if (r.status === 401) throw new CourierAuthError("Shiprocket session expired");
      return r.ok ? { ok: true } : { ok: false, error: msg(r.body) || `error ${r.status}` };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Shiprocket didn't respond" };
  }
}

/** New delivery address for an order in the Shiprocket panel (allowed until it's picked up). */
export async function updateShiprocketAddress(c: CourierCreds, ref: string, a: { name: string; phone: string; address1: string; address2: string; city: string; state: string; pincode: string; email?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    return await session(c, async (token) => {
      const r = await http(`${SR()}/orders/address/update`, {
        method: "POST", headers: bearer(token), label: "Shiprocket",
        body: JSON.stringify({
          order_id: Number(ref) || ref, shipping_customer_name: a.name.slice(0, 60), shipping_phone: a.phone.replace(/\D/g, "").slice(-10),
          shipping_address: a.address1.slice(0, 190), shipping_address_2: a.address2.slice(0, 190), shipping_city: a.city, shipping_state: a.state,
          shipping_country: "India", shipping_pincode: a.pincode.replace(/\D/g, ""), ...(a.email ? { shipping_email: a.email } : {}),
        }),
      });
      if (r.status === 401) throw new CourierAuthError("Shiprocket session expired");
      return r.ok ? { ok: true } : { ok: false, error: msg(r.body) || `error ${r.status}` };
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Shiprocket didn't respond" };
  }
}

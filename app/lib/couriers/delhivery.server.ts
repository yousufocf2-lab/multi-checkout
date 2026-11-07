// Delhivery: token check and shipment tracking. Token = Delhivery One → Settings → API Setup.
import type { ShipStatus } from "../rto-shield";
import type { TrackResult } from "./common.server";

const BASE = () => (process.env.DELHIVERY_BASE_URL || "https://track.delhivery.com").replace(/\/+$/, "");
const headers = (token: string) => ({ Authorization: `Token ${token}`, Accept: "application/json" });

/** Checks the token with a cheap call (pincode serviceability). */
export async function testDelhiveryToken(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE()}/c/api/pin-codes/json/?filter_codes=110001`, { headers: headers(token), signal: AbortSignal.timeout(12_000) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Delhivery didn't accept this token. Copy it again from Delhivery One → Settings → API Setup." };
    if (!res.ok) return { ok: false, error: `Delhivery returned an error (${res.status}). Try again in a minute.` };
    const body = (await res.json().catch(() => null)) as { delivery_codes?: unknown[] } | null;
    if (!body || !Array.isArray(body.delivery_codes)) return { ok: false, error: "Delhivery didn't accept this token. Check that it's the live token, not staging." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't reach Delhivery: ${e instanceof Error ? e.message : "network error"}` };
  }
}

/** Delhivery Status + StatusType → our status. null = no change (e.g. a reverse pickup in progress). */
export function mapDelhivery(status: string, type: string): ShipStatus | null {
  const s = status.trim().toLowerCase();
  const t = type.trim().toUpperCase();
  if (t === "CN" || s.includes("cancel")) return "cancelled";
  if (t === "DL") {
    if (s === "rto" || s.includes("rto")) return "rto";
    if (s === "dto" || s.includes("dto")) return "returned";
    return "delivered";
  }
  if (t === "RT") return "rto_transit";
  if (t === "PU") return null;
  if (s === "delivered") return "delivered";
  if (s.includes("rto")) return "rto_transit";
  return "in_transit"; // UD: manifested, pending, in transit, dispatched…
}

/** Tracks up to 50 AWBs in one call. */
export async function trackDelhivery(token: string, awbs: string[]): Promise<TrackResult[]> {
  const list = [...new Set(awbs.filter(Boolean))].slice(0, 50);
  if (!list.length) return [];
  const res = await fetch(`${BASE()}/api/v1/packages/json/?waybill=${encodeURIComponent(list.join(","))}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error("Delhivery token was rejected. Reconnect Delhivery.");
  if (!res.ok) throw new Error(`Delhivery tracking error ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { ShipmentData?: { Shipment?: { AWB?: string; Status?: { Status?: string; StatusType?: string; StatusDateTime?: string } } }[] };
  return (body.ShipmentData ?? []).map((d) => {
    const sh = d.Shipment ?? {};
    const st = sh.Status ?? {};
    const at = st.StatusDateTime ? new Date(st.StatusDateTime) : null;
    return { awb: String(sh.AWB ?? ""), status: mapDelhivery(st.Status ?? "", st.StatusType ?? ""), raw: [st.StatusType, st.Status].filter(Boolean).join(" · "), at: at && !isNaN(at.getTime()) ? at : null };
  }).filter((r) => r.awb);
}

export type DelhiveryShipment = {
  order: string; name: string; phone: string; address: string; city: string; state: string; pin: string;
  cod: boolean; codAmount: number; total: number; products: string; quantity: number; weightGrams: number; email?: string;
};

/**
 * Creates one forward shipment in Delhivery (manifest). Delhivery assigns the AWB (waybill).
 * pickup = the pickup location (warehouse) name exactly as registered in Delhivery One.
 */
export async function createDelhiveryShipment(token: string, pickup: string, s: DelhiveryShipment): Promise<{ ok: true; awb: string } | { ok: false; error: string }> {
  const data = {
    shipments: [{
      name: s.name.slice(0, 100), add: s.address.slice(0, 250), pin: s.pin, city: s.city, state: s.state, country: "India", phone: s.phone,
      order: s.order, payment_mode: s.cod ? "COD" : "Prepaid", cod_amount: s.cod ? s.codAmount.toFixed(2) : "0", total_amount: s.total.toFixed(2),
      products_desc: s.products.slice(0, 250), quantity: String(s.quantity), weight: String(Math.max(1, Math.round(s.weightGrams))),
      shipping_mode: "Surface", ...(s.email ? { email: s.email } : {}),
    }],
    pickup_location: { name: pickup },
  };
  try {
    const res = await fetch(`${BASE()}/api/cmu/create.json`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/x-www-form-urlencoded" },
      body: `format=json&data=${encodeURIComponent(JSON.stringify(data))}`,
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Delhivery token was rejected. Reconnect Delhivery." };
    const body = (await res.json().catch(() => null)) as { success?: boolean; rmk?: string; packages?: { waybill?: string; status?: string; remarks?: string[] | string }[] } | null;
    const pkg = body?.packages?.[0];
    if (pkg?.waybill && String(pkg.status ?? "").toLowerCase() === "success") return { ok: true, awb: String(pkg.waybill) };
    const why = [pkg?.remarks, body?.rmk].flat().filter(Boolean).join(" ").slice(0, 300);
    return { ok: false, error: why || `Delhivery couldn't create the shipment (${res.status}).` };
  } catch (e) {
    return { ok: false, error: `Couldn't reach Delhivery: ${e instanceof Error ? e.message : "network error"}` };
  }
}

/** Cancels a shipment that hasn't been picked up yet. */
export async function cancelDelhiveryShipment(token: string, awb: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE()}/api/p/edit`, {
      method: "POST", headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ waybill: awb, cancellation: "true" }), signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { status?: boolean | string; remark?: string; error?: string } | null;
    if (res.ok && (body?.status === true || String(body?.status).toLowerCase() === "true")) return { ok: true };
    return { ok: false, error: String(body?.remark ?? body?.error ?? `Delhivery error ${res.status}`).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** New delivery name / phone / address for a booked shipment. Delhivery allows it until the parcel is picked up. */
export async function editDelhiveryAddress(token: string, awb: string, a: { name: string; phone: string; address: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE()}/api/p/edit`, {
      method: "POST", headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ waybill: awb, name: a.name.slice(0, 60), phone: a.phone, add: a.address.slice(0, 250) }), signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as { status?: boolean | string; remark?: string; error?: string } | null;
    if (res.ok && (body?.status === true || String(body?.status).toLowerCase() === "true")) return { ok: true };
    return { ok: false, error: String(body?.remark ?? body?.error ?? `Delhivery error ${res.status}`).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

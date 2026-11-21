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
  if (t === "UD" && s === "dispatched") return "out_for_delivery";
  // Booked but the courier hasn't picked the parcel up yet
  if (/manifest|not picked|pickup|ready to ship|^open$/.test(s)) return "pickup_pending";
  return "in_transit"; // UD: in transit, pending, dispatched…
}

/** Tracks up to 50 AWBs in one call. */
export async function trackDelhivery(token: string, awbs: string[]): Promise<TrackResult[]> {
  const list = [...new Set(awbs.filter(Boolean))].slice(0, 50);
  if (!list.length) return [];
  const res = await fetch(`${BASE()}/api/v1/packages/json/?waybill=${encodeURIComponent(list.join(","))}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error("Delhivery token was rejected. Reconnect Delhivery.");
  if (!res.ok) throw new Error(`Delhivery tracking error ${res.status}`);
  type Scan = { ScanDetail?: { Scan?: string; ScanType?: string; Instructions?: string; ScanDateTime?: string } };
  const body = (await res.json().catch(() => ({}))) as { ShipmentData?: { Shipment?: { AWB?: string; Status?: { Status?: string; StatusType?: string; StatusDateTime?: string; Instructions?: string }; Scans?: Scan[] } }[] };
  return (body.ShipmentData ?? []).map((d) => {
    const sh = d.Shipment ?? {};
    const st = sh.Status ?? {};
    const at = st.StatusDateTime ? new Date(st.StatusDateTime) : null;
    let status = mapDelhivery(st.Status ?? "", st.StatusType ?? "");
    // Scan history: each "Dispatched" (UD) scan is one trip out for delivery; a "Pending" scan after it is a failed attempt (NDR)
    const scans = (sh.Scans ?? []).map((x) => x.ScanDetail ?? {}).filter((x) => x.Scan);
    let attempts = 0, lastOfd = -1;
    scans.forEach((x, i) => { if ((x.ScanType ?? "").toUpperCase() === "UD" && /^dispatched$/i.test(x.Scan ?? "")) { attempts++; lastOfd = i; } });
    let ndrReason: string | null = null;
    if (status === "in_transit" && attempts > 0 && lastOfd >= 0) {
      const after = scans.slice(lastOfd + 1).find((x) => (x.ScanType ?? "").toUpperCase() === "UD" && x.Instructions && !/dispatched|out for delivery/i.test(x.Instructions));
      if (after || /pending/i.test(st.Status ?? "")) { status = "ndr"; ndrReason = (after?.Instructions ?? st.Instructions ?? "").slice(0, 160) || null; }
    }
    if (status === "out_for_delivery" && attempts === 0) attempts = 1;
    return { awb: String(sh.AWB ?? ""), status, raw: [st.StatusType, st.Status].filter(Boolean).join(" · "), at: at && !isNaN(at.getTime()) ? at : null, attempts: scans.length ? attempts : undefined, ndrReason };
  }).filter((r) => r.awb);
}

/** NDR action: ask Delhivery to try delivering again (up to 50 AWBs per call). */
export async function delhiveryReattempt(token: string, awbs: string[]): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
  const list = [...new Set(awbs.filter(Boolean))].slice(0, 50);
  if (!list.length) return { ok: false, error: "No AWB" };
  try {
    const res = await fetch(`${BASE()}/api/p/update`, {
      method: "POST", headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ data: list.map((waybill) => ({ waybill, act: "RE-ATTEMPT" })) }), signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Delhivery rejected the token." };
    if (!res.ok || body.error || body.success === false) return { ok: false, error: String(body.error ?? body.message ?? body.rmk ?? `Delhivery error ${res.status}: ${text.slice(0, 160)}`) };
    return { ok: true, ref: String(body.request_id ?? body.upl ?? body.UPL ?? "") || null };
  } catch (e) {
    return { ok: false, error: `Couldn't reach Delhivery: ${e instanceof Error ? e.message : "network error"}` };
  }
}

export type DelhiveryShipment = {
  order: string; name: string; phone: string; address: string; city: string; state: string; pin: string;
  cod: boolean; codAmount: number; total: number; products: string; quantity: number; weightGrams: number; email?: string;
};

/**
 * Creates one forward shipment in Delhivery (manifest). Delhivery assigns the AWB (waybill).
 * pickup = the pickup location (warehouse) name exactly as registered in Delhivery One.
 */
export async function createDelhiveryShipment(token: string, pickup: string, s: DelhiveryShipment): Promise<{ ok: true; awb: string } | { ok: false; error: string; unserviceable?: boolean }> {
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
    // "Crashing while saving package due to exception '332602 is non serviceable pincode'…" → plain words
    const pin = /(\d{6})\s+is\s+non[-\s]?serviceable/i.exec(why)?.[1];
    if (pin) return { ok: false, error: `Delhivery doesn't deliver to pincode ${pin}${s.cod ? " for COD" : ""} from your pickup location (${pickup}).`, unserviceable: true };
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

export type PackingSlip = { awb: string; sortCode: string | null; destination: string | null; sellerName: string | null; sellerAddress: string | null; returnAddress: string | null };

let loggedSlipKeys = false;
/** Label data Delhivery has for booked shipments (routing / sort code, hub). Up to 100 AWBs per call. */
export async function delhiveryPackingSlips(token: string, awbs: string[]): Promise<Map<string, PackingSlip>> {
  const out = new Map<string, PackingSlip>();
  const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);
  for (let i = 0; i < awbs.length; i += 100) {
    const part = awbs.slice(i, i + 100);
    try {
      const res = await fetch(`${BASE()}/api/p/packing_slip?wbns=${encodeURIComponent(part.join(","))}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) });
      const body = (await res.json().catch(() => null)) as { packages?: Record<string, unknown>[] } | null;
      if (!loggedSlipKeys && body?.packages?.[0]) {
        loggedSlipKeys = true;
        console.log("[labels] delhivery packing slip fields:", Object.keys(body.packages[0]).join(","));
      }
      for (const p of body?.packages ?? []) {
        const awb = str(p.wbn ?? p.waybill ?? p.awb);
        if (!awb) continue;
        out.set(awb, {
          awb,
          sortCode: str(p.sort_code ?? p.sortcode ?? p.sc),
          destination: str(p.destination ?? p.dest ?? p.destination_city),
          sellerName: str(p.snm ?? p.seller_name ?? p.cl),
          sellerAddress: str(p.sadd ?? p.seller_add ?? p.seller_address),
          returnAddress: str(p.radd ?? p.return_add ?? p.rto_add),
        });
      }
      if (!res.ok) console.error("[labels] packing slip", res.status);
    } catch (e) {
      console.error("[labels] packing slip", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

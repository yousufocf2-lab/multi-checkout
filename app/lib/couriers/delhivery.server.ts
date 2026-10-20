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

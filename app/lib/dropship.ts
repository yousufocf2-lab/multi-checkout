// Dropshipping maths shared by server and browser (admin only). Money is paise.
import type { DropshipZones } from "~/db/schema";

export type Zone = keyof DropshipZones;

export const ZONES: { id: Zone; label: string; hint: string }[] = [
  { id: "A", label: "Zone A · Within city", hint: "Delhi NCR: Delhi, Gurugram, Noida, Greater Noida, Ghaziabad, Faridabad" },
  { id: "B", label: "Zone B · Within region", hint: "Haryana, Punjab, Chandigarh, Himachal, Rajasthan, Uttar Pradesh, Uttarakhand" },
  { id: "C", label: "Zone C · Metro to metro", hint: "Mumbai, Bengaluru, Chennai, Kolkata, Hyderabad, Pune, Ahmedabad" },
  { id: "D", label: "Zone D · Rest of India", hint: "Everywhere else (Kerala included)" },
  { id: "E", label: "Zone E · Special zone", hint: "North-East states, Jammu & Kashmir, Ladakh, Andaman & Nicobar, Lakshadweep" },
];

export const DEFAULT_ZONES: DropshipZones = { A: 1400, B: 1700, C: 1900, D: 2300, E: 2700 };

export function zoneRates(saved?: Partial<DropshipZones> | null): DropshipZones {
  const out = { ...DEFAULT_ZONES };
  for (const z of Object.keys(out) as Zone[]) {
    const v = saved?.[z];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[z] = Math.round(v);
  }
  return out;
}

/** SKUs match on their first 9 characters: "SSP-052-SST-2" and "SSP-052-SST" are the same product. */
export const SKU_KEY_LEN = 9;
export const skuKey = (sku: string | null | undefined) => {
  const k = String(sku ?? "").trim().toUpperCase().slice(0, SKU_KEY_LEN);
  return k.length === SKU_KEY_LEN ? k : null;
};

// Warehouse: Gurugram, Haryana
const SPECIAL_STATES = new Set(["AR", "AS", "MN", "ML", "MZ", "NL", "SK", "TR", "JK", "LA", "AN", "LD"]);
const REGION_STATES = new Set(["DL", "HR", "PB", "CH", "HP", "RJ", "UP", "UK"]);
const NCR_PIN = /^(110|121|122|201[0-3])/;
const NCR_CITY = /\b(new delhi|delhi|gurgaon|gurugram|noida|greater noida|ghaziabad|faridabad)\b/i;
const METRO_PIN = /^(400|411|560|600|700|500|380)/;
const METRO_CITY = /\b(mumbai|bombay|navi mumbai|thane|bengaluru|bangalore|chennai|madras|kolkata|calcutta|hyderabad|secunderabad|pune|ahmedabad)\b/i;

/** Shipping zone for a delivery address (state = Shopify province code, e.g. HR). */
export function zoneFor(a: { state?: string | null; pincode?: string | null; city?: string | null }): Zone {
  const state = String(a.state ?? "").toUpperCase();
  const pin = String(a.pincode ?? "").replace(/\D/g, "");
  const city = String(a.city ?? "");
  if (SPECIAL_STATES.has(state)) return "E";
  if (NCR_PIN.test(pin) || (!pin && NCR_CITY.test(city)) || (NCR_CITY.test(city) && ["DL", "HR", "UP"].includes(state))) return "A";
  if (REGION_STATES.has(state)) return "B";
  if (METRO_PIN.test(pin) || METRO_CITY.test(city)) return "C";
  return "D";
}

export type DropshipStatus = "charged" | "fulfilled" | "cancelled" | "rto";
export const STATUS_LABEL: Record<DropshipStatus, string> = {
  charged: "Waiting to fulfil",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  rto: "RTO",
};

/** Hours after the order before it's marked fulfilled in Shopify. */
export const FULFIL_AFTER_HOURS = 8;
/** After fulfilment, a cancellation within this many hours refunds the product price (not shipping). */
export const PRODUCT_REFUND_HOURS = 24;
/** Packing is charged per physical unit; like product cost it is refundable within the product-refund window. */
export const PACKING_FEE_PAISE = 400;

/**
 * What a cancellation gives back:
 * before fulfilment → product + shipping; within 24 h of fulfilment → product only; later → nothing.
 */
export function cancelRefund(d: { status: string; productPaise: number; shippingPaise: number; packingPaise?: number; fulfilledAt: Date | string | null }, at = new Date()) {
  if (d.status === "charged") return d.productPaise + d.shippingPaise + (d.packingPaise ?? 0);
  if (d.status === "fulfilled" && d.fulfilledAt && at.getTime() - new Date(d.fulfilledAt).getTime() <= PRODUCT_REFUND_HOURS * 3600_000) return d.productPaise + (d.packingPaise ?? 0);
  return 0;
}

const SKU_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i;
const NUM_RE = /^₹?\s*\d+(?:\.\d{1,2})?$/;

/** Accepts "SKU, Name, Price", "SKU<tab>Price" or the pasted table "# Product SKU Price". */
export function parsePriceLines(text: string, needName: boolean) {
  const out: { sku: string; name: string; pricePaise: number }[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#?\s*product\b|^sku\b/i.test(line)) continue;
    const parts = line.split(/\t|,|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    const sku = parts.find((p) => SKU_RE.test(p) && p.length >= 9);
    const priceTok = [...parts].reverse().find((p) => NUM_RE.test(p));
    if (!sku || !priceTok) { bad.push(line); continue; }
    const name = parts.filter((p) => p !== sku && p !== priceTok && !/^\d+$/.test(p)).join(" ").trim();
    if (needName && !name) { bad.push(line); continue; }
    out.push({ sku: sku.toUpperCase(), name: name || sku.toUpperCase(), pricePaise: Math.round(Number(priceTok.replace(/[₹\s]/g, "")) * 100) });
  }
  return { rows: out, bad };
}


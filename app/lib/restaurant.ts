// Restaurants and cloud kitchens (businessType = "restaurant"): settings, opening hours, delivery fees
// and the kitchen's order flow. Shared by the server and the browser.

export type Fulfilment = "delivery" | "takeaway" | "dine_in";
export type KitchenStatus = "new" | "accepted" | "preparing" | "ready" | "out" | "done" | "rejected";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** One opening window, "HH:MM" in IST. A window can cross midnight (18:00–02:00). */
export type Slot = { open: string; close: string };
export type DayHours = { closed: boolean; slots: Slot[] };
/** Delivery charge up to a distance. */
export type FeeSlab = { upToKm: number; fee: number }; // fee in ₹

export type RestaurantSettings = {
  modes?: { delivery: boolean; takeaway: boolean; dineIn: boolean };
  hours?: DayHours[]; // Monday first
  pausedUntil?: string | null; // ISO: not taking orders until then ("busy" switch)
  prepMinutes?: number; // usual time to cook an order
  delivery?: {
    radiusKm: number;
    slabs: FeeSlab[];
    freeAbove: number | null; // ₹ order value for free delivery
    minOrder: number; // ₹
    by: "own" | "third_party";
    partner: string; // third-party name when by = third_party (Porter, Shadowfax, Dunzo, Borzo…)
    etaMinutes: number; // usual time on the road
  };
  takeawayMinOrder?: number; // ₹
  kitchen?: { autoAccept: boolean; sound: boolean };
  location?: { lat: number | null; lng: number | null; address: string };
  tables?: string[]; // dine-in table names / numbers
};

export const DELIVERY_PARTNERS = ["Porter", "Shadowfax", "Borzo", "Dunzo", "Rapido", "Other"] as const;

const DEFAULT_DAY: DayHours = { closed: false, slots: [{ open: "11:00", close: "23:00" }] };

export function resolveRestaurant(r: RestaurantSettings | null | undefined): Required<Omit<RestaurantSettings, "pausedUntil">> & { pausedUntil: string | null } {
  const v = r ?? {};
  const hours = Array.from({ length: 7 }, (_, i) => {
    const d = v.hours?.[i];
    if (!d) return { ...DEFAULT_DAY, slots: [...DEFAULT_DAY.slots] };
    const slots = (d.slots ?? []).filter((s) => TIME.test(s.open) && TIME.test(s.close)).slice(0, 3);
    return { closed: Boolean(d.closed), slots: slots.length ? slots : [{ ...DEFAULT_DAY.slots[0] }] };
  });
  const dl = v.delivery;
  const slabs = (dl?.slabs ?? [{ upToKm: 3, fee: 20 }, { upToKm: 6, fee: 40 }])
    .map((s) => ({ upToKm: clamp(Number(s.upToKm), 0.5, 50), fee: clamp(Math.round(Number(s.fee)), 0, 2000) }))
    .sort((a, b) => a.upToKm - b.upToKm).slice(0, 8);
  return {
    modes: { delivery: v.modes?.delivery ?? true, takeaway: v.modes?.takeaway ?? true, dineIn: v.modes?.dineIn ?? false },
    hours,
    pausedUntil: v.pausedUntil ?? null,
    prepMinutes: clamp(Math.round(Number(v.prepMinutes ?? 20)), 5, 180),
    delivery: {
      radiusKm: clamp(Number(dl?.radiusKm ?? 6), 0.5, 50),
      slabs,
      freeAbove: dl?.freeAbove == null || Number(dl.freeAbove) <= 0 ? null : Math.round(Number(dl.freeAbove)),
      minOrder: clamp(Math.round(Number(dl?.minOrder ?? 0)), 0, 100000),
      by: dl?.by === "third_party" ? "third_party" : "own",
      partner: String(dl?.partner ?? "").slice(0, 40),
      etaMinutes: clamp(Math.round(Number(dl?.etaMinutes ?? 25)), 5, 180),
    },
    takeawayMinOrder: clamp(Math.round(Number(v.takeawayMinOrder ?? 0)), 0, 100000),
    kitchen: { autoAccept: Boolean(v.kitchen?.autoAccept), sound: v.kitchen?.sound ?? true },
    location: { lat: num(v.location?.lat), lng: num(v.location?.lng), address: String(v.location?.address ?? "").slice(0, 300) },
    tables: (v.tables ?? []).map((t) => String(t).trim().slice(0, 20)).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 200),
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** IST weekday (0 = Monday) and minutes since midnight. */
function istNow(now = new Date()) {
  const d = new Date(now.getTime() + 5.5 * 3600_000);
  return { day: (d.getUTCDay() + 6) % 7, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Is the restaurant taking orders right now? Handles windows that cross midnight and the pause switch. */
export function openNow(r: ReturnType<typeof resolveRestaurant>, now = new Date()): { open: boolean; reason: "open" | "paused" | "closed" } {
  if (r.pausedUntil && new Date(r.pausedUntil) > now) return { open: false, reason: "paused" };
  const { day, min } = istNow(now);
  const today = r.hours[day];
  const yesterday = r.hours[(day + 6) % 7];
  const inToday = !today.closed && today.slots.some((s) => { const a = mins(s.open), b = mins(s.close); return a < b ? min >= a && min < b : min >= a; });
  const fromYesterday = !yesterday.closed && yesterday.slots.some((s) => { const a = mins(s.open), b = mins(s.close); return a >= b && min < b; });
  return inToday || fromYesterday ? { open: true, reason: "open" } : { open: false, reason: "closed" };
}

/** Delivery charge (₹) for a distance and order value, or null when it's outside the delivery area. */
export function deliveryFee(r: ReturnType<typeof resolveRestaurant>, km: number, orderValue: number): number | null {
  if (km > r.delivery.radiusKm) return null;
  if (r.delivery.freeAbove != null && orderValue >= r.delivery.freeAbove) return 0;
  const slab = r.delivery.slabs.find((s) => km <= s.upToKm) ?? r.delivery.slabs[r.delivery.slabs.length - 1];
  return slab ? slab.fee : 0;
}

/** Straight-line distance in km (good enough for a delivery radius). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const FULFILMENT_LABEL: Record<Fulfilment, string> = { delivery: "Delivery", takeaway: "Takeaway", dine_in: "Dine-in" };

/** The kitchen's steps. The last active step depends on how the food leaves. */
export const KITCHEN_LABEL: Record<KitchenStatus, string> = {
  new: "New", accepted: "Accepted", preparing: "Preparing", ready: "Ready", out: "Out for delivery", done: "Completed", rejected: "Rejected",
};

export function nextStatus(s: KitchenStatus, f: Fulfilment): { to: KitchenStatus; label: string } | null {
  switch (s) {
    case "new": return { to: "accepted", label: "Accept" };
    case "accepted": return { to: "preparing", label: "Start preparing" };
    case "preparing": return { to: "ready", label: "Mark ready" };
    case "ready": return f === "delivery" ? { to: "out", label: "Out for delivery" } : { to: "done", label: f === "dine_in" ? "Served" : "Picked up" };
    case "out": return { to: "done", label: "Delivered" };
    default: return null;
  }
}

export const KITCHEN_COLUMNS: { id: string; label: string; statuses: KitchenStatus[] }[] = [
  { id: "new", label: "New", statuses: ["new"] },
  { id: "cooking", label: "Preparing", statuses: ["accepted", "preparing"] },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "out", label: "Out for delivery", statuses: ["out"] },
];

/** Checkout: the delivery charge worked out when checkout started, as shipping rules the checkout already understands. */
export function restShipRules(rest: { mode: Fulfilment; km: number | null; feePaise: number; freeAbove: number | null }) {
  if (rest.mode !== "delivery" || rest.feePaise <= 0) return [];
  const base = { states: [] as string[], pincodePrefixes: [] as string[], paymentMethod: "any" };
  const name = rest.km != null ? `Delivery · ${rest.km} km` : "Delivery";
  return rest.freeAbove
    ? [{ id: -1, name, pricePaise: rest.feePaise, minOrderRupees: 0, maxOrderRupees: rest.freeAbove - 1, ...base }, { id: -2, name: "Free delivery", pricePaise: 0, minOrderRupees: rest.freeAbove, maxOrderRupees: null, ...base }]
    : [{ id: -1, name, pricePaise: rest.feePaise, minOrderRupees: 0, maxOrderRupees: null, ...base }];
}

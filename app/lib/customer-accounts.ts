// Customer accounts on a store's website: what the store asks shoppers for, and how they log in.
// Shared by the server and the browser (no secrets here).
import type { AccountSettings, FieldRule } from "~/db/schema";

export type { AccountSettings, FieldRule };

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  enabled: true,
  name: "full", nameRequired: true,
  phone: "required", phoneVerify: true,
  email: "optional", emailVerify: false,
  address: "optional", addressLine2: true, landmark: false,
};

const RULES: FieldRule[] = ["required", "optional", "hidden"];
const rule = (v: unknown, d: FieldRule): FieldRule => (RULES.includes(v as FieldRule) ? (v as FieldRule) : d);

/** Fills gaps and keeps the one hard rule: phone or email must be required (that's how shoppers log in). */
export function accountSettings(raw: Partial<AccountSettings> | null | undefined): AccountSettings {
  const d = DEFAULT_ACCOUNT_SETTINGS;
  const s: AccountSettings = {
    enabled: raw?.enabled ?? d.enabled,
    name: raw?.name === "first" || raw?.name === "none" ? raw.name : "full",
    nameRequired: raw?.nameRequired ?? d.nameRequired,
    phone: rule(raw?.phone, d.phone), phoneVerify: raw?.phoneVerify ?? d.phoneVerify,
    email: rule(raw?.email, d.email), emailVerify: raw?.emailVerify ?? d.emailVerify,
    address: rule(raw?.address, d.address), addressLine2: raw?.addressLine2 ?? d.addressLine2, landmark: raw?.landmark ?? d.landmark,
  };
  if (s.phone !== "required" && s.email !== "required") s.phone = "required";
  return s;
}

/** Why a settings form can't be saved (null = fine). */
export function settingsProblem(s: AccountSettings): string | null {
  if (s.phone !== "required" && s.email !== "required") return "Make the mobile number or the email required. Shoppers log in with it.";
  return null;
}

export type Channel = "phone" | "email";

/** Ways to log in: each shown identifier, with a code (OTP) or a password. Required ones first. */
export function loginChannels(s: AccountSettings): { channel: Channel; otp: boolean }[] {
  const out: { channel: Channel; otp: boolean; req: boolean }[] = [];
  if (s.phone !== "hidden") out.push({ channel: "phone", otp: s.phoneVerify, req: s.phone === "required" });
  if (s.email !== "hidden") out.push({ channel: "email", otp: s.emailVerify, req: s.email === "required" });
  // Optional identifiers can only log in when they were verified; keep them for shoppers who added them
  return out.sort((a, b) => Number(b.req) - Number(a.req)).map(({ channel, otp }) => ({ channel, otp }));
}

export const normPhone = (v: string) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
export const validPhone = (v: string) => /^[6-9]\d{9}$/.test(v);
export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** Where the order is now, in the shopper's words. */
export type TrackStep = { key: string; label: string; done: boolean; at?: string | null };

export function orderSteps(o: { status: string; createdAt: string; confirmStatus: string | null; awb: string | null; courierRef: string | null; shipStatus: string | null; shipStatusRaw: string | null }): { steps: TrackStep[]; headline: string; tone: "good" | "bad" | "neutral" } {
  const raw = (o.shipStatusRaw ?? "").toLowerCase();
  if (o.status === "refunded" || o.shipStatus === "cancelled" || o.confirmStatus === "cancelled") {
    return { headline: "Cancelled", tone: "bad", steps: [{ key: "placed", label: "Order placed", done: true, at: o.createdAt }, { key: "cancelled", label: "Cancelled", done: true }] };
  }
  if (o.shipStatus === "rto" || o.shipStatus === "rto_transit") {
    return { headline: o.shipStatus === "rto" ? "Returned to the store" : "Being returned to the store", tone: "bad", steps: [{ key: "placed", label: "Order placed", done: true, at: o.createdAt }, { key: "shipped", label: "Shipped", done: true }, { key: "rto", label: "Returning", done: true }] };
  }
  const shipped = Boolean(o.awb) && !/^(new|awb assigned|pickup|ready to ship|manifest|label)/.test(raw);
  const out = /out for delivery|\bofd\b/.test(raw);
  const delivered = o.shipStatus === "delivered";
  const steps: TrackStep[] = [
    { key: "placed", label: "Order placed", done: true, at: o.createdAt },
    { key: "confirmed", label: "Confirmed", done: o.confirmStatus === "confirmed" || Boolean(o.awb || o.courierRef) || o.status === "paid" },
    { key: "shipped", label: "Shipped", done: shipped || out || delivered },
    { key: "out", label: "Out for delivery", done: out || delivered },
    { key: "delivered", label: "Delivered", done: delivered },
  ];
  const last = [...steps].reverse().find((s) => s.done)!;
  const headline = delivered ? "Delivered" : out ? "Out for delivery" : shipped ? (o.shipStatusRaw ? title(o.shipStatusRaw) : "On the way") : last.key === "confirmed" ? "Confirmed, getting ready to ship" : "Order placed";
  return { steps, headline, tone: delivered ? "good" : "neutral" };
}

const title = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

/** Public tracking page of the courier, when we know one. */
export function trackingUrl(courier: string | null, awb: string | null) {
  if (!awb) return null;
  const a = encodeURIComponent(awb);
  switch (courier) {
    case "delhivery": return `https://www.delhivery.com/track-v2/package/${a}`;
    case "shiprocket": return `https://shiprocket.co/tracking/${a}`;
    case "xpressbees": return `https://www.xpressbees.com/shipment/tracking?awbNo=${a}`;
    case "ekart": return `https://ekartlogistics.com/shipmenttrack/${a}`;
    case "nimbuspost": return `https://ship.nimbuspost.com/shipping/tracking/${a}`;
    default: return null;
  }
}

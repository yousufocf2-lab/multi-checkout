// Where an order came from: a Meta ad, a Google ad, Google search, Instagram, WhatsApp, another website or direct.
// Shared by the server (saved on the order as tracking.ch, used by the Source filter) and the order page.
import type { TrackingInfo } from "~/db/schema";
import { attributionOf, channelOf, touchSummary, type Channel, type ClickKind, type Touch } from "./attribution";

export type OrderSource = {
  channel: Channel | "unknown";
  label: string; // "Meta Ads", "Google search", "Direct"
  paid: boolean; // came from an ad
  campaign?: string; // utm_campaign
  detail?: string; // "facebook / paid · Diwali sale"
  hint?: string; // why we're not sure, shown as a tooltip
  placement?: string; // where Meta showed the ad: Facebook, Instagram, WhatsApp…
  color: string;
};

export const SOURCE_META: Record<Channel | "unknown", { label: string; color: string; paid?: boolean }> = {
  meta_ads: { label: "Meta Ads", color: "#0866FF", paid: true },
  google_ads: { label: "Google Ads", color: "#E37400", paid: true },
  other_ads: { label: "Other ads", color: "#7C3AED", paid: true },
  google_search: { label: "Google search", color: "#1A7F4B" },
  other_search: { label: "Other search", color: "#2F855A" },
  social: { label: "Facebook / Instagram", color: "#C13584" },
  whatsapp: { label: "WhatsApp", color: "#128C7E" },
  email: { label: "Email", color: "#475569" },
  referral: { label: "Other website", color: "#0369A1" },
  campaign: { label: "Campaign link", color: "#A16207" },
  direct: { label: "Direct", color: "#64748B" },
  unknown: { label: "Not tracked", color: "#94A3B8" },
};

/** Filter choices on the Orders page (value = tracking.ch). */
export const SOURCE_FILTERS: { id: string; label: string; channels: (Channel | "unknown")[] }[] = [
  { id: "ads", label: "Any ad", channels: ["meta_ads", "google_ads", "other_ads"] },
  { id: "meta_ads", label: "Meta Ads", channels: ["meta_ads"] },
  { id: "google_ads", label: "Google Ads", channels: ["google_ads"] },
  { id: "social", label: "Facebook / Instagram (no ad tags)", channels: ["social"] },
  { id: "search", label: "Google / other search", channels: ["google_search", "other_search"] },
  { id: "whatsapp", label: "WhatsApp", channels: ["whatsapp"] },
  { id: "referral", label: "Other websites", channels: ["referral", "campaign", "email"] },
  { id: "direct", label: "Direct", channels: ["direct"] },
  { id: "unknown", label: "Not tracked", channels: ["unknown"] },
];

const PLACEMENTS: Record<string, string> = { fb: "Facebook", facebook: "Facebook", ig: "Instagram", instagram: "Instagram", wa: "WhatsApp", whatsapp: "WhatsApp", msg: "Messenger", messenger: "Messenger", an: "Audience Network", threads: "Threads" };
const placementOf = (ch: string, s?: string) => (ch === "meta_ads" && s ? PLACEMENTS[s.toLowerCase()] : undefined);

const SOCIAL_SRC = /^(facebook|fb|instagram|ig|meta|messenger)$/i;

function fromUrl(raw: string | undefined): Touch | undefined {
  if (!raw || raw.startsWith("draft:")) return undefined;
  try {
    const u = new URL(raw);
    const q = u.searchParams;
    const k = (["gclid", "gbraid", "wbraid", "fbclid", "msclkid"] as ClickKind[]).find((x) => q.get(x));
    const t: Touch = { s: q.get("utm_source") ?? undefined, m: q.get("utm_medium") ?? undefined, c: q.get("utm_campaign") ?? undefined, t: q.get("utm_term") ?? undefined, k, at: 0 };
    return t.s || t.k ? t : undefined;
  } catch { return undefined; }
}

/** Works out the source from what the checkout saved. */
export function orderSource(t: TrackingInfo | null | undefined, checkoutChannel?: string | null): OrderSource {
  const make = (channel: Channel | "unknown", extra: Partial<OrderSource> = {}): OrderSource => ({
    channel, label: SOURCE_META[channel].label, paid: Boolean(SOURCE_META[channel].paid), color: SOURCE_META[channel].color, ...extra,
  });
  if (checkoutChannel === "shopify_history") return make("unknown", { hint: "Imported from Shopify's order history." });
  if (!t) return make("unknown", { hint: "This order was placed before source tracking." });

  // 1. The website's own record of the visit (utm tags, ad click, referrer)
  if (t.attr && (t.attr.f || t.attr.l)) {
    const a = attributionOf(t.attr.f, t.attr.l);
    const pick = a.last && (a.last.s || a.last.k || a.last.r) ? a.last : a.first ?? a.last;
    return make(a.channel, {
      campaign: pick?.c, detail: touchSummary(pick) || undefined, placement: placementOf(a.channel, pick?.s),
      hint: a.channel === "social" && pick?.k === "fbclid" ? "Came from a Facebook / Instagram link without ad tags. Add UTM tags to your Meta ads to tell ads apart from posts." : undefined,
    });
  }

  // 2. The checkout link itself (Shopify stores send the page URL), and saved click IDs
  const fromLink = fromUrl(t.sourceUrl);
  const touch: Touch = fromLink ?? { at: 0 };
  if (!touch.k) touch.k = t.gclid ? "gclid" : t.gbraid ? "gbraid" : t.wbraid ? "wbraid" : undefined;
  const src = (t.src ?? "").trim();
  if (!touch.s && src && src !== "direct") {
    if (/\./.test(src)) touch.r = src.replace(/^www\./, "");
    else touch.s = src;
  }
  if (!touch.k && t.fbc && (!touch.s || SOCIAL_SRC.test(touch.s))) touch.k = "fbclid";
  const ch = channelOf(touch);
  const hint = ch === "social" && touch.k === "fbclid"
    ? "Came from a Facebook / Instagram link (ad or post). Add UTM tags to your Meta ads to see the campaign here."
    : ch === "direct" && !fromLink && !src ? "No ad click or referrer was found for this order." : undefined;
  return make(ch, { campaign: touch.c, detail: touch.s || touch.r ? touchSummary(touch) : undefined, hint, placement: placementOf(ch, touch.s) });
}

/** Saved channel (tracking.ch) when there is one, otherwise worked out now. */
export const channelForOrder = (t: TrackingInfo | null | undefined, checkoutChannel?: string | null) =>
  (t?.ch as Channel | "unknown" | undefined) ?? orderSource(t, checkoutChannel).channel;

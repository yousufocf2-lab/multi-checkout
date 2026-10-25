// Where Growpefy's own leads come from (website callbacks and signups).
// The browser keeps the first and latest marketing visit in a small cookie; the server reads it when a lead is saved.
// Nothing here is secret: it is the same information as the page URL and referrer.

export const ATTR_COOKIE = "gp_src";
const MAX_AGE_DAYS = 90;

export type ClickKind = "gclid" | "gbraid" | "wbraid" | "fbclid" | "msclkid";

/** One visit. Short keys keep the cookie small. */
export type Touch = {
  s?: string; // utm_source
  m?: string; // utm_medium
  c?: string; // utm_campaign
  t?: string; // utm_term (keyword)
  k?: ClickKind; // ad click ID present in the URL (the ID itself isn't kept)
  r?: string; // referrer host
  lp?: string; // landing path
  at: number; // epoch ms
};

export type Channel =
  | "google_ads" | "meta_ads" | "other_ads"
  | "google_search" | "other_search"
  | "social" | "whatsapp" | "email" | "referral" | "campaign" | "direct";

export type Attribution = { channel: Channel; first?: Touch; last?: Touch };

export const CHANNELS: Record<Channel | "untracked", { label: string; color: string; paid?: boolean }> = {
  google_ads: { label: "Google Ads", color: "#F2A900", paid: true },
  meta_ads: { label: "Meta Ads", color: "#0866FF", paid: true },
  other_ads: { label: "Other ads", color: "#8B5CF6", paid: true },
  google_search: { label: "Google search (free)", color: "#1BAF7A" },
  other_search: { label: "Other search (free)", color: "#5FC9A0" },
  social: { label: "Social (free)", color: "#E1306C" },
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  email: { label: "Email", color: "#64748B" },
  referral: { label: "Other websites", color: "#0EA5E9" },
  campaign: { label: "Other campaign", color: "#A16207" },
  direct: { label: "Direct / unknown", color: "#94A3B8" },
  untracked: { label: "Before tracking", color: "#CBD5E1" },
};

export const channelLabel = (c: string | null | undefined) => CHANNELS[(c ?? "untracked") as Channel]?.label ?? "Direct / unknown";

const PAID = /^(cpc|ppc|paid|paid[_-]?social|paidsocial|ads?|cpm|display|sponsored)$/i;
const META_SRC = /^(facebook|fb|instagram|ig|meta|messenger|an|audience[_-]?network)$/i;
const GOOGLE_SRC = /^(google|adwords|googleads|youtube)$/i;

/** Decides the channel for one visit. */
export function channelOf(t: Touch | undefined): Channel {
  if (!t) return "direct";
  const s = (t.s ?? "").toLowerCase(), m = (t.m ?? "").toLowerCase(), r = (t.r ?? "").toLowerCase();
  if (t.k === "gclid" || t.k === "gbraid" || t.k === "wbraid") return "google_ads";
  if (s && PAID.test(m)) {
    if (GOOGLE_SRC.test(s)) return "google_ads";
    if (META_SRC.test(s)) return "meta_ads";
    return "other_ads";
  }
  if (t.k === "msclkid") return "other_ads";
  if (META_SRC.test(s) && t.k === "fbclid" && m) return "meta_ads"; // Meta ad links with utm_source=facebook&utm_medium=anything + fbclid
  if (s === "whatsapp" || s === "wa" || /whatsapp|wa\.me/.test(r)) return "whatsapp";
  if (m === "email" || s === "email" || s === "newsletter") return "email";
  if (s) return META_SRC.test(s) || /^(linkedin|twitter|x|youtube|telegram)$/.test(s) ? "social" : "campaign";
  if (t.k === "fbclid") return "social"; // Facebook adds fbclid to every outgoing link, ads or not
  if (r) {
    if (/(^|\.)google\./.test(r)) return "google_search";
    if (/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.|yandex\.|ecosia\.org|search\.brave\.com)/.test(r)) return "other_search";
    if (/(facebook\.com|instagram\.com|fb\.me|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|youtube\.com|reddit\.com|quora\.com|threads\.net|t\.me|telegram)/.test(r)) return "social";
    return "referral";
  }
  return "direct";
}

/** A visit "counts" when it carries campaign tags, an ad click or an outside referrer. */
const isMarketing = (t: Touch) => Boolean(t.s || t.k || t.r);

/** Last marketing visit wins; falls back to the first one. */
export function attributionOf(first: Touch | undefined, last: Touch | undefined): Attribution {
  const pick = last && isMarketing(last) ? last : first && isMarketing(first) ? first : last ?? first;
  return { channel: channelOf(pick), first, last };
}

// ---------------- browser ----------------

const cut = (v: string | null | undefined, n = 80) => (v ? v.replace(/[^\w .:/@+-]/g, "").slice(0, n) || undefined : undefined);

/** Runs on every public page: remembers this visit when it says where the visitor came from. */
export function captureVisit() {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    const q = u.searchParams;
    let ref: string | undefined;
    try { const h = document.referrer ? new URL(document.referrer).hostname : ""; if (h && h !== u.hostname) ref = h.replace(/^www\./, ""); } catch { /* bad referrer */ }
    const k = (["gclid", "gbraid", "wbraid", "fbclid", "msclkid"] as const).find((x) => q.get(x));
    const now: Touch = {
      s: cut(q.get("utm_source"), 40), m: cut(q.get("utm_medium"), 40), c: cut(q.get("utm_campaign")), t: cut(q.get("utm_term")),
      k, r: cut(ref, 60), lp: cut(u.pathname, 60), at: Date.now(),
    };
    const saved = readCookie();
    if (saved && !isMarketing(now)) return; // internal page or plain direct visit: keep what we have
    const next = { f: saved?.f ?? now, l: now };
    for (const t of [next.f, next.l]) for (const key of Object.keys(t) as (keyof Touch)[]) if (t[key] === undefined) delete t[key];
    document.cookie = `${ATTR_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; Max-Age=${MAX_AGE_DAYS * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* never break the page */ }
}

function readCookie(): { f?: Touch; l?: Touch } | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${ATTR_COOKIE}=([^;]*)`));
  return m ? parseRaw(decodeURIComponent(m[1])) : null;
}

// ---------------- shared parsing ----------------

const KINDS = new Set(["gclid", "gbraid", "wbraid", "fbclid", "msclkid"]);

function cleanTouch(v: unknown): Touch | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === "string" ? cut(x, n) : undefined);
  const at = Number(o.at);
  const t: Touch = {
    s: str(o.s, 40), m: str(o.m, 40), c: str(o.c, 80), t: str(o.t, 80),
    k: typeof o.k === "string" && KINDS.has(o.k) ? (o.k as ClickKind) : undefined,
    r: str(o.r, 60), lp: str(o.lp, 60), at: Number.isFinite(at) && at > 0 ? at : Date.now(),
  };
  for (const key of Object.keys(t) as (keyof Touch)[]) if (t[key] === undefined) delete t[key];
  return t;
}

export function parseRaw(raw: string): { f?: Touch; l?: Touch } | null {
  try {
    const v = JSON.parse(raw) as { f?: unknown; l?: unknown };
    const f = cleanTouch(v?.f), l = cleanTouch(v?.l);
    return f || l ? { f, l } : null;
  } catch { return null; }
}

/** Server side: reads the cookie from a request. Null when the visitor has none (e.g. cookies blocked). */
export function readAttribution(request: Request): Attribution | null {
  const m = (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${ATTR_COOKIE}=([^;]*)`));
  if (!m) return null;
  let raw = m[1];
  try { raw = decodeURIComponent(raw); } catch { return null; }
  const p = parseRaw(raw);
  return p ? attributionOf(p.f, p.l) : null;
}

/** "google / cpc · shopify checkout" style one-liner for the admin. */
export function touchSummary(t: Touch | undefined) {
  if (!t) return "";
  const bits = [t.s ? `${t.s}${t.m ? ` / ${t.m}` : ""}` : t.r ? t.r : t.k ? t.k : "direct"];
  if (t.c) bits.push(t.c);
  if (t.t) bits.push(`“${t.t}”`);
  return bits.join(" · ");
}

/** Broad buckets for filters: which ad platform, free (organic) traffic, or direct. */
export type SourceGroup = "google" | "meta" | "other_ads" | "organic" | "other" | "direct" | "untracked";
export const SOURCE_GROUPS: { id: SourceGroup; label: string }[] = [
  { id: "google", label: "Google Ads" },
  { id: "meta", label: "Meta Ads" },
  { id: "organic", label: "Organic" },
  { id: "direct", label: "Direct" },
  { id: "other", label: "WhatsApp / email / other" },
  { id: "other_ads", label: "Other ads" },
  { id: "untracked", label: "Before tracking" },
];
export function sourceGroup(c: string | null | undefined): SourceGroup {
  switch (c) {
    case "google_ads": return "google";
    case "meta_ads": return "meta";
    case "other_ads": return "other_ads";
    case "google_search": case "other_search": case "social": case "referral": return "organic";
    case "whatsapp": case "email": case "campaign": return "other";
    case "direct": return "direct";
    default: return "untracked";
  }
}

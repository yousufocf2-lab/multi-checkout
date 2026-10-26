// Client onboarding: signup questions and the steps from signup to a live, paying store. Safe for the browser.
import type { SignupProfile } from "~/db/schema";

export const SITE_PLATFORMS = [
  { id: "shopify", label: "Shopify" },
  { id: "woocommerce", label: "WooCommerce" },
  { id: "other", label: "Other" },
] as const;

export const AD_CHANNELS = [
  { id: "meta", label: "Meta (Facebook / Instagram)" },
  { id: "google", label: "Google" },
  { id: "other", label: "Other" },
] as const;

export const GOALS = [
  { id: "prepaid", label: "Get more prepaid orders" },
  { id: "rto", label: "Reduce RTO" },
  { id: "fake", label: "Stop fake orders" },
  { id: "cod_confirm", label: "Confirm COD orders on WhatsApp" },
  { id: "conversion", label: "Increase checkout conversion" },
  { id: "abandoned", label: "Recover abandoned carts" },
  { id: "ads", label: "Track ad performance (ROAS)" },
  { id: "other", label: "Something else" },
] as const;

export const URGENCY = [
  { id: "immediate", label: "Immediately", hint: "Help me get started today", tone: "bg-red-50 text-bad" },
  { id: "high", label: "High", hint: "This week", tone: "bg-amber-50 text-amber-800" },
  { id: "medium", label: "Medium", hint: "In the next few weeks", tone: "bg-sky-50 text-sky-800" },
  { id: "low", label: "Low", hint: "Just exploring, no rush", tone: "bg-paper-sunk text-ink-soft" },
] as const;

export const labelOf = <T extends readonly { id: string; label: string }[]>(list: T, id: string | undefined | null) => list.find((x) => x.id === id)?.label ?? id ?? "";

/** Readable summary of signup answers: [label, value] rows. */
export function profileFacts(p: SignupProfile | null | undefined): [string, string][] {
  if (!p) return [];
  const out: [string, string][] = [];
  for (const w of p.websites ?? []) out.push(["Website", `${w.url} · ${w.platform === "other" ? `Other${w.other ? `: ${w.other}` : ""}` : labelOf(SITE_PLATFORMS, w.platform)}`]);
  if (p.adChannels?.length) out.push(["Runs ads on", p.adChannels.map((c) => (c === "other" && p.adOther ? `Other: ${p.adOther}` : labelOf(AD_CHANNELS, c).replace(/ \(.*\)/, ""))).join(", ")]);
  if (p.goals?.length) out.push(["Wants to", p.goals.map((g) => (g === "other" && p.goalOther ? `Other: ${p.goalOther}` : labelOf(GOALS, g))).join(", ")]);
  if (p.urgency) out.push(["Urgency", `${labelOf(URGENCY, p.urgency)} (${URGENCY.find((u) => u.id === p.urgency)?.hint})`]);
  return out;
}

/** Steps from signup to a paying store, in order. */
export const STEPS = [
  { id: "signup", label: "Signed up", short: "Signup" },
  { id: "kyc", label: "Business details (KYC) done", short: "KYC" },
  { id: "store", label: "Store added", short: "Store" },
  { id: "connected", label: "Store platform connected", short: "Connected" },
  { id: "live", label: "Checkout opened by a shopper", short: "Live" },
  { id: "order", label: "First order", short: "Order" },
  { id: "recharge", label: "Wallet recharged", short: "Paid" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

/** Normalises a website the owner typed: adds https://, lowercases the host, drops trailing slashes. */
export function cleanSite(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Checks the signup answers (sent as JSON). Website and urgency are required; ads and goals are optional. */
export function parseProfile(raw: string): { profile: SignupProfile; error: string | null } {
  let p: SignupProfile = {};
  try { p = JSON.parse(raw || "{}") ?? {}; } catch { p = {}; }
  const sites: NonNullable<SignupProfile["websites"]> = [];
  let error: string | null = null;
  for (const w of (Array.isArray(p.websites) ? p.websites : []).slice(0, 5)) {
    if (!w || typeof w.url !== "string" || !w.url.trim()) continue;
    const url = cleanSite(w.url);
    if (!url) { error = `"${w.url.slice(0, 60)}" doesn't look like a website address`; continue; }
    const platform = (["shopify", "woocommerce", "other"] as const).includes(w.platform) ? w.platform : "other";
    if (platform === "other" && !String(w.other ?? "").trim()) { error = `Tell us what ${url.replace(/^https?:\/\//, "")} is built on`; }
    if (!sites.some((s) => s.url === url)) sites.push({ url, platform, ...(platform === "other" ? { other: String(w.other ?? "").trim().slice(0, 120) } : {}) });
  }
  if (!sites.length && !error) error = "Add your website";
  const pick = <T extends string>(list: unknown, allowed: readonly T[]) => (Array.isArray(list) ? allowed.filter((a) => list.includes(a)) : []);
  const adChannels = pick(p.adChannels, ["meta", "google", "other"] as const);
  const goals = pick(p.goals, GOALS.map((g) => g.id));
  const urgency = URGENCY.some((u) => u.id === p.urgency) ? p.urgency : undefined;
  if (!urgency && !error) error = "Pick how soon you want to get started";
  return {
    error,
    profile: {
      websites: sites,
      adChannels,
      ...(adChannels.includes("other") && String(p.adOther ?? "").trim() ? { adOther: String(p.adOther).trim().slice(0, 120) } : {}),
      goals,
      ...(goals.includes("other") && String(p.goalOther ?? "").trim() ? { goalOther: String(p.goalOther).trim().slice(0, 300) } : {}),
      ...(urgency ? { urgency } : {}),
    },
  };
}

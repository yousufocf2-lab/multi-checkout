// Growpefy's own marketing (Super admin → Marketing): our Meta + Google ad accounts and where our leads come from.
// Separate from store ads: these are the accounts that promote Growpefy itself. Tokens stay on the server.
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { callbackRequests, db, platformSettings, users, type MarketingSettings, type Store } from "~/db.server";
import { CHANNELS, type Attribution, type Channel, touchSummary } from "./attribution";
import { addDays, bucketKeys, bucketLabel, granularityFor, istToday, type Range } from "./dates";
import { fetchAccount as fetchGoogleAccount, fetchInsights as fetchGoogleInsights, formatCid, googleAppReady } from "./google-ads.server";
import { scrubToken } from "./meta.server";
import { reasonLabel } from "./support";
import { getPlatform } from "./wallet.server";

// ---------------- settings ----------------

export async function getMarketing(): Promise<MarketingSettings> {
  return (await getPlatform()).marketing ?? {};
}

export async function saveMarketing(patch: Partial<MarketingSettings>) {
  const cur = await getMarketing();
  const next: MarketingSettings = { ...cur, ...patch };
  for (const k of Object.keys(next) as (keyof MarketingSettings)[]) if (next[k] === undefined || next[k] === "") delete next[k];
  await db.update(platformSettings).set({ marketing: next, updatedAt: new Date() }).where(eq(platformSettings.id, 1));
  cache.clear();
  return next;
}

export const metaOn = (m: MarketingSettings) => Boolean(m.metaAdAccountId && m.metaAccessToken);
export const googleOn = (m: MarketingSettings) => Boolean(m.googleRefreshToken && m.googleCustomerId);

/** Safe view for the browser: no tokens. */
export function marketingView(m: MarketingSettings) {
  return {
    meta: { connected: metaOn(m), adAccountId: m.metaAdAccountId ?? "", accountName: m.metaAccountName ?? "", hasToken: Boolean(m.metaAccessToken) },
    google: {
      appReady: googleAppReady(), signedIn: Boolean(m.googleRefreshToken), connected: googleOn(m), email: m.googleEmail ?? "",
      customerId: m.googleCustomerId ? formatCid(m.googleCustomerId) : "", accountName: m.googleAccountName ?? "",
    },
  };
}

// ---------------- reports ----------------

export type CampaignRow = { id: string; name: string; status: string; kind: string; spend: number; impressions: number; clicks: number; leads: number; cpl: number | null };
export type PlatformReport = {
  connected: boolean;
  error: string | null;
  spend: number; impressions: number; clicks: number; leads: number;
  ctr: number | null; cpc: number | null; cpl: number | null;
  daily: Record<string, { spend: number; leads: number }>;
  campaigns: CampaignRow[];
};

const empty = (connected: boolean, error: string | null = null): PlatformReport => ({
  connected, error, spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: null, cpc: null, cpl: null, daily: {}, campaigns: [],
});

function finish(r: PlatformReport): PlatformReport {
  r.ctr = r.impressions ? (r.clicks / r.impressions) * 100 : null;
  r.cpc = r.clicks ? r.spend / r.clicks : null;
  r.cpl = r.leads ? r.spend / r.leads : null;
  return r;
}

const cache = new Map<string, { at: number; value: PlatformReport }>();
async function cached(key: string, run: () => Promise<PlatformReport>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const value = await run();
  if (!value.error) cache.set(key, { at: Date.now(), value });
  return value;
}

// ----- Meta -----

type Json = Record<string, unknown>;
type ActionRow = { action_type: string; value: string };
const META_VERSION = () => process.env.META_API_VERSION || "v23.0";
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"];
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const leadsOf = (rows: ActionRow[] | undefined) => {
  for (const t of LEAD_TYPES) { const hit = rows?.find((r) => r.action_type === t); if (hit) return num(hit.value); }
  return 0;
};
const actOf = (id: string) => `act_${id.replace(/\D/g, "")}`;

async function metaGet<T = Json>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  try { res = await fetch(`https://graph.facebook.com/${META_VERSION()}/${path}?${qs}`); }
  catch { throw new Error("Couldn't reach Meta. Try again in a moment."); }
  const body = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    const code = body.error?.code;
    if (code === 190) throw new Error("The Meta access token has expired or was removed. Paste a new token.");
    if (code === 200 || code === 10) throw new Error("This token can't read the ad account. Give the system user access to the ad account with ads_read permission.");
    throw new Error(scrubToken(body.error?.message ?? `Meta API ${res.status}`));
  }
  return body as T;
}

async function metaAll<T = Json>(token: string, path: string, params: Record<string, string>, maxPages = 6) {
  const out: T[] = [];
  let page = await metaGet<{ data?: T[]; paging?: { next?: string } }>(token, path, params);
  out.push(...(page.data ?? []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    const res = await fetch(page.paging.next).catch(() => null);
    if (!res?.ok) break;
    page = (await res.json()) as typeof page;
    out.push(...(page.data ?? []));
  }
  return out;
}

/** Checks the token + account and returns the account name (used when saving). */
export async function testMetaAccount(token: string, accountId: string) {
  const a = await metaGet<Json>(token, actOf(accountId), { fields: "name,currency,account_status" });
  return { name: String(a.name ?? ""), currency: String(a.currency ?? "INR") };
}

const META_STATUS: Record<string, string> = { ACTIVE: "Active", PAUSED: "Paused", CAMPAIGN_PAUSED: "Paused", ARCHIVED: "Archived", DELETED: "Deleted", IN_PROCESS: "Processing", WITH_ISSUES: "Has issues", PENDING_REVIEW: "In review", DISAPPROVED: "Rejected" };

async function metaReport(m: MarketingSettings, range: Range): Promise<PlatformReport> {
  if (!metaOn(m)) return empty(false);
  const token = m.metaAccessToken!, act = actOf(m.metaAdAccountId!);
  const time_range = JSON.stringify({ since: range.since, until: range.until });
  return cached(`meta:${act}:${range.since}:${range.until}`, async () => {
    try {
      const fields = "spend,impressions,clicks,inline_link_clicks,actions";
      const [days, camps, list] = await Promise.all([
        metaAll<Json>(token, `${act}/insights`, { fields, time_range, time_increment: "1", level: "account", limit: "500" }),
        metaAll<Json>(token, `${act}/insights`, { fields: `campaign_id,campaign_name,objective,${fields}`, time_range, level: "campaign", limit: "100" }, 3),
        metaAll<Json>(token, `${act}/campaigns`, { fields: "id,name,effective_status,objective", limit: "100" }, 2).catch(() => [] as Json[]),
      ]);
      const r = empty(true);
      for (const d of days) {
        const spend = num(d.spend), leads = leadsOf(d.actions as ActionRow[]);
        r.spend += spend; r.impressions += num(d.impressions); r.clicks += num(d.inline_link_clicks || d.clicks); r.leads += leads;
        const k = String(d.date_start ?? "");
        if (k) r.daily[k] = { spend: (r.daily[k]?.spend ?? 0) + spend, leads: (r.daily[k]?.leads ?? 0) + leads };
      }
      const status = new Map(list.map((c) => [String(c.id), String(c.effective_status ?? "")]));
      r.campaigns = camps.map((c) => {
        const spend = num(c.spend), leads = leadsOf(c.actions as ActionRow[]);
        const id = String(c.campaign_id ?? "");
        const st = status.get(id) ?? "";
        return {
          id, name: String(c.campaign_name ?? ""), status: META_STATUS[st] ?? (st ? st.toLowerCase() : ""),
          kind: String(c.objective ?? "").replace(/^OUTCOME_/, "").toLowerCase().replace(/_/g, " "),
          spend, impressions: num(c.impressions), clicks: num(c.inline_link_clicks || c.clicks), leads, cpl: leads ? spend / leads : null,
        };
      }).sort((a, b) => b.spend - a.spend);
      return finish(r);
    } catch (e) {
      return empty(true, e instanceof Error ? e.message : String(e));
    }
  });
}

// ----- Google -----

/** google-ads.server works on a store; our own account is shaped like one. */
const asStore = (m: MarketingSettings) => ({ id: 0, googleRefreshToken: m.googleRefreshToken, googleAdsCustomerId: m.googleCustomerId, googleLoginCustomerId: m.googleLoginCustomerId ?? null }) as unknown as Store;

export async function googleAccountName(m: MarketingSettings) {
  return (await fetchGoogleAccount(asStore(m))).name;
}

const G_STATUS: Record<string, string> = { ENABLED: "Active", PAUSED: "Paused", REMOVED: "Removed" };

async function googleReport(m: MarketingSettings, range: Range): Promise<PlatformReport> {
  if (!googleOn(m)) return empty(false);
  return cached(`google:${m.googleCustomerId}:${range.since}:${range.until}`, async () => {
    try {
      const g = await fetchGoogleInsights(asStore(m), { since: range.since, until: range.until });
      const r = empty(true);
      r.spend = g.totals.spend; r.impressions = g.totals.impressions; r.clicks = g.totals.clicks; r.leads = g.totals.purchases; // = conversions (our lead tag)
      for (const d of g.daily) if (d.date) r.daily[d.date] = { spend: (r.daily[d.date]?.spend ?? 0) + d.spend, leads: (r.daily[d.date]?.leads ?? 0) + d.purchases };
      r.campaigns = g.campaigns.map((c) => ({
        id: c.id, name: c.name, status: G_STATUS[c.status] ?? c.status.toLowerCase(), kind: c.channel,
        spend: c.spend, impressions: c.impressions, clicks: c.clicks, leads: c.purchases, cpl: c.purchases ? c.spend / c.purchases : null,
      }));
      return finish(r);
    } catch (e) {
      return empty(true, e instanceof Error ? e.message : String(e));
    }
  });
}

// ----- our own leads -----

const istDate = (d: Date) => istToday(d);
const istFrom = (d: string) => new Date(`${d}T00:00:00+05:30`);

export type LeadRow = {
  kind: "callback" | "signup"; id: number; name: string; contact: string; detail: string;
  channel: Channel | "untracked"; via: string; status: string; at: string;
};

async function ownLeads(range: Range) {
  const from = istFrom(range.since), to = istFrom(addDays(range.until, 1));
  const [cbs, signups] = await Promise.all([
    db.select({ id: callbackRequests.id, name: callbackRequests.name, phone: callbackRequests.phone, reason: callbackRequests.reason, status: callbackRequests.status, attribution: callbackRequests.attribution, createdAt: callbackRequests.createdAt })
      .from(callbackRequests).where(and(eq(callbackRequests.source, "website"), gte(callbackRequests.createdAt, from), lt(callbackRequests.createdAt, to)))
      .orderBy(desc(callbackRequests.createdAt)).limit(2000),
    db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, kycStatus: users.kycStatus, attribution: users.attribution, createdAt: users.createdAt })
      .from(users).where(and(gte(users.createdAt, from), lt(users.createdAt, to)))
      .orderBy(desc(users.createdAt)).limit(2000),
  ]);
  const ch = (a: Attribution | null) => (a?.channel && a.channel in CHANNELS ? a.channel : "untracked") as Channel | "untracked";
  const via = (a: Attribution | null) => touchSummary(a?.last ?? a?.first);
  const rows: LeadRow[] = [
    ...cbs.map((c) => ({ kind: "callback" as const, id: c.id, name: c.name, contact: c.phone, detail: reasonLabel(c.reason), channel: ch(c.attribution), via: via(c.attribution), status: c.status, at: c.createdAt.toISOString() })),
    ...signups.map((u) => ({ kind: "signup" as const, id: u.id, name: u.name, contact: u.phone ?? u.email ?? "", detail: u.kycStatus === "pending" ? "Signed up, KYC pending" : `KYC ${u.kycStatus}`, channel: ch(u.attribution), via: via(u.attribution), status: u.kycStatus, at: u.createdAt.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return rows;
}

// ---------------- page data ----------------

export async function earliestLead() {
  const [r] = await db.select({ d: sql<Date | null>`min(${users.createdAt})` }).from(users);
  return r?.d ? istDate(new Date(r.d)) : istToday();
}

export async function marketingReport(range: Range) {
  const m = await getMarketing();
  const [meta, google, leads] = await Promise.all([metaReport(m, range), googleReport(m, range), ownLeads(range)]);

  const g = granularityFor(range) === "month" ? "month" : "day";
  const keys = bucketKeys(range, g);
  const keyOf = (date: string) => (g === "month" ? date.slice(0, 7) : date);
  const series = keys.map((k) => ({ key: k, label: bucketLabel(k, g), longLabel: bucketLabel(k, g, true), meta: 0, google: 0, siteLeads: 0, adLeads: 0 }));
  const at = new Map(series.map((s, i) => [s.key, i]));
  for (const [d, v] of Object.entries(meta.daily)) { const i = at.get(keyOf(d)); if (i != null) { series[i].meta += v.spend; series[i].adLeads += v.leads; } }
  for (const [d, v] of Object.entries(google.daily)) { const i = at.get(keyOf(d)); if (i != null) { series[i].google += v.spend; series[i].adLeads += v.leads; } }
  for (const l of leads) { const i = at.get(keyOf(istDate(new Date(l.at)))); if (i != null) series[i].siteLeads += 1; }

  // website leads by source
  const bySource = new Map<string, { channel: Channel | "untracked"; callbacks: number; signups: number }>();
  for (const l of leads) {
    const row = bySource.get(l.channel) ?? { channel: l.channel, callbacks: 0, signups: 0 };
    if (l.kind === "callback") row.callbacks++; else row.signups++;
    bySource.set(l.channel, row);
  }
  const sources = [...bySource.values()].map((s) => ({ ...s, total: s.callbacks + s.signups })).sort((a, b) => b.total - a.total);
  const siteFrom = (c: Channel) => bySource.get(c) ?? { callbacks: 0, signups: 0 };

  const spend = meta.spend + google.spend;
  const platformLeads = meta.leads + google.leads;
  return {
    meta, google,
    totals: {
      spend, platformLeads, cpl: platformLeads ? spend / platformLeads : null,
      callbacks: leads.filter((l) => l.kind === "callback").length,
      signups: leads.filter((l) => l.kind === "signup").length,
      fromAds: leads.filter((l) => l.channel !== "untracked" && CHANNELS[l.channel].paid).length,
      clicks: meta.clicks + google.clicks,
    },
    site: { google: siteFrom("google_ads"), meta: siteFrom("meta_ads") },
    winner: pickWinner(meta, google),
    series, granularity: g, sources,
    recent: leads.slice(0, 40),
  };
}

/** Cheaper cost per lead wins (needs 3+ leads each so one lucky lead doesn't decide it). */
function pickWinner(meta: PlatformReport, google: PlatformReport) {
  if (!meta.connected || !google.connected) return { platform: null, reason: "Connect both to compare" };
  if (meta.leads < 3 || google.leads < 3) return { platform: null, reason: "Need at least 3 leads on each to compare" };
  const a = meta.cpl!, b = google.cpl!;
  if (Math.abs(a - b) / Math.max(a, b) < 0.05) return { platform: null, reason: "Both cost about the same per lead" };
  const w = a < b ? "meta" : "google";
  const pct = Math.round((1 - Math.min(a, b) / Math.max(a, b)) * 100);
  return { platform: w as "meta" | "google", reason: `${pct}% cheaper per lead` };
}

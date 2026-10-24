// Google Ads: OAuth connect, reporting (GAQL over REST) and server-side purchase uploads.
// Platform env: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET (Google Cloud project with the Google Ads API on),
// optional GOOGLE_ADS_DEVELOPER_TOKEN (older API versions) and GOOGLE_ADS_API_VERSION.
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, stores, type Order, type Store } from "~/db.server";
import { env } from "./env.server";
import { orderValuePaise } from "./payment-methods";
import type { DateRange, InsightTotals, SpendSummary } from "./meta.server";

type Json = Record<string, unknown>;
export class GoogleAdsError extends Error {}

const API_VERSION = () => process.env.GOOGLE_ADS_API_VERSION || "v25";
const base = () => `https://googleads.googleapis.com/${API_VERSION()}`;
export const googleAppReady = () => Boolean(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET);
export const googleConnected = (s: Store) => Boolean(s.googleRefreshToken);
export const googleReady = (s: Store) => Boolean(s.googleRefreshToken && s.googleAdsCustomerId);
export const redirectUri = () => `${env.appUrl}/google/callback`;
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
export const formatCid = (id: string | null | undefined) => { const d = digits(id); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d; };

const scrub = (m: string) => m.replace(/ya29\.[\w.-]+/g, "ya29.•••").replace(/1\/\/[\w.-]{20,}/g, "1//•••");

async function safeFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    throw new GoogleAdsError(`Couldn't reach Google${cause ? ` (${cause})` : ""}. Try again in a moment.`);
  }
}

// ---------------- OAuth ----------------

const sign = (v: string) => crypto.createHmac("sha256", env.sessionSecret).update(v).digest("base64url");

/** Signed `state` so the callback knows which store (and who) started the connection. */
export function oauthState(storeId: number, who: string) {
  const body = Buffer.from(JSON.stringify({ s: storeId, w: who, t: Date.now() })).toString("base64url");
  return `${body}.${sign(body)}`;
}
export function readState(state: string | null) {
  const [body, sig] = String(state ?? "").split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sign(body)), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as { s: number; w: string; t: number };
    return Date.now() - v.t < 15 * 60_000 ? v : null;
  } catch { return null; }
}

export function authUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords openid email",
    access_type: "offline",
    prompt: "consent", // always returns a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeCode(code: string) {
  const res = await safeFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(), grant_type: "authorization_code",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; id_token?: string; scope?: string; error_description?: string; error?: string };
  if (!res.ok || !body.refresh_token) throw new GoogleAdsError(body.error_description || body.error || "Google didn't return access. Try connecting again.");
  if (!String(body.scope ?? "").includes("auth/adwords")) throw new GoogleAdsError("Google Ads access wasn't allowed. Connect again and tick the Google Ads permission.");
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from(String(body.id_token).split(".")[1], "base64url").toString()).email ?? null; } catch { /* optional */ }
  return { refreshToken: body.refresh_token, accessToken: body.access_token ?? null, email };
}

const tokenCache = new Map<string, { token: string; exp: number }>();
async function accessToken(refresh: string) {
  const hit = tokenCache.get(refresh);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const res = await safeFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refresh, client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "", grant_type: "refresh_token" }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new GoogleAdsError(body.error === "invalid_grant" ? "Google access was removed or expired. Connect Google again." : `Google sign-in failed (${body.error ?? res.status})`);
  }
  tokenCache.set(refresh, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

export async function revoke(refresh: string) {
  await safeFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => null);
  tokenCache.delete(refresh);
}

// ---------------- API calls ----------------

type Creds = { refresh: string; loginCustomerId?: string | null };
const credsOf = (s: Store): Creds => {
  if (!s.googleRefreshToken) throw new GoogleAdsError("Google Ads isn't connected");
  return { refresh: s.googleRefreshToken, loginCustomerId: s.googleLoginCustomerId };
};

async function call<T = Json>(c: Creds, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken(c.refresh)}`, "Content-Type": "application/json" };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (c.loginCustomerId) headers["login-customer-id"] = digits(c.loginCustomerId);
  const res = await safeFetch(`${base()}/${path}`, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
  const text = await res.text();
  let body: Json = {};
  try { body = JSON.parse(text) as Json; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new GoogleAdsError(scrub(explain(body, res.status)));
  return body as T;
}

/** Turns a Google Ads error into one plain sentence. */
function explain(body: Json, status: number) {
  const err = body.error as { message?: string; status?: string; details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[] } | undefined;
  const first = err?.details?.flatMap((d) => d.errors ?? [])[0];
  const code = first?.errorCode ? Object.values(first.errorCode)[0] : "";
  const known: Record<string, string> = {
    CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION: "Growpefy's Google Ads API access is still in test mode. It works after Google approves production access.",
    ACTION_NOT_PERMITTED: "Growpefy's Google Ads API access is still in test mode. It works after Google approves production access.",
    USER_PERMISSION_DENIED: "This Google login can't open that ad account. Pick an account you have access to, or connect with another login.",
    CUSTOMER_NOT_ENABLED: "This Google Ads account isn't active (cancelled or not set up).",
    NOT_ADS_USER: "This Google login has no Google Ads account.",
    DEVELOPER_TOKEN_NOT_APPROVED: "Growpefy's Google Ads API access is still in test mode.",
    OAUTH_TOKEN_INVALID: "Google access expired. Connect Google again.",
  };
  if (code && known[code]) return known[code];
  return first?.message || err?.message || `Google Ads API error ${status}`;
}

/** Runs a GAQL query and returns all rows (follows nextPageToken). */
async function gaql<T = Json>(c: Creds, customerId: string, query: string, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const r = await call<{ results?: T[]; nextPageToken?: string }>(c, `customers/${digits(customerId)}/googleAds:search`, { body: { query, ...(pageToken ? { pageToken } : {}) } });
    out.push(...(r.results ?? []));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const micros = (v: unknown) => n(v) / 1_000_000;

// ---------------- accounts ----------------

export type GoogleAccountOption = { id: string; name: string; currency: string; manager: boolean; loginCustomerId: string | null; via: string | null };

/** Every ad account this Google login can open, including client accounts under a manager (MCC). */
export async function listAccounts(refresh: string): Promise<GoogleAccountOption[]> {
  const c: Creds = { refresh };
  const r = await call<{ resourceNames?: string[] }>(c, "customers:listAccessibleCustomers");
  const ids = (r.resourceNames ?? []).map((x) => x.split("/")[1]).filter(Boolean).slice(0, 25);
  const out: GoogleAccountOption[] = [];
  for (const id of ids) {
    try {
      const [row] = await gaql<{ customer?: Json }>({ refresh, loginCustomerId: id }, id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1", 1);
      const cu = row?.customer ?? {};
      const manager = Boolean(cu.manager);
      out.push({ id, name: String(cu.descriptiveName ?? `Account ${formatCid(id)}`), currency: String(cu.currencyCode ?? ""), manager, loginCustomerId: null, via: null });
      if (manager) {
        const kids = await gaql<{ customerClient?: Json }>({ refresh, loginCustomerId: id }, id,
          "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.level, customer_client.status FROM customer_client WHERE customer_client.level = 1", 2);
        for (const k of kids) {
          const cc = k.customerClient ?? {};
          if (cc.manager || (cc.status && cc.status !== "ENABLED")) continue;
          const kid = String(cc.id ?? "");
          if (!kid || out.some((o) => o.id === kid && !o.manager)) continue;
          out.push({ id: kid, name: String(cc.descriptiveName ?? `Account ${formatCid(kid)}`), currency: String(cc.currencyCode ?? ""), manager: false, loginCustomerId: id, via: String(cu.descriptiveName ?? formatCid(id)) });
        }
      }
    } catch {
      out.push({ id, name: `Account ${formatCid(id)}`, currency: "", manager: false, loginCustomerId: null, via: null });
    }
  }
  // ad accounts first; managers can't run ads themselves
  return out.filter((o) => !o.manager).concat(out.filter((o) => o.manager));
}

export type GoogleAccount = { id: string; name: string; currency: string; timezone: string; status: string; autoTagging: boolean | null };

export async function fetchAccount(s: Store): Promise<GoogleAccount> {
  const [row] = await gaql<{ customer?: Json }>(credsOf(s), s.googleAdsCustomerId!,
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status, customer.auto_tagging_enabled FROM customer LIMIT 1", 1);
  const c = row?.customer ?? {};
  const st: Record<string, string> = { ENABLED: "Active", CANCELED: "Cancelled", SUSPENDED: "Suspended", CLOSED: "Closed" };
  return {
    id: String(c.id ?? s.googleAdsCustomerId), name: String(c.descriptiveName ?? formatCid(s.googleAdsCustomerId)),
    currency: String(c.currencyCode ?? "INR"), timezone: String(c.timeZone ?? ""), status: st[String(c.status)] ?? String(c.status ?? ""),
    autoTagging: c.autoTaggingEnabled == null ? null : Boolean(c.autoTaggingEnabled),
  };
}

// ---------------- reporting ----------------

const METRICS = "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.average_cpm, metrics.conversions, metrics.conversions_value";
const toTotals = (m: Json | undefined): InsightTotals => {
  const spend = micros(m?.costMicros), purchases = n(m?.conversions), value = n(m?.conversionsValue);
  return {
    spend, impressions: n(m?.impressions), reach: 0, clicks: n(m?.clicks), linkClicks: n(m?.clicks),
    ctr: n(m?.ctr) * 100, cpc: micros(m?.averageCpc), cpm: micros(m?.averageCpm),
    purchases, purchaseValue: value, addToCart: 0, initiateCheckout: 0,
    costPerPurchase: purchases > 0 ? spend / purchases : null, roas: spend > 0 ? value / spend : null,
  };
};
const between = (r: DateRange) => `segments.date BETWEEN '${r.since.replace(/[^\d-]/g, "")}' AND '${r.until.replace(/[^\d-]/g, "")}'`;

const CHANNEL: Record<string, string> = {
  SEARCH: "Search", PERFORMANCE_MAX: "Performance Max", SHOPPING: "Shopping", DISPLAY: "Display", VIDEO: "YouTube",
  DEMAND_GEN: "Demand Gen", DISCOVERY: "Demand Gen", APP: "App", SMART: "Smart", LOCAL: "Local", HOTEL: "Hotel",
};

export async function fetchInsights(s: Store, range: DateRange) {
  const c = credsOf(s), cid = s.googleAdsCustomerId!;
  const [summary, daily, campaigns] = await Promise.all([
    gaql<{ metrics?: Json }>(c, cid, `SELECT ${METRICS} FROM customer WHERE ${between(range)}`, 1),
    gaql<{ metrics?: Json; segments?: Json }>(c, cid, `SELECT segments.date, ${METRICS} FROM customer WHERE ${between(range)}`),
    gaql<{ metrics?: Json; campaign?: Json }>(c, cid, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${METRICS} FROM campaign WHERE ${between(range)} AND metrics.impressions > 0`),
  ]);
  // GAQL returns one summary row per... customer; add them up to be safe
  const sum = summary.reduce<Json>((a, r) => {
    const m = r.metrics ?? {};
    for (const k of ["costMicros", "impressions", "clicks", "conversions", "conversionsValue"]) a[k] = n(a[k]) + n(m[k]);
    return a;
  }, {});
  const tot = toTotals(sum);
  tot.ctr = tot.impressions ? (tot.clicks / tot.impressions) * 100 : 0;
  tot.cpc = tot.clicks ? tot.spend / tot.clicks : 0;
  tot.cpm = tot.impressions ? (tot.spend / tot.impressions) * 1000 : 0;
  return {
    totals: tot,
    daily: daily.map((d) => ({ date: String(d.segments?.date ?? ""), ...toTotals(d.metrics) })).sort((a, b) => a.date.localeCompare(b.date)),
    campaigns: campaigns
      .map((r) => ({
        id: String(r.campaign?.id ?? ""), name: String(r.campaign?.name ?? ""),
        channel: CHANNEL[String(r.campaign?.advertisingChannelType)] ?? String(r.campaign?.advertisingChannelType ?? "").toLowerCase(),
        status: String(r.campaign?.status ?? ""), ...toTotals(r.metrics),
      }))
      .sort((a, b) => b.spend - a.spend),
  };
}

const spendCache = new Map<string, { at: number; value: SpendSummary }>();

/** Spend for dashboards, bucketed like Meta's fetchSpend. Cached 5 min. */
export async function fetchSpend(s: Store, range: DateRange, granularity: "hour" | "day" | "month"): Promise<SpendSummary> {
  const key = `${s.id}:${s.googleAdsCustomerId}:${range.since}:${range.until}:${granularity}`;
  const hit = spendCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  let value: SpendSummary;
  try {
    const seg = granularity === "month" ? "segments.month" : "segments.date";
    const rows = await gaql<{ metrics?: Json; segments?: Json }>(credsOf(s), s.googleAdsCustomerId!,
      `SELECT ${seg}, metrics.cost_micros, metrics.conversions FROM customer WHERE ${between(range)}`);
    const series: Record<string, number> = {};
    let spend = 0, purchases = 0;
    for (const r of rows) {
      const v = micros(r.metrics?.costMicros);
      spend += v; purchases += n(r.metrics?.conversions);
      if (granularity !== "hour") {
        const k = granularity === "month" ? String(r.segments?.month ?? "").slice(0, 7) : String(r.segments?.date ?? "");
        series[k] = (series[k] ?? 0) + v;
      }
    }
    value = { spend, purchases: Math.round(purchases * 10) / 10, series, error: null };
  } catch (e) {
    value = { spend: 0, purchases: 0, series: {}, error: scrub(e instanceof Error ? e.message : String(e)) };
  }
  spendCache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------- conversion actions ----------------

export type ConversionActionOption = { resource: string; name: string; type: string; category: string };

export async function listConversionActions(s: Store): Promise<ConversionActionOption[]> {
  const rows = await gaql<{ conversionAction?: Json }>(credsOf(s), s.googleAdsCustomerId!,
    "SELECT conversion_action.resource_name, conversion_action.name, conversion_action.type, conversion_action.category, conversion_action.status FROM conversion_action WHERE conversion_action.status = 'ENABLED'", 2);
  return rows.map((r) => ({
    resource: String(r.conversionAction?.resourceName ?? ""), name: String(r.conversionAction?.name ?? ""),
    type: String(r.conversionAction?.type ?? ""), category: String(r.conversionAction?.category ?? ""),
  })).filter((a) => a.resource && a.type === "UPLOAD_CLICKS");
}

/** Creates an "import from clicks" purchase action that Growpefy uploads orders to. */
export async function createConversionAction(s: Store) {
  const name = "Growpefy purchase";
  const r = await call<{ results?: { resourceName?: string }[] }>(credsOf(s), `customers/${digits(s.googleAdsCustomerId)}/conversionActions:mutate`, {
    body: { operations: [{ create: { name, type: "UPLOAD_CLICKS", category: "PURCHASE", status: "ENABLED", countingType: "MANY_PER_CLICK", valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false, defaultCurrencyCode: "INR" } } }] },
  });
  const resource = r.results?.[0]?.resourceName;
  if (!resource) throw new GoogleAdsError("Google didn't create the conversion action");
  return { resource, name };
}

// ---------------- purchase upload ----------------

const sha = (v: string) => crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
const istStamp = (d: Date) => {
  const ist = new Date(d.getTime() + 330 * 60_000).toISOString(); // shift to IST, then format
  return `${ist.slice(0, 10)} ${ist.slice(11, 19)}+05:30`;
};

export function shouldUploadPurchase(s: Store, o: Order) {
  if (!googleReady(s) || !s.googleConversionAction) return false;
  const t = o.tracking ?? {};
  if (!t.gclid && !t.gbraid && !t.wbraid) return false; // only ad clicks can be attributed
  return o.status === "paid" || (o.status === "cod_placed" && s.googleFireCod);
}

/** Uploads one purchase to the store's Google Ads conversion action. Returns false when it doesn't apply. */
export async function uploadPurchase(s: Store, o: Order) {
  if (!shouldUploadPurchase(s, o)) return false;
  const t = o.tracking ?? {};
  const c = o.customer;
  const ids: Json[] = [{ hashedPhoneNumber: sha(`+91${c.phone}`) }];
  if (c.email) ids.push({ hashedEmail: sha(c.email) });
  const conv: Json = {
    conversionAction: s.googleConversionAction,
    conversionDateTime: istStamp(o.createdAt),
    conversionValue: orderValuePaise(o) / 100,
    currencyCode: "INR",
    orderId: o.id,
    userIdentifiers: ids,
    ...(t.gclid ? { gclid: t.gclid } : t.gbraid ? { gbraid: t.gbraid } : { wbraid: t.wbraid }),
  };
  const r = await call<{ partialFailureError?: { message?: string } }>(credsOf(s), `customers/${digits(s.googleAdsCustomerId)}:uploadClickConversions`, {
    body: { conversions: [conv], partialFailure: true },
  });
  if (r.partialFailureError?.message) throw new GoogleAdsError(scrub(r.partialFailureError.message));
  return true;
}

// ---------------- saving ----------------

export async function saveConnection(storeId: number, refreshToken: string, email: string | null) {
  await db.update(stores).set({
    googleRefreshToken: refreshToken, googleAccountEmail: email,
    // a new login may not reach the old account: pick again
    googleAdsCustomerId: null, googleLoginCustomerId: null, googleConversionAction: null, googleConversionActionName: null,
  }).where(eq(stores.id, storeId));
}

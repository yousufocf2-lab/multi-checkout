import crypto from "node:crypto";
import type { Order, Store } from "~/db/schema";

// ---------------- helpers ----------------

type Json = Record<string, unknown>;

export class MetaError extends Error {}

function graphBase(store: Store) {
  return `https://graph.facebook.com/${store.metaApiVersion || "v23.0"}`;
}

export function actId(store: Store) {
  const id = (store.metaAdAccountId ?? "").replace(/\D/g, "");
  if (!id) throw new MetaError("Ad account ID is not set");
  return `act_${id}`;
}

async function graphGet<T = Json>(store: Store, path: string, params: Record<string, string> = {}): Promise<T> {
  if (!store.metaAccessToken) throw new MetaError("Meta access token is not set");
  const qs = new URLSearchParams({ ...params, access_token: store.metaAccessToken });
  const res = await fetch(`${graphBase(store)}/${path}?${qs}`);
  const body = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) throw new MetaError(body.error?.message ?? `Meta API ${res.status}`);
  return body as T;
}

/** Follows paging.next up to `maxPages`. */
async function graphGetAll<T = Json>(store: Store, path: string, params: Record<string, string>, maxPages = 5) {
  const out: T[] = [];
  let page = await graphGet<{ data: T[]; paging?: { next?: string } }>(store, path, params);
  out.push(...(page.data ?? []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    const res = await fetch(page.paging.next);
    page = (await res.json()) as typeof page;
    out.push(...(page.data ?? []));
  }
  return out;
}

type ActionRow = { action_type: string; value: string };

const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function pickAction(rows: ActionRow[] | undefined, types = PURCHASE_TYPES): number {
  if (!rows) return 0;
  for (const t of types) {
    const hit = rows.find((r) => r.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

// ---------------- account ----------------

export type MetaAccount = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  isPrepaid: boolean;
  amountSpent: number; // rupees (lifetime)
  balance: number; // rupees
  spendCap: number | null; // rupees
  fundingSource: string | null;
  disableReason: string | null;
};

const ACCOUNT_STATUS: Record<number, string> = {
  1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Pending risk review", 8: "Pending settlement",
  9: "In grace period", 100: "Pending closure", 101: "Closed", 201: "Any active", 202: "Any closed",
};

export async function fetchAccount(store: Store): Promise<MetaAccount> {
  const a = await graphGet<Json>(store, actId(store), {
    fields: "name,currency,timezone_name,account_status,amount_spent,balance,spend_cap,is_prepay_account,funding_source_details,disable_reason",
  });
  // amount_spent / balance / spend_cap are in minor units (paise for INR)
  const fsd = a.funding_source_details as { display_string?: string } | undefined;
  const cap = num(a.spend_cap);
  return {
    id: String(a.id ?? ""),
    name: String(a.name ?? ""),
    currency: String(a.currency ?? "INR"),
    timezone: String(a.timezone_name ?? ""),
    status: ACCOUNT_STATUS[num(a.account_status)] ?? String(a.account_status ?? ""),
    isPrepaid: Boolean(a.is_prepay_account),
    amountSpent: num(a.amount_spent) / 100,
    balance: num(a.balance) / 100,
    spendCap: cap > 0 ? cap / 100 : null,
    fundingSource: fsd?.display_string ?? null,
    disableReason: a.disable_reason ? String(a.disable_reason) : null,
  };
}

// ---------------- insights ----------------

export type InsightTotals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchases: number;
  purchaseValue: number;
  addToCart: number;
  initiateCheckout: number;
  costPerPurchase: number | null;
  roas: number | null;
};

const INSIGHT_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,cpm,actions,action_values";

function toTotals(r: Json | undefined): InsightTotals {
  const actions = r?.actions as ActionRow[] | undefined;
  const values = r?.action_values as ActionRow[] | undefined;
  const spend = num(r?.spend);
  const purchases = pickAction(actions);
  const purchaseValue = pickAction(values);
  return {
    spend,
    impressions: num(r?.impressions),
    reach: num(r?.reach),
    clicks: num(r?.clicks),
    linkClicks: num(r?.inline_link_clicks),
    ctr: num(r?.ctr),
    cpc: num(r?.cpc),
    cpm: num(r?.cpm),
    purchases,
    purchaseValue,
    addToCart: pickAction(actions, ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
    initiateCheckout: pickAction(actions, ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]),
    costPerPurchase: purchases > 0 ? spend / purchases : null,
    roas: spend > 0 ? purchaseValue / spend : null,
  };
}

export type DateRange = { since: string; until: string }; // YYYY-MM-DD

export async function fetchInsights(store: Store, range: DateRange) {
  const time_range = JSON.stringify(range);
  const [summary, daily, campaigns] = await Promise.all([
    graphGet<{ data: Json[] }>(store, `${actId(store)}/insights`, { fields: INSIGHT_FIELDS, time_range, level: "account" }),
    graphGetAll<Json>(store, `${actId(store)}/insights`, {
      fields: "spend,impressions,clicks,actions,action_values", time_range, level: "account", time_increment: "1", limit: "100",
    }),
    graphGetAll<Json>(store, `${actId(store)}/insights`, {
      fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`, time_range, level: "campaign", limit: "100",
    }),
  ]);

  return {
    totals: toTotals(summary.data?.[0]),
    daily: daily
      .map((d) => ({ date: String(d.date_start), ...toTotals(d) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    campaigns: campaigns
      .map((c) => ({ id: String(c.campaign_id), name: String(c.campaign_name ?? ""), ...toTotals(c) }))
      .sort((a, b) => b.spend - a.spend),
  };
}

// ---------------- recharges / billing ----------------

export type Recharge = { time: string; amount: number | null; label: string; status: string | null };

/**
 * Prepaid recharges & billing charges. Meta exposes this unevenly:
 * 1) `transactions` edge (billing), 2) fallback: account `activities` funding events.
 */
export async function fetchRecharges(store: Store, range: DateRange): Promise<{ items: Recharge[]; source: string; note?: string }> {
  const since = Math.floor(new Date(`${range.since}T00:00:00+05:30`).getTime() / 1000);
  const until = Math.floor(new Date(`${range.until}T23:59:59+05:30`).getTime() / 1000);

  try {
    const rows = await graphGetAll<Json>(store, `${actId(store)}/transactions`, {
      fields: "time,amount,status,charge_type,billing_reason,payment_option,tx_type",
      time_start: String(since), time_stop: String(until), limit: "100",
    });
    return {
      source: "transactions",
      items: rows.map((r) => ({
        time: new Date(num(r.time) * 1000).toISOString(),
        amount: parseMoney(r.amount),
        label: [r.charge_type, r.billing_reason, r.payment_option].filter(Boolean).join(" · ") || "Charge",
        status: r.status ? String(r.status) : null,
      })),
    };
  } catch (e1) {
    try {
      const rows = await graphGetAll<Json>(store, `${actId(store)}/activities`, {
        fields: "event_type,event_time,translated_event_type,extra_data",
        since: String(since), until: String(until), limit: "100",
      });
      const funding = rows.filter((r) => /fund|billing|payment|charge/i.test(String(r.event_type ?? "")));
      return {
        source: "activities",
        note: "Billing API access isn't available for this account, so funding events are shown from the account activity log.",
        items: funding.map((r) => ({
          time: String(r.event_time ?? ""),
          amount: amountFromExtra(r.extra_data),
          label: String(r.translated_event_type ?? r.event_type ?? "Event"),
          status: null,
        })),
      };
    } catch (e2) {
      return {
        source: "none",
        items: [],
        note: `Meta did not return recharge history (${(e1 as Error).message}). Check Business Settings → Billing.`,
      };
    }
  }
}

function parseMoney(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as { amount?: unknown; amount_in_hundredths?: unknown };
    if (o.amount_in_hundredths != null) return num(o.amount_in_hundredths) / 100;
    if (o.amount != null) return num(o.amount);
    return null;
  }
  return num(v) / 100; // bare numbers are minor units
}

function amountFromExtra(extra: unknown): number | null {
  try {
    const d = typeof extra === "string" ? JSON.parse(extra) : extra;
    const raw = (d as Json)?.new_value ?? (d as Json)?.amount ?? (d as Json)?.funding_amount;
    if (raw == null) return null;
    const n = typeof raw === "object" ? num((raw as Json).amount) : num(raw);
    return Number.isFinite(n) && n > 0 ? n / 100 : null;
  } catch {
    return null;
  }
}

// ---------------- connection test ----------------

export async function testMeta(store: Store) {
  const a = await fetchAccount(store);
  let pixel: string | null = null;
  if (store.metaPixelId) {
    const p = await graphGet<Json>({ ...store, metaAccessToken: store.metaCapiToken || store.metaAccessToken }, store.metaPixelId, { fields: "name" });
    pixel = String(p.name ?? store.metaPixelId);
  }
  return { account: a, pixel };
}

// ---------------- Conversions API (Purchase) ----------------

const sha = (v: string) => crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export function shouldTrackPurchase(store: Store, order: Order) {
  if (!store.metaPixelId || !(store.metaCapiToken || store.metaAccessToken)) return false;
  if (order.status === "paid") return true;
  return order.status === "cod_placed" && store.metaFireCodPurchase;
}

export function purchaseValue(order: Order) {
  return (order.amountPaid ?? order.total) / 100;
}

/** Server-side Purchase event, deduplicated with the browser pixel via event_id = order.id. */
export async function sendCapiPurchase(store: Store, order: Order) {
  if (!shouldTrackPurchase(store, order)) return false;
  const c = order.customer;
  const t = order.tracking ?? {};
  const user_data: Json = {
    ph: [sha(`91${c.phone}`)],
    fn: c.firstName ? [sha(c.firstName)] : undefined,
    ln: c.lastName ? [sha(c.lastName)] : undefined,
    em: c.email ? [sha(c.email)] : undefined,
    ct: c.city ? [sha(c.city.replace(/\s+/g, ""))] : undefined,
    st: c.state ? [sha(c.state)] : undefined,
    zp: c.pincode ? [sha(c.pincode)] : undefined,
    country: [sha("in")],
    external_id: [sha(c.phone)],
    client_ip_address: t.ip,
    client_user_agent: t.ua,
    fbp: t.fbp,
    fbc: t.fbc,
  };
  const body = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: order.id,
        action_source: "website",
        event_source_url: t.sourceUrl,
        user_data,
        custom_data: {
          currency: "INR",
          value: purchaseValue(order),
          order_id: order.id,
          content_type: "product",
          content_ids: order.items.map((l) => l.variantId),
          num_items: order.items.reduce((s, l) => s + l.quantity, 0),
          payment_method: order.paymentMethod,
        },
      },
    ],
  };
  const token = store.metaCapiToken || store.metaAccessToken!;
  const res = await fetch(`${graphBase(store)}/${store.metaPixelId}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new MetaError(`CAPI ${res.status}: ${await res.text()}`);
  return true;
}

// ---------------- spend for dashboards ----------------

const spendCache = new Map<string, { at: number; value: SpendSummary }>();
export type SpendSummary = { spend: number; purchases: number; series: Record<string, number>; error: string | null };

/** Ad spend for a range, bucketed by day or month (hourly ranges return totals only). Cached 5 min. */
export async function fetchSpend(store: Store, range: DateRange, granularity: "hour" | "day" | "month"): Promise<SpendSummary> {
  const key = `${store.id}:${range.since}:${range.until}:${granularity}`;
  const hit = spendCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  // Meta keeps ~37 months of insights
  const minSince = new Date();
  minSince.setMonth(minSince.getMonth() - 36);
  const since = range.since < minSince.toISOString().slice(0, 10) ? minSince.toISOString().slice(0, 10) : range.since;
  const time_range = JSON.stringify({ since, until: range.until });

  let value: SpendSummary;
  try {
    const [summary, rows] = await Promise.all([
      graphGet<{ data: Json[] }>(store, `${actId(store)}/insights`, { fields: "spend,actions", time_range, level: "account" }),
      granularity === "hour"
        ? Promise.resolve([] as Json[])
        : graphGetAll<Json>(store, `${actId(store)}/insights`, {
            fields: "spend", time_range, level: "account", limit: "500",
            time_increment: granularity === "day" ? "1" : "monthly",
          }),
    ]);
    const t = summary.data?.[0];
    const series: Record<string, number> = {};
    for (const r of rows) {
      const k = granularity === "day" ? String(r.date_start) : String(r.date_start).slice(0, 7);
      series[k] = (series[k] ?? 0) + num(r.spend);
    }
    value = { spend: num(t?.spend), purchases: pickAction(t?.actions as ActionRow[] | undefined), series, error: null };
  } catch (e) {
    value = { spend: 0, purchases: 0, series: {}, error: e instanceof Error ? e.message : String(e) };
  }
  spendCache.set(key, { at: Date.now(), value });
  return value;
}

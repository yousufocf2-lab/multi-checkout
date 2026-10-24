// Meta + Google ads side by side: spend for dashboards and orders on our checkout that came from each platform's ad clicks.
import { and, gte, inArray, lt, sql } from "drizzle-orm";
import { db, orders, type Store } from "~/db.server";
import { orderValueSql } from "./order-value.server";
import { fetchSpend as metaSpend, type DateRange, type SpendSummary } from "./meta.server";
import { fetchSpend as googleSpend, googleReady } from "./google-ads.server";

export type Platform = "meta" | "google";
export const metaReady = (s: Store) => Boolean(s.metaAdAccountId && s.metaAccessToken);
export const adsReady = (s: Store) => metaReady(s) || googleReady(s);

export type StoreSpend = { store: Store; meta: SpendSummary | null; google: SpendSummary | null };

/** Spend from every connected platform of each store (each platform cached 5 min). */
export async function spendFor(list: Store[], range: DateRange, g: "hour" | "day" | "month"): Promise<StoreSpend[]> {
  return Promise.all(list.map(async (store) => {
    const [meta, google] = await Promise.all([
      metaReady(store) ? metaSpend(store, range, g) : Promise.resolve(null),
      googleReady(store) ? googleSpend(store, range, g) : Promise.resolve(null),
    ]);
    return { store, meta, google };
  }));
}

/** Total spend of one store across platforms; null when nothing is connected or every platform failed. */
export function totalOf(s: StoreSpend) {
  const ok = [s.meta, s.google].filter((x): x is SpendSummary => Boolean(x && !x.error));
  return ok.length ? ok.reduce((a, x) => a + x.spend, 0) : null;
}

const OK = ["paid", "cod_placed"];

/**
 * Orders on our checkout whose visitor arrived from an ad click: Meta (fbclid / _fbc) or Google (gclid / gbraid / wbraid).
 * This is real checkout data, not the platforms' own attribution.
 */
export async function clickOrders(storeIds: number[], from: Date, to: Date) {
  if (!storeIds.length) return { meta: { orders: 0, revenue: 0 }, google: { orders: 0, revenue: 0 } };
  const isGoogle = sql`coalesce(${orders.tracking}->>'gclid', ${orders.tracking}->>'gbraid', ${orders.tracking}->>'wbraid') is not null`;
  const isMeta = sql`${orders.tracking}->>'fbc' is not null`;
  const [r] = await db.select({
    mo: sql<number>`count(*) filter (where ${isMeta})::int`,
    mr: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}) filter (where ${isMeta}), 0)`,
    go: sql<number>`count(*) filter (where ${isGoogle})::int`,
    gr: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}) filter (where ${isGoogle}), 0)`,
  }).from(orders).where(and(inArray(orders.storeId, storeIds), inArray(orders.status, OK), gte(orders.createdAt, from), lt(orders.createdAt, to)));
  return {
    meta: { orders: r?.mo ?? 0, revenue: Number(r?.mr ?? 0) / 100 },
    google: { orders: r?.go ?? 0, revenue: Number(r?.gr ?? 0) / 100 },
  };
}

export type PlatformScore = {
  platform: Platform; connected: boolean; spend: number | null;
  reported: number | null; // purchases / conversions the platform reports
  clickOrders: number; clickRevenue: number;
  cpo: number | null; // cost per order we use to compare
  roas: number | null;
  basis: "checkout" | "platform" | null;
};

/**
 * Who's doing better. Uses orders on our checkout from each platform's clicks when both have some,
 * otherwise each platform's own reported purchases. Lower cost per order wins.
 */
export function compare(p: { meta: Omit<PlatformScore, "cpo" | "roas" | "basis" | "platform">; google: Omit<PlatformScore, "cpo" | "roas" | "basis" | "platform"> }) {
  const useCheckout = p.meta.clickOrders > 0 && p.google.clickOrders > 0;
  const score = (platform: Platform, x: (typeof p)["meta"]): PlatformScore => {
    const orders = useCheckout ? x.clickOrders : x.reported ?? 0;
    return {
      platform, ...x,
      cpo: x.spend && orders > 0 ? x.spend / orders : null,
      roas: x.spend ? (useCheckout ? x.clickRevenue / x.spend : null) : null,
      basis: x.connected ? (useCheckout ? "checkout" : "platform") : null,
    };
  };
  const meta = score("meta", p.meta), google = score("google", p.google);
  let winner: Platform | null = null;
  let reason = "";
  if (meta.connected && google.connected && (meta.spend ?? 0) > 0 && (google.spend ?? 0) > 0) {
    if (meta.cpo != null && google.cpo != null) {
      const diff = Math.abs(meta.cpo - google.cpo) / Math.max(meta.cpo, google.cpo);
      if (diff >= 0.05) {
        winner = meta.cpo < google.cpo ? "meta" : "google";
        const w = winner === "meta" ? meta : google, l = winner === "meta" ? google : meta;
        reason = `${Math.round(diff * 100)}% cheaper per order (₹${Math.round(w.cpo!)} vs ₹${Math.round(l.cpo!)})`;
      } else reason = "About the same cost per order";
    } else if (meta.cpo != null || google.cpo != null) {
      winner = meta.cpo != null ? "meta" : "google";
      reason = `The only one bringing orders in this period`;
    } else reason = "No orders from either yet in this period";
  }
  return { meta, google, winner, reason, basis: useCheckout ? "checkout" as const : "platform" as const };
}

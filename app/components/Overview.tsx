import { Form, Link, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import type { Overview as OverviewData } from "~/lib/stats.server";
import { PRESETS, rangeLabel } from "~/lib/dates";
import { compactINR } from "~/lib/pricing";
import { RevenueChart, SplitBar } from "./charts";
import { Notice, StatusBadge } from "./ui";

type Jsonified<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;
type Data = Jsonified<OverviewData>;

const inr = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

export function RangePicker({ current }: { current: Data["range"] }) {
  const [params] = useSearchParams();
  const [custom, setCustom] = useState(current.preset === "custom");
  const keep = [...params.entries()].filter(([k]) => !["range", "from", "to"].includes(k));
  const href = (id: string) => {
    const p = new URLSearchParams(keep);
    p.set("range", id);
    return `?${p}`;
  };
  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {PRESETS.map((p) => (
          <Link key={p.id} to={href(p.id)} preventScrollReset onClick={() => setCustom(false)}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm transition ${current.preset === p.id && !custom ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink-soft hover:text-ink"}`}>
            {p.label}
          </Link>
        ))}
        <button type="button" onClick={() => setCustom((c) => !c)}
          className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm ${custom || current.preset === "custom" ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink-soft hover:text-ink"}`}>
          Custom range
        </button>
      </div>
      {custom && (
        <Form method="get" preventScrollReset className="flex flex-wrap items-end gap-2">
          {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="range" value="custom" />
          <label className="text-xs text-ink-soft">From<input type="date" name="from" defaultValue={current.since} max={current.until} className="input mt-1 py-2" /></label>
          <label className="text-xs text-ink-soft">To<input type="date" name="to" defaultValue={current.until} className="input mt-1 py-2" /></label>
          <button className="btn-primary py-2.5">Apply</button>
        </Form>
      )}
    </div>
  );
}

function Delta({ now, before, short }: { now: number; before: number | undefined; short?: boolean }) {
  if (before == null) return null;
  if (before === 0) return now > 0 ? <span className="text-xs font-medium text-good">New this period</span> : null;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return (
    <span className={`num inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-good" : "text-bad"}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(pct).toFixed(pct > -10 && pct < 10 ? 1 : 0)}%{short ? "" : " vs previous period"}
    </span>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 py-1">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="num mt-1 truncate text-lg font-semibold leading-tight">{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-xs text-ink-faint">{sub}</dd>}
    </div>
  );
}

export function OverviewView({ data, showStoreColumn, adsHref }: { data: Data; showStoreColumn: boolean; adsHref?: string }) {
  const t = data.totals;
  const hasAds = t.adSpend != null;
  return (
    <div className="space-y-5">
      {data.adErrors.length > 0 && (
        <Notice tone="warning">
          Ad spend could not be loaded for {data.adErrors.map((e) => e.store).join(", ")}: {data.adErrors[0].error}
        </Notice>
      )}

      <section className="panel grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
        <div>
          <p className="text-sm text-ink-soft">Revenue, {data.range.preset === "custom" ? rangeLabel(data.range) : rangeLabel(data.range).toLowerCase()}</p>
          <p className="num mt-2 text-[44px] font-semibold leading-none tracking-tight sm:text-[52px]">{compactINR(t.revenue)}</p>
          <p className="num mt-2 text-sm text-ink-soft">{inr(t.revenue)} from {t.orders.toLocaleString("en-IN")} orders</p>
          <div className="mt-2"><Delta now={t.revenue} before={data.previous?.revenue} /></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:border-l lg:border-rule lg:pl-10">
          <Metric label="Orders" value={t.orders.toLocaleString("en-IN")} sub={<Delta now={t.orders} before={data.previous?.orders} short />} />
          <Metric label="Average order value" value={inr(t.aov)} />
          <Metric label="Checkout conversion" value={t.conversion == null ? "—" : `${(t.conversion * 100).toFixed(1)}%`} sub={`${t.sessions.toLocaleString("en-IN")} checkouts started`} />
          <Metric label="Ad spend" value={hasAds ? inr(t.adSpend) : "Not connected"} sub={hasAds && t.metaPurchases != null ? `${t.metaPurchases} purchases on Meta` : adsHref ? <Link className="underline" to={adsHref}>Connect ad account</Link> : undefined} />
          <Metric label="ROAS" value={t.roas == null ? "—" : `${t.roas.toFixed(2)}x`} sub="Revenue ÷ ad spend" />
          <Metric label="Cost per order" value={inr(t.costPerOrder)} sub={t.failedPayments ? `${t.failedPayments} failed payments` : "Ad spend ÷ orders"} />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Revenue over time</h2>
          <RevenueChart buckets={data.buckets} showAds={hasAds} />
          {hasAds && data.granularity === "hour" && <p className="mt-2 text-xs text-ink-faint">Meta reports ad spend per day, so hourly view shows spend in the totals only.</p>}
        </section>
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Payment method</h2>
          <SplitBar prepaid={t.prepaidOrders} cod={t.codOrders} prepaidValue={t.prepaidRevenue} codValue={t.codRevenue} />
          <dl className="mt-5 space-y-2 border-t border-rule pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Discounts given</dt><dd className="num">{inr(t.discounts)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Failed payments</dt><dd className="num">{t.failedPayments}</dd></div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Top products</h2>
          {data.topProducts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">No sales in this period</p>
          ) : (
            <ul className="divide-y divide-rule">
              {data.topProducts.map((p) => (
                <li key={p.title} className="flex items-center gap-3 px-5 py-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-rule bg-paper-sunk">
                    {p.image && <img src={p.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</p>
                  <div className="text-right">
                    <p className="num text-sm font-medium">{inr(p.revenue)}</p>
                    <p className="num text-xs text-ink-faint">{p.quantity} sold</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-rule px-5 py-2.5 text-xs text-ink-faint">Product revenue is shown at selling price, before discounts.</p>
        </section>

        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Recent orders</h2>
          {data.recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">No orders in this period</p>
          ) : (
            <ul className="divide-y divide-rule">
              {data.recent.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{o.name || "Customer"}<span className="font-normal text-ink-faint">, {o.city}</span></p>
                    <p className="truncate text-xs text-ink-faint">
                      {showStoreColumn && `${o.storeName}, `}
                      {new Date(o.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <StatusBadge status={o.status} />
                  <p className="num w-20 text-right text-sm font-medium">{inr(o.total)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

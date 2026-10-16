import { Form, Link, useLocation, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { Overview as OverviewData } from "~/lib/stats.server";
import { PRESETS, rangeLabel } from "~/lib/dates";
import { compactINR } from "~/lib/pricing";
import { RevenueChart, SplitBar } from "./charts";
import { Icon, type IconName } from "./Icons";
import { CostTag, Notice, StatusBadge } from "./ui";

type Jsonified<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;
type Data = Jsonified<OverviewData>;
type RangeLike = { preset: string; since: string; until: string };

const inr = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Compact date range menu: one small button, presets + custom range in a dropdown. */
export function RangePicker({ current, align = "left" }: { current: RangeLike; align?: "left" | "right" }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(current.preset === "custom");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [location.search]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const keep = [...params.entries()].filter(([k]) => !["range", "from", "to", "page"].includes(k));
  const href = (id: string) => {
    const p = new URLSearchParams(keep);
    p.set("range", id);
    return `?${p}`;
  };
  const label = PRESETS.find((p) => p.id === current.preset)?.label ?? "Custom";
  const dates = current.since === current.until ? short(current.since) : `${short(current.since)} – ${short(current.until)}`;

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-rule-strong bg-surface px-3 text-sm shadow-sm transition hover:border-ink/30">
        <Icon name="calendar" className="h-4 w-4 text-ink-faint" />
        <span className="font-medium">{label}</span>
        <span className="hidden text-xs text-ink-faint sm:inline">{dates}</span>
        <Icon name="chevron" className={`h-3.5 w-3.5 text-ink-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute z-40 mt-1.5 w-[260px] animate-fadein rounded-xl border border-rule bg-surface p-1.5 shadow-lift ${align === "right" ? "right-0" : "left-0"}`} role="dialog" aria-label="Date range">
          {PRESETS.map((p) => {
            const on = current.preset === p.id && !custom;
            return (
              <Link key={p.id} to={href(p.id)} preventScrollReset onClick={() => setCustom(false)}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${on ? "bg-paper font-medium text-ink" : "text-ink-soft hover:bg-paper hover:text-ink"}`}>
                {p.label}{on && <Icon name="check" className="h-4 w-4 text-pine" />}
              </Link>
            );
          })}
          <button type="button" onClick={() => setCustom((c) => !c)}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm ${custom || current.preset === "custom" ? "bg-paper font-medium text-ink" : "text-ink-soft hover:bg-paper hover:text-ink"}`}>
            Custom range <Icon name="chevron" className={`h-3.5 w-3.5 transition ${custom ? "rotate-180" : ""}`} />
          </button>
          {custom && (
            <Form method="get" preventScrollReset className="mt-1 space-y-2 border-t border-rule p-2">
              {keep.map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="range" value="custom" />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-ink-soft">From<input type="date" name="from" defaultValue={current.since} max={current.until} className="input mt-1 px-2 py-1.5 text-[13px]" /></label>
                <label className="text-xs text-ink-soft">To<input type="date" name="to" defaultValue={current.until} className="input mt-1 px-2 py-1.5 text-[13px]" /></label>
              </div>
              <button className="btn-primary w-full py-2">Apply</button>
            </Form>
          )}
        </div>
      )}
    </div>
  );
}

function Delta({ now, before, onDark }: { now: number; before: number | undefined; onDark?: boolean }) {
  if (before == null) return null;
  if (before === 0) return now > 0 ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${onDark ? "bg-white/15 text-white" : "bg-emerald-50 text-good"}`}>New this period</span> : null;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  const cls = onDark ? (up ? "bg-emerald-400/20 text-emerald-100" : "bg-red-400/20 text-red-100") : up ? "bg-emerald-50 text-good" : "bg-red-50 text-bad";
  return (
    <span className={`num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>{Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}% vs previous
    </span>
  );
}

function Tile({ icon, tint, label, value, sub, tag }: { icon: IconName; tint: string; label: string; value: string; sub?: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`}><Icon name={icon} className="h-4 w-4" /></span>
        <p className="min-w-0 truncate text-xs font-medium text-ink-soft">{label}</p>
      </div>
      <p className="num mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold leading-tight">{value}{tag}</p>
      {sub && <p className="mt-1 truncate text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

export type LeaderRow = { id: number; name: string; revenue: number; orders: number; prepaidShare: number | null; adSpend: number | null; roas: number | null; costPerOrder: number | null };

export function OverviewView({ data, showStoreColumn, adsHref, leaders }: { data: Data; showStoreColumn: boolean; adsHref?: string; leaders?: LeaderRow[] }) {
  const t = data.totals;
  const hasAds = t.adSpend != null;
  const prepaidShare = t.orders ? Math.round((t.prepaidOrders / t.orders) * 100) : null;
  const period = data.range.preset === "custom" ? rangeLabel(data.range) : rangeLabel(data.range).toLowerCase();
  return (
    <div className="space-y-5">
      {data.adErrors.length > 0 && (
        <Notice tone="warning">Ad spend could not be loaded for {data.adErrors.map((e) => e.store).join(", ")}: {data.adErrors[0].error}</Notice>
      )}

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0E1714_0%,#0B5D4B_60%,#138a6e_100%)] p-5 text-white shadow-lift sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-sky-300/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="text-sm text-white/70">Revenue, {period}</p>
            <p className="num mt-2 text-[44px] font-semibold leading-none tracking-tight sm:text-[56px]">{compactINR(t.revenue)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="num text-sm text-white/80">{inr(t.revenue)} from {t.orders.toLocaleString("en-IN")} orders</span>
              <Delta now={t.revenue} before={data.previous?.revenue} onDark />
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            <Glass label="Orders" value={t.orders.toLocaleString("en-IN")} />
            <Glass label="Avg. order" value={inr(t.aov)} />
            <Glass label="Conversion" value={t.conversion == null ? "—" : `${(t.conversion * 100).toFixed(1)}%`} />
          </dl>
        </div>
      </section>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile icon="ads" tint="bg-emerald-50 text-emerald-700" label="Ad spend" value={hasAds ? inr(t.adSpend) : "Not connected"}
          sub={hasAds && t.metaPurchases != null ? `${t.metaPurchases} purchases on Meta` : adsHref ? <Link className="underline" to={adsHref}>Connect ad account</Link> : "Connect Meta in settings"} />
        <Tile icon="trend" tint="bg-sky-50 text-sky-700" label="ROAS" value={t.roas == null ? "—" : `${t.roas.toFixed(2)}x`} sub="Revenue ÷ ad spend" />
        <Tile icon="target" tint="bg-violet-50 text-violet-700" label="Cost per order" value={inr(t.costPerOrder)} tag={<CostTag value={t.costPerOrder} />} sub="Ad spend ÷ orders" />
        <Tile icon="wallet" tint="bg-blue-50 text-blue-700" label="Prepaid share" value={prepaidShare == null ? "—" : `${prepaidShare}%`} sub={`${t.prepaidOrders} online · ${t.codOrders} COD`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Revenue over time</h2>
          <RevenueChart buckets={data.buckets} showAds={hasAds} />
          {hasAds && data.granularity === "hour" && <p className="mt-2 text-xs text-ink-faint">Meta reports ad spend per day, so hourly view shows spend in the totals only.</p>}
        </section>
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Payment method</h2>
          <SplitBar prepaid={t.prepaidOrders} cod={t.codOrders} prepaidValue={t.prepaidRevenue} codValue={t.codRevenue} />
          <dl className="mt-5 space-y-2.5 border-t border-rule pt-4 text-sm">
            <Line icon="discounts" label="Discounts given" value={inr(t.discounts)} />
            <Line icon="close" label="Failed payments" value={String(t.failedPayments)} />
            <Line icon="cart" label="Abandoned checkouts" value={<>{t.abandoned} <span className="text-ink-faint">({inr(t.abandonedValue)})</span></>} />
            {t.refunded > 0 && <Line icon="rupee" label="Refunded" value={inr(t.refunded)} />}
          </dl>
        </section>
      </div>

      {leaders && leaders.length > 1 && <Leaderboard rows={leaders} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Top products</h2>
          {data.topProducts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">No sales in this period</p>
          ) : (
            <ul className="divide-y divide-rule">
              {data.topProducts.map((p, i) => (
                <li key={p.title} className="flex items-center gap-3 px-5 py-3">
                  <span className="num w-4 text-xs font-semibold text-ink-faint">{i + 1}</span>
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
          <div className="flex items-center justify-between border-b border-rule px-5 py-4">
            <h2 className="text-[15px] font-semibold">Recent orders</h2>
            <Link to="/dashboard/orders" className="text-xs font-medium text-pine hover:underline">See all</Link>
          </div>
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

function Glass({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur">
      <dt className="truncate text-[11px] text-white/70">{label}</dt>
      <dd className="num mt-0.5 truncate text-base font-semibold sm:text-lg">{value}</dd>
    </div>
  );
}

function Line({ icon, label, value }: { icon: IconName; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-ink-soft"><Icon name={icon} className="h-4 w-4 text-ink-faint" />{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  const top = Math.max(1, ...rows.map((r) => r.revenue));
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <section className="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Store leaderboard</h2>
        <Link to="/dashboard/compare" className="text-xs font-medium text-pine hover:underline">Compare in detail</Link>
      </div>
      <ol className="divide-y divide-rule">
        {rows.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-5 py-3 sm:grid-cols-[24px_minmax(0,1.4fr)_minmax(0,2fr)_auto]">
            <span className={`num flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? "bg-amber-100 text-amber-800" : i === 1 ? "bg-slate-100 text-slate-700" : i === 2 ? "bg-orange-50 text-orange-800" : "text-ink-faint"}`}>{i + 1}</span>
            <div className="min-w-0">
              <Link to={`/dashboard/select?store=${r.id}&to=/dashboard`} className="block truncate text-sm font-medium hover:underline">{r.name}</Link>
              <p className="num truncate text-xs text-ink-faint">
                {r.orders} orders{r.prepaidShare != null ? ` · ${r.prepaidShare}% prepaid` : ""}{r.roas != null ? ` · ROAS ${r.roas.toFixed(2)}x` : ""}
              </p>
            </div>
            <div className="col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
              <div className="h-2 overflow-hidden rounded-full bg-paper-sunk" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${(r.revenue / top) * 100}%`, background: "#2a78d6" }} />
              </div>
            </div>
            <div className="text-right">
              <p className="num text-sm font-semibold">{inr(r.revenue)}</p>
              <p className="num text-xs text-ink-faint">{total ? Math.round((r.revenue / total) * 100) : 0}% share{r.costPerOrder != null && <> · <CostTag value={r.costPerOrder} /></>}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Store home: sales metrics, next actions, setup guidance and store insights.
import { Link, useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Overview as OverviewData } from "~/lib/stats.server";
import type { HomeTasks, SetupStep } from "~/lib/home.server";
import { addDays } from "~/lib/dates";
import { AdIcon } from "./AdLogos";
import { Icon, type IconName } from "./Icons";
import { AdsVersus, Leaderboard, type LeaderRow } from "./Overview";
import { CostTag, Notice, StatusBadge } from "./ui";

type Jsonified<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;
type Data = Jsonified<OverviewData>;
type B = Data["buckets"][number];

const inr = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const num = (v: number) => v.toLocaleString("en-IN");
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`);
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const span = (a: string, b: string) => (a === b ? short(a) : `${short(a)} – ${short(b)}`);
const ratio = (a: number, b: number) => (b ? a / b : null);

type MetricId = "sessions" | "sales" | "orders" | "conversion" | "aov";
type Metric = {
  id: MetricId; label: string; tip: string; fmt: (v: number | null) => string; axis: (v: number) => string;
  total: number | null; before: number | null; point: (b: B) => number | null; prevPoint: (b: B) => number | null;
};

function metrics(d: Data): Metric[] {
  const t = d.totals, p = d.previous;
  const axisInr = (v: number) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(v >= 1e4 ? 0 : 1)}K` : `₹${Math.round(v)}`);
  const axisNum = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)));
  return [
    { id: "sessions", label: "Checkout sessions", tip: "Times customers opened your checkout", fmt: (v) => (v == null ? "—" : num(v)), axis: axisNum,
      total: t.sessions, before: p?.sessions ?? null, point: (b) => b.sessions, prevPoint: (b) => b.prev?.sessions ?? null },
    { id: "sales", label: "Total sales", tip: "Order value after refunds, all payment methods", fmt: (v) => inr(v), axis: axisInr,
      total: t.revenue, before: p?.revenue ?? null, point: (b) => b.prepaid + b.cod, prevPoint: (b) => b.prev?.revenue ?? null },
    { id: "orders", label: "Orders", tip: "Paid and COD orders placed", fmt: (v) => (v == null ? "—" : num(v)), axis: axisNum,
      total: t.orders, before: p?.orders ?? null, point: (b) => b.orders, prevPoint: (b) => b.prev?.orders ?? null },
    { id: "conversion", label: "Conversion rate", tip: "Orders ÷ checkout sessions", fmt: pct, axis: (v) => `${Math.round(v * 100)}%`,
      total: t.conversion, before: p ? ratio(p.orders, p.sessions) : null,
      point: (b) => ratio(b.orders, b.sessions) ?? 0, prevPoint: (b) => (b.prev ? ratio(b.prev.orders, b.prev.sessions) ?? 0 : null) },
    { id: "aov", label: "Avg. order value", tip: "Total sales ÷ orders", fmt: (v) => inr(v), axis: axisInr,
      total: t.orders ? t.aov : null, before: p ? ratio(p.revenue, p.orders) : null,
      point: (b) => ratio(b.prepaid + b.cod, b.orders) ?? 0, prevPoint: (b) => (b.prev ? ratio(b.prev.revenue, b.prev.orders) ?? 0 : null) },
  ];
}

function Change({ now, before }: { now: number | null; before: number | null }) {
  if (now == null || before == null) return null;
  if (before === 0) return now > 0 ? <span className="text-[11.5px] font-medium text-[#0c5132]">New</span> : <span className="text-[11.5px] text-ink-faint">—</span>;
  const c = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(c) < 0.5) return <span className="text-[11.5px] text-ink-faint">0%</span>;
  const up = c > 0;
  return (
    <span className={`num inline-flex items-center gap-0.5 text-[11.5px] font-medium ${up ? "text-[#0c5132]" : "text-[#8e1f0b]"}`}>
      <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 ${up ? "" : "rotate-90"}`} aria-hidden><path d="M3 9 9 3M4.5 3H9v4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {Math.abs(c).toFixed(Math.abs(c) < 10 ? 1 : 0)}%
    </span>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const raw = v / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p * 3;
}

const BLUE = "#14785d", PREV = "#bd7048";

function MetricChart({ m, buckets, nowLabel, prevLabel }: { m: Metric; buckets: B[]; nowLabel: string; prevLabel: string | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, pad = { t: 10, r: 8, b: 24, l: 44 };
  const iw = width - pad.l - pad.r, ih = H - pad.t - pad.b;
  const cur = buckets.map((b) => m.point(b) ?? 0);
  const prev = prevLabel ? buckets.map((b) => m.prevPoint(b)) : [];
  const max = niceMax(Math.max(0, ...cur, ...prev.map((v) => v ?? 0)));
  const n = buckets.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const path = (vals: (number | null)[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`).join("");
  const line = path(cur);
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : "";
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => f * max);

  const move = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    setHover(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (px / iw) * (n - 1)))));
  };
  const h = hover != null ? buckets[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={H} className="block select-none" onMouseMove={move} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`${m.label} over time`}>
        <defs>
          <linearGradient id="gp-home-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.14" /><stop offset="100%" stopColor={BLUE} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#e7eee9" strokeDasharray={v ? "2 3" : undefined} />
            <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" className="num fill-[#8a8a8a] text-[10.5px]">{m.axis(v)}</text>
          </g>
        ))}
        {buckets.map((b, i) => i % every === 0 && (
          <text key={b.key} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i >= n - every ? "end" : "middle"} className="fill-[#8a8a8a] text-[10.5px]">{b.label}</text>
        ))}
        {prev.length > 0 && <path d={path(prev)} fill="none" stroke={PREV} strokeWidth="1.6" strokeDasharray="4 4" strokeLinejoin="round" />}
        <path d={area} fill="url(#gp-home-area)" />
        <path d={line} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#c9c9c9" />
            {prev.length > 0 && <circle cx={x(hover)} cy={y(prev[hover] ?? 0)} r="3.5" fill="#fff" stroke={PREV} strokeWidth="1.6" />}
            <circle cx={x(hover)} cy={y(cur[hover])} r="4" fill="#fff" stroke={BLUE} strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-[170px] rounded-lg bg-white px-3 py-2 text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,.08),0_8px_20px_-6px_rgba(0,0,0,.25)]"
          style={x(hover) > width - 200 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}>
          <p className="mb-1 font-semibold">{m.label}</p>
          <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-ink-soft"><i className="h-0.5 w-3 rounded" style={{ background: BLUE }} />{h.longLabel}</span><b className="num">{m.fmt(cur[hover])}</b></p>
          {prev.length > 0 && (
            <p className="mt-0.5 flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-ink-soft"><i className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: PREV }} />Previous</span><span className="num">{m.fmt(prev[hover])}</span></p>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded" style={{ background: BLUE }} />{nowLabel}</span>
        {prevLabel && <span className="flex items-center gap-1.5"><i className="w-3.5 border-t-2 border-dashed" style={{ borderColor: PREV }} />{prevLabel}</span>}
      </div>
    </div>
  );
}

function MetricsCard({ data }: { data: Data }) {
  const list = useMemo(() => metrics(data), [data]);
  const [active, setActive] = useState<MetricId>("sales");
  const m = list.find((x) => x.id === active) ?? list[1];
  const r = data.range;
  const days = Math.round((Date.parse(`${r.until}T00:00:00Z`) - Date.parse(`${r.since}T00:00:00Z`)) / 86400_000) + 1;
  const prevLabel = data.previous ? span(addDays(r.since, -days), addDays(r.since, -1)) : null;
  return (
    <section className="panel overflow-hidden">
      <div className="scroll-thin flex overflow-x-auto border-b border-rule p-1.5" role="tablist" aria-label="Metrics">
        {list.map((x) => {
          const on = x.id === active;
          return (
            <button key={x.id} type="button" role="tab" aria-selected={on} onClick={() => setActive(x.id)}
              className={`min-w-[132px] flex-1 rounded-lg px-3 py-2 text-left transition ${on ? "bg-[#eaf4ee]" : "hover:bg-[#f7fbf8]"}`}>
              <span className="block truncate text-[12px] font-medium text-ink-soft underline decoration-[#c9c9c9] decoration-dotted underline-offset-[3px]" title={x.tip}>{x.label}</span>
              <span className="mt-0.5 flex items-baseline gap-2">
                <span className="num text-[17px] font-semibold leading-tight tracking-tight">{x.fmt(x.total)}</span>
                <Change now={x.total} before={x.before} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="px-4 pb-3 pt-4">
        <MetricChart m={m} buckets={data.buckets} nowLabel={span(r.since, r.until)} prevLabel={prevLabel} />
      </div>
    </section>
  );
}

/** Compact links to the store tasks that need attention now. */
function TodoChips({ tasks, links }: { tasks: HomeTasks; links: { toShip: string | null; inventory: string | null } }) {
  const chips: { icon: IconName; text: string; to: string; tone?: "warn" }[] = [];
  if (tasks.toShip && links.toShip) chips.push({ icon: "shipping", text: `${num(tasks.toShip)} ${tasks.toShip === 1 ? "order" : "orders"} to ship`, to: links.toShip });
  if (tasks.toConfirm) chips.push({ icon: "chat", text: `${num(tasks.toConfirm)} COD ${tasks.toConfirm === 1 ? "order" : "orders"} awaiting confirmation`, to: "/dashboard/orders?method=cod" });
  if (tasks.abandoned.n) chips.push({ icon: "cart", text: `${inr(tasks.abandoned.value)} in ${num(tasks.abandoned.n)} abandoned ${tasks.abandoned.n === 1 ? "checkout" : "checkouts"} (7 days)`, to: "/dashboard/orders/abandoned" });
  if (tasks.failedToday) chips.push({ icon: "alert", text: `${num(tasks.failedToday)} failed ${tasks.failedToday === 1 ? "payment" : "payments"} today`, to: "/dashboard/orders?status=failed&range=today", tone: "warn" });
  if (tasks.stock?.out && links.inventory) chips.push({ icon: "box", text: `${num(tasks.stock.out)} ${tasks.stock.out === 1 ? "product" : "products"} out of stock`, to: links.inventory, tone: "warn" });
  else if (tasks.stock?.low && links.inventory) chips.push({ icon: "box", text: `${num(tasks.stock.low)} running low on stock`, to: links.inventory });

  if (!chips.length) {
    return <p className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><Icon name="check" className="h-3.5 w-3.5 text-[#0c5132]" strokeWidth={2.2} />All caught up. Nothing needs your attention right now.</p>;
  }
  return (
    <div className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {chips.map((c) => (
        <Link key={c.text} to={c.to}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-white px-3 text-[12.5px] font-medium shadow-[0_1px_3px_rgba(20,70,48,.08)] transition hover:bg-[#f7fbf8] ${c.tone === "warn" ? "text-[#8e1f0b]" : "text-[#21483a]"}`}>
          <Icon name={c.icon} className="h-3.5 w-3.5" strokeWidth={2} />{c.text}<Icon name="chevron" className="h-3 w-3 -rotate-90 text-ink-faint" />
        </Link>
      ))}
    </div>
  );
}

function SetupGuide({ steps: initial, name, base }: { steps: SetupStep[]; name: string; base: string }) {
  // Ticking the circle marks a step done by hand (or undoes a hand tick); shown at once, saved in the background
  const tick = useFetcher();
  const [over, setOver] = useState<Record<string, boolean>>({});
  const steps = initial.map((s) => (s.id in over ? { ...s, done: over[s.id], manual: over[s.id] } : s));
  const toggle = (s: SetupStep) => {
    if (s.done && !s.manual) return; // done for real (logo found, product added…)
    setOver((o) => ({ ...o, [s.id]: !s.done }));
    tick.submit({ step: s.id, done: s.done ? "0" : "1" }, { method: "post", action: `${base}/setup` });
  };
  const KEY = "gp-setup-hidden";
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState<string>(() => steps.find((s) => !s.done)?.id ?? steps[0].id);
  useEffect(() => { try { setHidden(localStorage.getItem(KEY) === "1"); } catch { /* storage blocked */ } }, []);
  const toggleHidden = () => { const v = !hidden; setHidden(v); try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* storage blocked */ } };
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold">Setup guide</h2>
          <p className="text-[12.5px] text-ink-soft">Use this guide to get {name} ready to sell.</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="num text-[12px] text-ink-soft">{done} of {steps.length} tasks complete</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#e7eee9]"><span className="block h-full rounded-full bg-[#14785d]" style={{ width: `${(done / steps.length) * 100}%` }} /></span>
          </div>
        </div>
        <button type="button" onClick={toggleHidden} className="btn-quiet btn text-ink-soft" aria-expanded={!hidden}>
          {hidden ? "Show" : "Hide"}<Icon name="chevron" className={`h-3.5 w-3.5 transition ${hidden ? "" : "rotate-180"}`} />
        </button>
      </div>
      {!hidden && (
        <ol className="space-y-0.5 px-2 pb-2">
          {steps.map((s) => {
            const on = open === s.id;
            const external = s.to.startsWith("http") || s.to.startsWith("/s/");
            return (
              <li key={s.id} className={`rounded-lg ${on ? "bg-[#f7f7f7]" : ""}`}>
                <div className="flex w-full items-center gap-2.5 px-2 py-2">
                  <button type="button" onClick={() => toggle(s)} disabled={s.done && !s.manual}
                    title={s.done ? (s.manual ? "Mark as not done" : "Done") : "Mark as done"} aria-label={s.done ? `${s.title}: done` : `Mark ${s.title} as done`}
                    className="group -m-1 shrink-0 rounded-full p-1 disabled:cursor-default">
                    {s.done
                      ? <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#14785d] text-white"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
                      : <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-dashed border-[#8a8a8a] text-transparent transition group-hover:border-solid group-hover:border-[#14785d] group-hover:text-[#14785d]"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>}
                  </button>
                  <button type="button" onClick={() => setOpen(s.id)} className={`min-w-0 flex-1 text-left text-[13px] ${on ? "font-semibold" : "font-medium"} ${s.done && !on ? "text-ink-soft" : ""}`}>{s.title}</button>
                </div>
                {on && (
                  <div className="pb-3 pl-[38px] pr-3">
                    <p className="text-[12.5px] text-ink-soft">{s.text}</p>
                    {external
                      ? <a href={s.to} target="_blank" rel="noreferrer" className={`mt-2 ${s.done ? "btn-secondary" : "btn-primary"} btn inline-flex`}>{s.cta}</a>
                      : <Link to={s.to} className={`mt-2 ${s.done ? "btn-secondary" : "btn-primary"} btn inline-flex`}>{s.cta}</Link>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Plain-language observations from this period's numbers, each with where to act. */
function insightsFor(d: Data, tasks: HomeTasks, base: string | null) {
  const t = d.totals, p = d.previous;
  const out: { icon: IconName; text: React.ReactNode; to?: string; cta?: string }[] = [];
  const prepaid = t.orders ? t.prepaidOrders / t.orders : null;
  if (prepaid != null && t.orders >= 10 && prepaid < 0.4) {
    out.push({ icon: "rupee", text: <>Only <b>{Math.round(prepaid * 100)}%</b> of orders are prepaid. A small prepaid discount usually cuts RTO and lifts this.</>, to: base ? `${base}/payment-rules` : undefined, cta: "Payment offers" });
  }
  if (t.abandonedValue > 0 && t.abandoned >= 3) {
    out.push({ icon: "cart", text: <><b>{inr(t.abandonedValue)}</b> was left in {num(t.abandoned)} abandoned checkouts. WhatsApp reminders win back a share of these.</>, to: "/dashboard/orders/abandoned", cta: "See checkouts" });
  }
  const prevConv = p ? ratio(p.orders, p.sessions) : null;
  if (t.conversion != null && prevConv && t.sessions >= 30) {
    const c = (t.conversion - prevConv) / prevConv;
    if (Math.abs(c) >= 0.15) out.push({ icon: "trend", text: <>Checkout conversion is {c > 0 ? "up" : "down"} <b>{Math.abs(Math.round(c * 100))}%</b> ({pct(prevConv)} → {pct(t.conversion)}).{c < 0 ? " Check payment methods and shipping charges." : ""}</> });
  }
  if (t.roas != null && t.adSpend && t.adSpend > 500 && t.roas < 1.5) {
    out.push({ icon: "ads", text: <>Ads returned <b>{inr(t.roas, 2)}</b> for every ₹1 spent. Pause campaigns with a high cost per order.</>, to: base ? `${base}/ads` : "/dashboard/ads", cta: "Open ads" });
  }
  const top = d.topProducts[0];
  const productSales = d.topProducts.reduce((a, x) => a + x.revenue, 0);
  if (top && productSales && d.topProducts.length > 1 && top.revenue / productSales >= 0.5) {
    out.push({ icon: "bag", text: <><b>{top.title}</b> brings {Math.round((top.revenue / productSales) * 100)}% of sales among your top products. Keep it in stock and feature it.</> });
  }
  if (t.orders && t.failedPayments / (t.orders + t.failedPayments) > 0.08) {
    out.push({ icon: "alert", text: <><b>{num(t.failedPayments)}</b> payments failed this period. A backup gateway catches payments when one fails.</>, to: base ? `${base}/settings` : undefined, cta: "Add gateway" });
  }
  if (tasks.toConfirm >= 5) out.push({ icon: "chat", text: <>{num(tasks.toConfirm)} COD customers haven't confirmed on WhatsApp. Call them before shipping to cut RTO.</> });
  return out.slice(0, 4);
}

function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel overflow-hidden ${className}`}>
      <div className="flex min-h-[44px] items-center justify-between gap-2 px-4 pt-1">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>{action}
      </div>
      {children}
    </section>
  );
}

const Row = ({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: boolean }) => (
  <div className={`flex items-center justify-between gap-3 px-4 py-1.5 text-[13px] ${sub ? "text-ink-soft" : ""}`}><dt className="min-w-0 truncate">{label}</dt><dd className="num shrink-0">{value}</dd></div>
);

export type HomeProps = {
  data: Data; tasks: HomeTasks; setup: SetupStep[] | null; leaders?: LeaderRow[];
  single: { id: number; name: string; base: string; storefront: boolean; liveUrl: string | null } | null;
  showStoreColumn: boolean;
};

export function HomeView({ data, tasks, setup, leaders, single, showStoreColumn }: HomeProps) {
  const t = data.totals;
  const hasAds = t.adSpend != null;
  const base = single?.base ?? null;
  const insights = insightsFor(data, tasks, base);
  const prepaidPct = t.orders ? Math.round((t.prepaidOrders / t.orders) * 100) : 0;

  return (
    <div className="space-y-4">
      {data.adErrors.length > 0 && <Notice tone="warning">Ad spend could not be loaded for {data.adErrors.map((e) => e.store).join(", ")}: {data.adErrors[0].error}</Notice>}

      <TodoChips tasks={tasks} links={{ toShip: base && single?.storefront ? `${base}/to-ship` : null, inventory: base && single?.storefront ? `${base}/inventory` : null }} />

      {setup && single && <SetupGuide steps={setup} name={single.name} base={single.base} />}

      <MetricsCard data={data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {insights.length > 0 && (
            <Panel title="Insights" action={<span className="flex items-center gap-1 text-[11.5px] text-ink-faint"><Icon name="sparkle" className="h-3.5 w-3.5" />From your numbers</span>}>
              <ul className="divide-y divide-rule border-t border-rule">
                {insights.map((x, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#eaf4ee] text-[#14785d]"><Icon name={x.icon} className="h-3.5 w-3.5" strokeWidth={2} /></span>
                    <p className="min-w-0 flex-1 text-[13px] leading-[1.45]">{x.text}</p>
                    {x.to && <Link to={x.to} className="btn-secondary btn shrink-0">{x.cta}</Link>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Recent orders" action={<Link to="/dashboard/orders" className="text-[12.5px] font-medium text-[#14785d] hover:underline">View all</Link>}>
            {data.recent.length === 0 ? (
              <p className="border-t border-rule px-4 py-8 text-center text-[13px] text-ink-faint">No orders in this period</p>
            ) : (
              <ul className="divide-y divide-rule border-t border-rule">
                {data.recent.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf4ee] text-[11px] font-semibold uppercase text-[#14785d]">{(o.name || "C").slice(0, 1)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{o.name || "Customer"}<span className="font-normal text-ink-faint"> · {o.city}</span></p>
                      <p className="truncate text-[11.5px] text-ink-faint">
                        {showStoreColumn && `${o.storeName} · `}
                        {new Date(o.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                        {" · "}{o.method === "prepaid" ? "Prepaid" : o.method === "partial" ? "Partial COD" : "COD"}
                      </p>
                    </div>
                    <StatusBadge status={o.status} />
                    <p className="num w-20 text-right text-[13px] font-medium">{inr(o.total)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {hasAds && <AdsVersus a={data.ads} />}
          {leaders && leaders.length > 1 && <Leaderboard rows={leaders} />}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Sales breakdown">
            <dl className="border-t border-rule py-1.5">
              <Row label="Total sales" value={<b>{inr(t.revenue)}</b>} />
              <Row label="Discounts" value={t.discounts ? `−${inr(t.discounts)}` : inr(0)} sub />
              <Row label="Refunds" value={t.refunded ? `−${inr(t.refunded)}` : inr(0)} sub />
              <Row label="Orders" value={num(t.orders)} sub />
              <Row label="Failed payments" value={num(t.failedPayments)} sub />
            </dl>
            <div className="border-t border-rule px-4 py-3">
              <div className="flex items-center justify-between text-[12px]"><span className="font-medium">Payment method</span><span className="num text-ink-faint">{num(t.orders)} orders</span></div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#ebebeb]" role="img" aria-label={`Prepaid ${prepaidPct}%, COD ${100 - prepaidPct}%`}>
                {t.orders > 0 && <><span className="bg-[#14785d]" style={{ width: `${prepaidPct}%` }} /><span className="bg-[#bd7048]" style={{ width: `${100 - prepaidPct}%` }} /></>}
              </div>
              <dl className="mt-2 space-y-1 text-[12.5px]">
                <div className="flex justify-between"><dt className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#14785d]" />Prepaid · {num(t.prepaidOrders)}</dt><dd className="num">{inr(t.prepaidRevenue)}</dd></div>
                <div className="flex justify-between"><dt className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#bd7048]" />COD · {num(t.codOrders)}</dt><dd className="num">{inr(t.codRevenue)}</dd></div>
              </dl>
            </div>
          </Panel>

          <Panel title="Marketing" action={base ? <Link to={`${base}/ads`} className="text-[12.5px] font-medium text-[#14785d] hover:underline">Open</Link> : undefined}>
            {hasAds ? (
              <dl className="border-t border-rule py-1.5">
                <Row label="Ad spend" value={inr(t.adSpend)} />
                {t.metaSpend != null && <Row label={<span className="flex items-center gap-1.5"><AdIcon p="meta" className="h-3 w-auto" />Meta</span>} value={inr(t.metaSpend)} sub />}
                {t.googleSpend != null && <Row label={<span className="flex items-center gap-1.5"><AdIcon p="google" className="h-3 w-auto" />Google</span>} value={inr(t.googleSpend)} sub />}
                <Row label="ROAS" value={t.roas == null ? "—" : `${t.roas.toFixed(2)}x`} />
                <Row label="Cost per order" value={<span className="inline-flex items-center gap-1.5">{inr(t.costPerOrder)}<CostTag value={t.costPerOrder} /></span>} />
              </dl>
            ) : (
              <div className="border-t border-rule px-4 py-3">
                <p className="text-[12.5px] text-ink-soft">Connect Meta or Google Ads to see spend, ROAS and cost per order next to your sales.</p>
                {base && <Link to={`${base}/ads`} className="btn-secondary btn mt-2 inline-flex">Connect ads</Link>}
              </div>
            )}
          </Panel>

          <Panel title="Top products" action={base && single?.storefront ? <Link to={`${base}/catalog`} className="text-[12.5px] font-medium text-[#14785d] hover:underline">Products</Link> : undefined}>
            {data.topProducts.length === 0 ? (
              <p className="border-t border-rule px-4 py-6 text-center text-[12.5px] text-ink-faint">No sales in this period</p>
            ) : (
              <ul className="divide-y divide-rule border-t border-rule">
                {data.topProducts.map((p) => (
                  <li key={p.title} className="flex items-center gap-2.5 px-4 py-2">
                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-[#eaf4ee] shadow-[inset_0_0_0_1px_rgba(20,70,48,.08)]">
                      {p.image && <img src={p.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{p.title}</p>
                      <p className="num text-[11.5px] text-ink-faint">{num(p.quantity)} sold</p>
                    </div>
                    <p className="num text-[12.5px] font-medium">{inr(p.revenue)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

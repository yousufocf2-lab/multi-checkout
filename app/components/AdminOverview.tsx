// Super admin home: Growpefy's own ads, leads and demos, orders across client stores, and client onboarding.
import { Link } from "@remix-run/react";
import { RevenueChart, type ChartBucket } from "~/components/charts";
import { Icon } from "~/components/Icons";
import { SourceTagChip, StatusChip } from "~/components/LeadChips";
import { RangePicker } from "~/components/Overview";
import { StoreFilter } from "~/components/StoreFilter";
import { AdIcon } from "~/components/AdLogos";
import { demoLabel, KIND_LABEL, type LeadKind, type SourceTag } from "~/lib/leads";

const inr = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const num = (v: number) => v.toLocaleString("en-IN");
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
function change(now: number, before: number) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return <span className={`num text-[11px] font-semibold ${pct >= 0 ? "text-good" : "text-bad"}`}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%</span>;
}

type AdCard = { connected: boolean; error: string | null; spend: number; leads: number; cpl: number | null; clicks: number; active: number; campaigns: number };
export type AdminData = {
  greeting: string; who: string;
  range: { preset: string; since: string; until: string };
  ads: {
    meta: AdCard; google: AdCard; spend: number; leads: number; cpl: number | null;
    top: { id: string; p: "meta" | "google"; name: string; status: string; spend: number; leads: number; cpl: number | null }[];
    daily: { label: string; spend: number; leads: number }[];
    balance: number | null; monthRecharged: number; monthRecharges: number;
  } | null;
  leads: {
    inRange: number; today: number; toCall: number; demos: number; customers: number;
    recent: { key: string; kind: LeadKind; name: string; phone: string | null; source: SourceTag; status: string; detail: string; createdAt: string }[];
    upcoming: { key: string; name: string; demoAt: string }[];
  } | null;
  orders: {
    totals: { orders: number; revenue: number; aov: number; prepaidShare: number | null; activeStores: number };
    previous: { orders: number; revenue: number };
    stores: { id: number; name: string; orders: number; revenue: number; prepaidShare: number | null }[];
    series: ChartBucket[];
    allStores: { id: number; name: string }[];
    picked: number[];
  } | null;
  clients: { funnel: { id: string; label: string; n: number }[]; recent: { id: number; name: string; next: string | null; reached: number; createdAt: string; urgency: string | null }[] } | null;
};

export function AdminOverview({ d }: { d: AdminData }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">{d.greeting}, {d.who} <span aria-hidden>👋</span></p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Overview</h1>
        </div>
        <RangePicker current={d.range as never} align="right" />
      </div>

      {!d.ads && !d.leads && !d.orders && !d.clients && (
        <div className="panel px-6 py-10 text-center text-sm text-ink-soft">Welcome. Use the menu to open the sections you have access to.</div>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d.ads && <Tile label="Ad spend (Growpefy)" value={inr(d.ads.spend)} note={`${num(d.ads.leads)} leads from ads · ${d.ads.cpl ? `${inr(d.ads.cpl)} per lead` : "no leads yet"}`} />}
        {d.leads && <Tile label="New leads" value={num(d.leads.inRange)} note={`${d.leads.today} today · ${d.leads.toCall} to call`} />}
        {d.orders && <Tile label="Revenue, all stores" value={inr(d.orders.totals.revenue)} note={<>{change(d.orders.totals.revenue, d.orders.previous.revenue)} vs previous period</>} />}
        {d.orders && <Tile label="Orders, all stores" value={num(d.orders.totals.orders)} note={<>{change(d.orders.totals.orders, d.orders.previous.orders)} {d.orders.totals.activeStores} stores with orders</>} />}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {d.ads && (
          <section className="panel p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Your ads</h2>
              <Link to="/dashboard/marketing" className="text-xs font-medium text-pine hover:underline">Full report →</Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <AdStatus name="Meta" to="/dashboard/marketing/meta" logo={<AdIcon p="meta" className="h-5 w-auto" />} a={d.ads.meta} />
              <AdStatus name="Google" to="/dashboard/marketing/google" logo={<AdIcon p="google" className="h-5 w-auto" />} a={d.ads.google} />
            </div>

            {d.ads.meta.connected && (
              <Link to="/dashboard/marketing/meta" className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule text-sm">
                <span className="bg-surface px-4 py-2.5"><span className="block text-[11px] text-ink-soft">Meta balance</span><b className={`num ${d.ads.balance != null && d.ads.balance < 500 ? "text-bad" : ""}`}>{inr(d.ads.balance, 2)}</b></span>
                <span className="bg-surface px-4 py-2.5"><span className="block text-[11px] text-ink-soft">Recharged this month</span><b className="num">{inr(d.ads.monthRecharged)}</b><span className="text-[11px] text-ink-faint"> · {d.ads.monthRecharges} time{d.ads.monthRecharges === 1 ? "" : "s"}</span></span>
              </Link>
            )}

            {d.ads.daily.some((x) => x.spend > 0 || x.leads > 0) && <SpendBars days={d.ads.daily} />}

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Top campaigns</p>
              {d.ads.top.length === 0 ? <p className="mt-2 text-sm text-ink-faint">No campaign spend in this period.</p> : (
                <ul className="mt-2 divide-y divide-rule">
                  {d.ads.top.map((c) => (
                    <li key={c.id}>
                      <Link to={`/dashboard/marketing/${c.p}`} className="flex items-center gap-2.5 py-2 text-sm hover:bg-paper">
                        <AdIcon p={c.p} className="h-4 w-auto shrink-0" />
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={c.name}>{c.name}</span><span className="block text-[11px] text-ink-faint">{c.status || "—"}</span></span>
                        <span className="num w-16 text-right text-xs"><b className="block text-sm">{num(c.leads)}</b>leads</span>
                        <span className="num w-20 text-right text-xs"><b className="block text-sm">{inr(c.cpl)}</b>per lead</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {d.leads && (
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 pt-5">
              <h2 className="text-sm font-semibold">Leads</h2>
              <Link to="/dashboard/leads" className="text-xs font-medium text-pine hover:underline">All leads →</Link>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 px-5">
              <Mini label="To call" value={d.leads.toCall} to="/dashboard/leads" />
              <Mini label="Demos booked" value={d.leads.demos} to="/dashboard/leads?tab=all&st=demo_scheduled" />
              <Mini label="Customers" value={d.leads.customers} to="/dashboard/leads?tab=done&st=customer" />
            </div>
            {d.leads.upcoming.length > 0 && (
              <div className="mx-5 mt-3 rounded-lg bg-[#FFF7CC] px-3 py-2 text-xs">
                <b className="font-semibold">Next demos:</b>{" "}
                {d.leads.upcoming.map((u, i) => <Link key={u.key} to={`/dashboard/leads/${u.key}`} className="hover:underline">{i ? " · " : ""}{u.name}, {demoLabel(u.demoAt)}</Link>)}
              </div>
            )}
            <ul className="mt-3 divide-y divide-rule border-t border-rule">
              {d.leads.recent.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-faint">No leads yet.</li>}
              {d.leads.recent.map((l) => (
                <li key={l.key}>
                  <Link to={`/dashboard/leads/${l.key}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{l.name}<SourceTagChip s={l.source} /></p>
                      <p className="truncate text-xs text-ink-soft">{KIND_LABEL[l.kind]}{l.detail ? ` · ${l.detail}` : ""}</p>
                    </div>
                    <StatusChip s={l.status} />
                    <span className="w-14 text-right text-[11px] text-ink-faint">{ago(l.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {d.orders && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Orders and revenue across client stores</h2>
              <p className="text-xs text-ink-soft">
                {inr(d.orders.totals.aov)} average order{d.orders.totals.prepaidShare != null ? ` · ${d.orders.totals.prepaidShare}% prepaid` : ""}
              </p>
            </div>
            {d.orders.allStores.length > 1 && <StoreFilter stores={d.orders.allStores} selected={d.orders.picked} />}
          </div>
          <div className="mt-4"><RevenueChart buckets={d.orders.series} showAds={false} /></div>
          {d.orders.stores.length > 1 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-rule text-left text-xs text-ink-soft">
                  <th className="py-2 font-medium">Store</th><th className="py-2 text-right font-medium">Orders</th><th className="py-2 text-right font-medium">Revenue</th><th className="hidden py-2 text-right font-medium sm:table-cell">Prepaid</th>
                </tr></thead>
                <tbody className="num">
                  {d.orders.stores.slice(0, 8).map((s) => (
                    <tr key={s.id} className="border-b border-rule last:border-0">
                      <td className="py-2 font-sans">{s.name}</td>
                      <td className="py-2 text-right">{num(s.orders)}</td>
                      <td className="py-2 text-right">{inr(s.revenue)}</td>
                      <td className="hidden py-2 text-right sm:table-cell">{s.prepaidShare == null ? "—" : `${s.prepaidShare}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {d.clients && (
        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Client onboarding</h2>
            <Link to="/dashboard/clients" className="text-xs font-medium text-pine hover:underline">All clients →</Link>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {d.clients.funnel.map((f, i) => {
              const top = d.clients!.funnel[0].n || 1;
              return (
                <div key={f.id} className="rounded-lg bg-paper px-2.5 py-2">
                  <p className="text-[11px] text-ink-soft">{i + 1}. {f.label}</p>
                  <p className="num text-lg font-semibold">{f.n}</p>
                  <div className="mt-1 h-1 overflow-hidden rounded bg-paper-sunk"><div className="h-full rounded bg-pine" style={{ width: `${Math.round((f.n / top) * 100)}%` }} /></div>
                </div>
              );
            })}
          </div>
          {d.clients.recent.length > 0 && (
            <ul className="mt-4 divide-y divide-rule border-t border-rule">
              {d.clients.recent.map((c) => (
                <li key={c.id}>
                  <Link to={`/dashboard/leads/signup-${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm hover:bg-paper">
                    <span className="min-w-0 flex-1 font-medium">{c.name}</span>
                    <Steps reached={c.reached} />
                    <span className="w-full text-xs text-ink-soft sm:w-56 sm:text-right">{c.next ? <>Next: <b className="font-medium text-ink">{c.next}</b></> : "Fully onboarded"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className="num mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-faint">{note}</p>
    </div>
  );
}

function Mini({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className="rounded-lg bg-paper px-3 py-2 hover:bg-paper-sunk">
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="num text-lg font-semibold">{value}</p>
    </Link>
  );
}

function AdStatus({ name, logo, a, to }: { name: string; logo: React.ReactNode; a: AdCard; to: string }) {
  const state = !a.connected ? { t: "Not connected", c: "bg-paper-sunk text-ink-soft" }
    : a.error ? { t: "Error", c: "bg-red-50 text-bad" }
    : a.active > 0 ? { t: `${a.active} running`, c: "bg-emerald-50 text-good" }
    : { t: "Nothing running", c: "bg-amber-50 text-amber-800" };
  return (
    <div className="rounded-xl border border-rule p-4">
      <div className="flex items-center gap-2">
        {logo}<span className="text-sm font-semibold">{name}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${state.c}`}>{state.t}</span>
      </div>
      {!a.connected ? (
        <p className="mt-3 text-xs text-ink-soft">Connect it in <Link to="/dashboard/marketing" className="font-medium text-pine hover:underline">Marketing</Link> to see spend and leads here.</p>
      ) : a.error ? (
        <p className="mt-3 line-clamp-2 text-xs text-bad">{a.error}</p>
      ) : (
        <dl className="num mt-3 grid grid-cols-3 gap-2 text-center">
          <div><dt className="text-[11px] text-ink-soft">Spent</dt><dd className="text-sm font-semibold">{inr(a.spend)}</dd></div>
          <div><dt className="text-[11px] text-ink-soft">Leads</dt><dd className="text-sm font-semibold">{num(a.leads)}</dd></div>
          <div><dt className="text-[11px] text-ink-soft">Per lead</dt><dd className="text-sm font-semibold">{inr(a.cpl)}</dd></div>
        </dl>
      )}
      {a.connected && <Link to={to} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-pine hover:underline">Open {name} report <Icon name="arrow" className="h-3 w-3" /></Link>}
    </div>
  );
}

/** Last 14 days: spend bars with the leads count on top. */
function SpendBars({ days }: { days: { label: string; spend: number; leads: number }[] }) {
  const max = Math.max(1, ...days.map((x) => x.spend));
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Spend and leads by day</p>
        <p className="text-[11px] text-ink-faint">bar = spend · number = leads</p>
      </div>
      <div className="mt-2 flex h-24 items-end gap-1">
        {days.map((x) => (
          <div key={x.label} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${x.label}: ${inr(x.spend)} · ${x.leads} leads`}>
            {x.leads > 0 && <span className="num mb-0.5 text-[10px] font-semibold text-pine">{Math.round(x.leads)}</span>}
            <div className="w-full rounded-t bg-gradient-to-t from-pine to-emerald-400 opacity-80 transition group-hover:opacity-100" style={{ height: `${Math.max(3, (x.spend / max) * 72)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Steps({ reached, total = 7 }: { reached: number; total?: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Step ${reached + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 w-4 rounded-full ${i <= reached ? "bg-pine" : "bg-paper-sunk"}`} />
      ))}
    </span>
  );
}

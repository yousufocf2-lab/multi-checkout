// Team performance: every calling team member's work and results in one place. All members side by side
// (leaderboard, daily activity, comparison table), or one member in detail (each calling job with its outcomes).
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import { Icon } from "~/components/Icons";
import { Donut } from "~/components/OfdCalls";
import { RangePicker } from "~/components/Overview";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, rangeLabel, resolveRange } from "~/lib/dates";
import { formatINR as inr } from "~/lib/pricing";
import { teamReport, type MemberStats } from "~/lib/team-report.server";

export const meta: MetaFunction = () => [{ title: "Team performance · Growpefy" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const sp = new URL(request.url).searchParams;
  if (!sp.get("range")) sp.set("range", "today");
  const range = resolveRange(sp, store.createdAt.toISOString().slice(0, 10));
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const report = await teamReport(store, from, to);
  return json({ range, rangeText: rangeLabel(range), ...report });
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
const KINDS = [
  { id: "confirm", label: "Order confirmation", color: "#2a78d6" },
  { id: "abandoned", label: "Abandoned checkouts", color: "#eb6834" },
  { id: "ofd", label: "Out for delivery", color: "#1baf7a" },
] as const;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const num = (v: number) => v.toLocaleString("en-IN");
const ROLE: Record<string, string> = { confirm: "Confirmation", abandoned_calls: "Abandoned", ofd_calls: "Out for delivery" };
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const AVATAR = ["#dbeafe", "#ffe4d5", "#d1fadf", "#fef0c7", "#fce7f6", "#e0e7ff"];

export default function TeamReport() {
  const d = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const selectedId = Number(sp.get("member")) || null;
  const selected = d.members.find((m) => m.id === selectedId) ?? null;
  const link = (id: number | null) => { const p = new URLSearchParams(sp); if (id) p.set("member", String(id)); else p.delete("member"); return `?${p}`; };
  const totals = useMemo(() => sum(d.members), [d.members]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Icon name="users" className="h-5 w-5 text-ink-soft" />Team performance</h1>
          <p className="text-[13px] text-ink-soft">Calls, outcomes and the revenue they brought in · {d.rangeText}</p>
        </div>
        <RangePicker current={d.range} align="right" />
      </header>

      {d.members.length === 0 ? (
        <section className="panel flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pine-tint text-pine"><Icon name="users" className="h-6 w-6" /></span>
          <p className="mt-3 text-[15px] font-semibold">No calling team yet</p>
          <p className="mt-1 max-w-md text-[13px] text-ink-soft">Give team members a calling permission (order confirmation, abandoned checkouts or out for delivery). Their work shows up here.</p>
          <Link to="/dashboard/team" className="btn-primary mt-4">Add a team member</Link>
        </section>
      ) : (<>
        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Team member">
          <Chip to={link(null)} active={!selected} label="Whole team" sub={`${d.members.length} member${d.members.length === 1 ? "" : "s"}`} />
          {d.members.map((m, i) => <Chip key={m.id} to={link(m.id)} active={selected?.id === m.id} label={m.name} sub={`${num(m.actions)} activities`} avatar={{ text: initials(m.name), bg: AVATAR[i % AVATAR.length] }} />)}
        </nav>

        <Kpis s={selected ?? totals} />

        {selected ? <MemberDetail m={selected} daily={d.daily.filter((x) => x.member === selected.id)} range={d.range} /> : (<>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <Leaderboard members={d.members} link={link} />
            <RevenueBoard members={d.members} link={link} />
          </div>
          <Trend daily={d.daily} range={d.range} title="Daily activity · whole team" />
          <Comparison members={d.members} link={link} />
        </>)}
      </>)}
    </div>
  );
}

function sum(list: MemberStats[]): MemberStats {
  const z: MemberStats = {
    id: 0, name: "Whole team", roles: [],
    confirm: { assigned: 0, attempts: 0, skipped: 0, confirmed: 0, cancelled: 0, followUp: 0, delivered: 0, rto: 0, revenue: 0, avgMins: null },
    abandoned: { assigned: 0, converted: 0, lost: 0, followUp: 0, revenue: 0, delivered: 0, deliveredRevenue: 0 },
    ofd: { calls: 0, parcels: 0, ready: 0, followUp: 0, denied: 0, delivered: 0, rto: 0, revenue: 0 },
    actions: 0, deliveredRevenue: 0, deliveredOrders: 0,
  };
  let minsW = 0, minsN = 0;
  for (const m of list) {
    for (const k of Object.keys(z.confirm) as (keyof MemberStats["confirm"])[]) if (k !== "avgMins") (z.confirm[k] as number) += m.confirm[k] as number;
    for (const k of Object.keys(z.abandoned) as (keyof MemberStats["abandoned"])[]) z.abandoned[k] += m.abandoned[k];
    for (const k of Object.keys(z.ofd) as (keyof MemberStats["ofd"])[]) z.ofd[k] += m.ofd[k];
    z.actions += m.actions; z.deliveredRevenue += m.deliveredRevenue; z.deliveredOrders += m.deliveredOrders;
    const done = m.confirm.confirmed + m.confirm.cancelled;
    if (m.confirm.avgMins != null && done) { minsW += m.confirm.avgMins * done; minsN += done; }
  }
  z.confirm.avgMins = minsN ? minsW / minsN : null;
  return z;
}

function Chip({ to, active, label, sub, avatar }: { to: string; active: boolean; label: string; sub: string; avatar?: { text: string; bg: string } }) {
  return (
    <Link to={to} preventScrollReset aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 transition ${active ? "bg-[#101828] text-white shadow-sm" : "bg-white text-ink shadow-[inset_0_0_0_1px_#e4e7ec] hover:bg-[#f9fafb]"}`}>
      {avatar ? <span className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold text-[#344054]" style={{ background: avatar.bg }}>{avatar.text}</span>
        : <span className={`flex h-8 w-8 items-center justify-center rounded-full ${active ? "bg-white/15" : "bg-[#f2f4f7]"}`}><Icon name="users" className="h-4 w-4" /></span>}
      <span className="leading-tight"><span className="block text-[13px] font-semibold">{label}</span><span className={`block text-[11.5px] ${active ? "text-white/70" : "text-ink-faint"}`}>{sub}</span></span>
    </Link>
  );
}

function Kpis({ s }: { s: MemberStats }) {
  const decided = s.confirm.confirmed + s.confirm.cancelled;
  const abDone = s.abandoned.converted + s.abandoned.lost;
  const ofdDone = s.ofd.delivered + s.ofd.rto;
  const cards = [
    { label: "Activities", value: num(s.actions), sub: `${num(s.confirm.attempts)} call attempts logged`, icon: "phone" as const },
    { label: "Orders confirmed", value: num(s.confirm.confirmed), sub: decided ? `${pct(s.confirm.confirmed, decided)}% confirm rate` : "No calls yet", icon: "check" as const },
    { label: "Checkouts recovered", value: num(s.abandoned.converted), sub: s.abandoned.converted ? `${inr(s.abandoned.revenue)} in orders${abDone ? ` · ${pct(s.abandoned.converted, abDone)}% win` : ""}` : "None yet", icon: "cart" as const },
    { label: "Delivery calls", value: num(s.ofd.parcels), sub: ofdDone ? `${pct(s.ofd.delivered, ofdDone)}% of these delivered` : "No parcels yet", icon: "shipping" as const },
    { label: "Delivered revenue", value: inr(s.deliveredRevenue), sub: `${num(s.deliveredOrders)} delivered orders they worked on`, icon: "rupee" as const, strong: true },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-2xl p-4 ${c.strong ? "bg-[linear-gradient(135deg,#0E1714_0%,#0B5D4B_70%,#138a6e_100%)] text-white shadow-lift" : "panel"}`}>
          <p className={`flex items-center gap-1.5 text-[12px] font-medium ${c.strong ? "text-white/75" : "text-ink-soft"}`}><Icon name={c.icon} className="h-3.5 w-3.5" />{c.label}</p>
          <p className="num mt-1.5 text-[24px] font-semibold leading-none tracking-tight">{c.value}</p>
          <p className={`mt-1.5 truncate text-[11.5px] ${c.strong ? "text-white/70" : "text-ink-faint"}`} title={c.sub}>{c.sub}</p>
        </div>
      ))}
    </section>
  );
}

function Legend() {
  return <div className="flex flex-wrap gap-x-4 gap-y-1">{KINDS.map((k) => <span key={k.id} className="flex items-center gap-1.5 text-[11.5px] text-ink-soft"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: k.color }} />{k.label}</span>)}</div>;
}

const workOf = (m: MemberStats) => ({
  confirm: m.confirm.confirmed + m.confirm.cancelled + m.confirm.followUp,
  abandoned: m.abandoned.converted + m.abandoned.lost + m.abandoned.followUp,
  ofd: m.ofd.parcels,
});

/** Who handled the most: outcomes recorded per member, split by calling job. */
function Leaderboard({ members, link }: { members: MemberStats[]; link: (id: number) => string }) {
  const rows = members.map((m) => ({ m, w: workOf(m) })).map((r) => ({ ...r, total: r.w.confirm + r.w.abandoned + r.w.ofd })).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h2 className="text-[15px] font-semibold">Work done</h2><p className="text-[12px] text-ink-faint">Customers handled (an outcome recorded on the call)</p></div>
        <Legend />
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <li key={r.m.id}>
            <Link to={link(r.m.id)} preventScrollReset className="group block">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex items-center gap-2 font-medium"><span className="num w-4 text-[11.5px] text-ink-faint">{i + 1}</span>{r.m.name}</span>
                <span className="num font-semibold">{num(r.total)}</span>
              </div>
              <div className="mt-1.5 flex h-3 gap-[2px] overflow-hidden rounded-[4px] bg-[#f2f4f7]" style={{ width: "100%" }}>
                {KINDS.map((k) => { const v = r.w[k.id]; return v ? <span key={k.id} className="h-full transition-opacity group-hover:opacity-85" style={{ width: `${(v / max) * 100}%`, background: k.color }} title={`${k.label}: ${v}`} /> : null; })}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Delivered revenue per member: the money that actually came in from orders they worked on. */
function RevenueBoard({ members, link }: { members: MemberStats[]; link: (id: number) => string }) {
  const rows = [...members].sort((a, b) => b.deliveredRevenue - a.deliveredRevenue);
  const max = Math.max(1, ...rows.map((r) => r.deliveredRevenue));
  const total = rows.reduce((a, r) => a + r.deliveredRevenue, 0);
  return (
    <section className="panel p-5">
      <h2 className="text-[15px] font-semibold">Delivered revenue</h2>
      <p className="text-[12px] text-ink-faint">Orders they confirmed, recovered or called on delivery day that were delivered</p>
      <ul className="mt-4 space-y-3">
        {rows.map((m) => (
          <li key={m.id}>
            <Link to={link(m.id)} preventScrollReset className="block">
              <div className="flex items-center justify-between gap-2 text-[13px]"><span className="font-medium">{m.name}</span><span className="num font-semibold">{inr(m.deliveredRevenue)} <span className="text-[11.5px] font-normal text-ink-faint">{pct(m.deliveredRevenue, total)}%</span></span></div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-[4px] bg-[#f2f4f7]"><div className="h-full rounded-[4px] bg-[#0B5D4B]" style={{ width: `${(m.deliveredRevenue / max) * 100}%` }} /></div>
              <p className="mt-1 text-[11.5px] text-ink-faint">{num(m.deliveredOrders)} delivered orders</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function daysOf(range: { since: string; until: string }) {
  const out: string[] = [];
  let d = range.since;
  while (d <= range.until && out.length < 400) { out.push(d); d = addDays(d, 1); }
  return out;
}

/** Stacked columns per day (per month when the period is long), split by calling job, with hover values. */
function Trend({ daily, range, title }: { daily: D["daily"]; range: D["range"]; title: string }) {
  const days = daysOf(range);
  const monthly = days.length > 62;
  const keys = monthly ? [...new Set(days.map((x) => x.slice(0, 7)))] : days;
  const map = new Map<string, Record<string, number>>();
  for (const r of daily) { const k = monthly ? r.day.slice(0, 7) : r.day; const x = map.get(k) ?? {}; x[r.kind] = (x[r.kind] ?? 0) + r.n; map.set(k, x); }
  const totals = keys.map((k) => KINDS.reduce((a, c) => a + (map.get(k)?.[c.id] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const nice = Math.ceil(max / 5) * 5 || 5;
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, L = 34, B = 24, T = 10;
  const bw = (W - L) / keys.length;
  const label = (k: string) => monthly ? new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : new Date(`${k}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const every = Math.max(1, Math.ceil(keys.length / 10));
  const h = hover != null ? keys[hover] : null;
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h2 className="text-[15px] font-semibold">{title}</h2><p className="text-[12px] text-ink-faint">Calls and outcomes per {monthly ? "month" : "day"}</p></div>
        <Legend />
      </div>
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[230px] w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => { const y = T + (H - T - B) * (1 - f); return <g key={f}><line x1={L} x2={W} y1={y} y2={y} stroke="#eaecf0" strokeWidth="1" /><text x={L - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill="#98a2b3">{Math.round(nice * f)}</text></g>; })}
          {keys.map((k, i) => {
            let y = H - B;
            const x = L + i * bw + Math.min(6, bw * 0.18);
            const w = Math.max(2, bw - Math.min(12, bw * 0.36));
            const segs = KINDS.map((c) => ({ c, v: map.get(k)?.[c.id] ?? 0 })).filter((s) => s.v);
            return (
              <g key={k} onMouseEnter={() => setHover(i)}>
                <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill={hover === i ? "#f2f4f7" : "transparent"} />
                {segs.map((s, j) => {
                  const hh = ((H - T - B) * s.v) / nice;
                  y -= hh;
                  const top = j === segs.length - 1;
                  return <rect key={s.c.id} x={x} y={y + (j ? 0 : 0)} width={w} height={Math.max(0, hh - (j < segs.length - 1 ? 1.5 : 0))} rx={top ? Math.min(4, w / 2) : 0} fill={s.c.color} />;
                })}
                {i % every === 0 && <text x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#98a2b3">{label(k)}</text>}
              </g>
            );
          })}
        </svg>
        {h != null && (
          <div className="pointer-events-none absolute top-0 z-10 min-w-[170px] rounded-lg bg-[#101828] px-3 py-2 text-[12px] text-white shadow-lg" style={{ left: `clamp(0px, calc(${((L + hover! * bw + bw / 2) / W) * 100}% - 85px), calc(100% - 170px))` }}>
            <p className="font-semibold">{label(h)}</p>
            {KINDS.map((c) => <p key={c.id} className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-white/80"><span className="h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.label}</span><span className="num">{map.get(h)?.[c.id] ?? 0}</span></p>)}
            <p className="mt-1 flex justify-between border-t border-white/15 pt-1 font-semibold"><span>Total</span><span className="num">{totals[hover!]}</span></p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Every number for every member, side by side. */
function Comparison({ members, link }: { members: MemberStats[]; link: (id: number) => string }) {
  const cols: { key: string; label: string; get: (m: MemberStats) => number; fmt?: (v: number) => string; group: string }[] = [
    { key: "act", label: "Activities", get: (m) => m.actions, group: "" },
    { key: "att", label: "Call attempts", get: (m) => m.confirm.attempts, group: "Confirmation" },
    { key: "conf", label: "Confirmed", get: (m) => m.confirm.confirmed, group: "Confirmation" },
    { key: "canc", label: "Cancelled", get: (m) => m.confirm.cancelled, group: "Confirmation" },
    { key: "rate", label: "Confirm %", get: (m) => pct(m.confirm.confirmed, m.confirm.confirmed + m.confirm.cancelled), fmt: (v) => `${v}%`, group: "Confirmation" },
    { key: "cdel", label: "Delivered", get: (m) => m.confirm.delivered, group: "Confirmation" },
    { key: "crto", label: "RTO", get: (m) => m.confirm.rto, group: "Confirmation" },
    { key: "rec", label: "Recovered", get: (m) => m.abandoned.converted, group: "Abandoned" },
    { key: "recv", label: "Order value", get: (m) => m.abandoned.revenue, fmt: inr, group: "Abandoned" },
    { key: "ofd", label: "Parcels called", get: (m) => m.ofd.parcels, group: "Out for delivery" },
    { key: "ready", label: "Ready", get: (m) => m.ofd.ready, group: "Out for delivery" },
    { key: "denied", label: "Denied", get: (m) => m.ofd.denied, group: "Out for delivery" },
    { key: "odel", label: "Delivered", get: (m) => m.ofd.delivered, group: "Out for delivery" },
    { key: "rev", label: "Delivered revenue", get: (m) => m.deliveredRevenue, fmt: inr, group: "" },
  ];
  const [sort, setSort] = useState("rev");
  const col = cols.find((c) => c.key === sort) ?? cols[0];
  const rows = [...members].sort((a, b) => col.get(b) - col.get(a));
  return (
    <section className="panel overflow-hidden p-0">
      <div className="px-5 pb-2 pt-4"><h2 className="text-[15px] font-semibold">All members</h2><p className="text-[12px] text-ink-faint">Click a column to sort · click a name for details</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[13px]">
          <thead>
            <tr className="border-y border-rule bg-[#fafafa] text-left text-[11px] text-ink-faint">
              <th className="sticky left-0 bg-[#fafafa] px-5 py-1.5 font-medium" />
              {cols.map((c) => <th key={c.key} className="px-3 py-1.5 text-right font-medium">{c.group}</th>)}
            </tr>
            <tr className="border-b border-rule text-left text-[11.5px] text-ink-soft">
              <th className="sticky left-0 bg-surface px-5 py-2 font-medium">Member</th>
              {cols.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium"><button type="button" onClick={() => setSort(c.key)} className={`whitespace-nowrap ${sort === c.key ? "font-semibold text-ink" : "hover:text-ink"}`}>{c.label}{sort === c.key ? " ↓" : ""}</button></th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-[#fafafa]">
                <td className="sticky left-0 bg-surface px-5 py-2.5"><Link to={link(m.id)} preventScrollReset className="font-semibold hover:underline">{m.name}</Link><span className="block text-[11px] text-ink-faint">{m.roles.map((r) => ROLE[r] ?? r).join(" · ")}</span></td>
                {cols.map((c) => <td key={c.key} className={`num px-3 text-right ${c.key === sort ? "font-semibold" : ""}`}>{c.fmt ? c.fmt(c.get(m)) : num(c.get(m))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One member: each calling job with what happened to those customers. */
function MemberDetail({ m, daily, range }: { m: MemberStats; daily: D["daily"]; range: D["range"] }) {
  const c = m.confirm, a = m.abandoned, o = m.ofd;
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        <JobCard title="Order confirmation" color={KINDS[0].color} empty={!(c.confirmed + c.cancelled + c.followUp + c.attempts)}
          donut={[{ label: "Confirmed", n: c.confirmed, color: "#12b76a" }, { label: "Follow-up", n: c.followUp, color: "#6172f3" }, { label: "Cancelled", n: c.cancelled, color: "#f04438" }]}
          center={`${pct(c.confirmed, c.confirmed + c.cancelled)}%`} centerSub="confirmed"
          facts={[
            ["Orders given", num(c.assigned)], ["Call attempts", num(c.attempts)], ["Skipped", num(c.skipped)],
            ["Avg time to decide", c.avgMins == null ? "—" : c.avgMins < 60 ? `${Math.round(c.avgMins)} min` : `${(c.avgMins / 60).toFixed(1)} h`],
          ]}
          outcome={{ label: "Confirmed orders", delivered: c.delivered, rto: c.rto, total: c.confirmed, revenue: c.revenue }} />
        <JobCard title="Abandoned checkouts" color={KINDS[1].color} empty={!(a.converted + a.lost + a.followUp + a.assigned)}
          donut={[{ label: "Ordered", n: a.converted, color: "#12b76a" }, { label: "Follow-up", n: a.followUp, color: "#6172f3" }, { label: "Not interested", n: a.lost, color: "#f04438" }]}
          center={`${pct(a.converted, a.converted + a.lost)}%`} centerSub="won"
          facts={[["Checkouts given", num(a.assigned)], ["Order value", inr(a.revenue)]]}
          outcome={{ label: "Recovered orders", delivered: a.delivered, rto: 0, total: a.converted, revenue: a.deliveredRevenue }} />
        <JobCard title="Out for delivery" color={KINDS[2].color} empty={!o.parcels}
          donut={[{ label: "Ready", n: o.ready, color: "#12b76a" }, { label: "Follow-up", n: o.followUp, color: "#6172f3" }, { label: "Denied", n: o.denied, color: "#f04438" }]}
          center={num(o.parcels)} centerSub="parcels"
          facts={[["Calls made", num(o.calls)], ["Ready", num(o.ready)], ["Denied", num(o.denied)]]}
          outcome={{ label: "Parcels called", delivered: o.delivered, rto: o.rto, total: o.parcels, revenue: o.revenue }} />
      </div>
      <Trend daily={daily} range={range} title={`Daily activity · ${m.name}`} />
    </>
  );
}

function JobCard({ title, color, donut, center, centerSub, facts, outcome, empty }: {
  title: string; color: string; donut: { label: string; n: number; color: string }[]; center: string; centerSub: string;
  facts: [string, string][]; outcome: { label: string; delivered: number; rto: number; total: number; revenue: number }; empty: boolean;
}) {
  const open = Math.max(0, outcome.total - outcome.delivered - outcome.rto);
  return (
    <section className="panel flex flex-col p-5">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{title}</h2>
      {empty ? <p className="mt-6 flex-1 text-center text-[12.5px] text-ink-faint">No work in this period.</p> : (<>
        <div className="mt-4 flex items-center gap-4">
          <Donut parts={donut} center={center} sub={centerSub} size={112} />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {donut.map((p) => <li key={p.label} className="flex items-center gap-2 text-[12.5px]"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} /><span className="flex-1 text-ink-soft">{p.label}</span><span className="num font-semibold">{num(p.n)}</span></li>)}
          </ul>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2">
          {facts.map(([k, v]) => <div key={k} className="rounded-lg bg-[#f9fafb] px-3 py-2"><dt className="text-[11px] text-ink-faint">{k}</dt><dd className="num text-[14px] font-semibold">{v}</dd></div>)}
        </dl>
        <div className="mt-4 border-t border-rule pt-3">
          <p className="flex justify-between text-[12px] text-ink-soft"><span>{outcome.label}: what happened</span><span className="num font-semibold text-ink">{inr(outcome.revenue)}</span></p>
          <div className="mt-2 flex h-2.5 gap-[2px] overflow-hidden rounded-[4px] bg-[#f2f4f7]">
            {outcome.total > 0 && <>
              {outcome.delivered > 0 && <span style={{ width: `${(outcome.delivered / outcome.total) * 100}%`, background: "#12b76a" }} title={`Delivered ${outcome.delivered}`} />}
              {outcome.rto > 0 && <span style={{ width: `${(outcome.rto / outcome.total) * 100}%`, background: "#f04438" }} title={`RTO ${outcome.rto}`} />}
              {open > 0 && <span style={{ width: `${(open / outcome.total) * 100}%`, background: "#d0d5dd" }} title={`On the way / not shipped ${open}`} />}
            </>}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-soft">
            <span><b className="num text-[#067647]">{num(outcome.delivered)}</b> delivered</span>
            {outcome.rto > 0 && <span><b className="num text-[#b42318]">{num(outcome.rto)}</b> RTO</span>}
            <span><b className="num">{num(open)}</b> open</span>
          </p>
        </div>
      </>)}
    </section>
  );
}

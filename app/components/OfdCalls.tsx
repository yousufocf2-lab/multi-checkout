// Out for delivery calling (inside Order confirmation): call the customer on delivery day and mark them Ready,
// Follow-up or Denied. Failed deliveries (NDR) can be sent for a re-attempt one by one or all at once.
// The charts show what happened next: of the customers who said ready / denied, how many took the parcel.
import { Form, Link, useFetcher, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { formatINR as inr } from "~/lib/pricing";
import { ordinal } from "~/lib/ofd";

type Bucket = { total: number; delivered: number; rto: number; open: number; deliveredValue: number };
export type OfdItem = {
  id: string; name: string; customer: { name: string; phone: string; city: string; pincode: string; address: string; state: string };
  items: string[]; method: string; total: number; toCollect: number; awb: string | null; courier: string | null; ship: string | null; raw: string | null;
  attempts: number; ofdAt: string | null; ndrReason: string | null; ndrAt: string | null; reattemptAt: string | null;
  call: string | null; callAt: string | null; callBy: string | null; followUpAt: string | null; assignee: string | null; tab: string;
  log: { at: string; by: string; text: string }[];
};
export type OfdData = {
  me: number | null; counts: Record<string, number>; team: { id: number; name: string; you: boolean }[]; items: OfdItem[];
  stats: { ofd: number; ndr: number; delivered: number; deliveredValue: number; multi: number; called: number; beforeCall: number; ready: Bucket; denied: Bucket; follow_up: Bucket; none: Bucket };
};
type Res = { ok?: string | null; error?: string | null };
type RangeLike = { preset: string; since: string; until: string };

const at = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const DENY = ["Not available", "Refused the parcel", "Wants a later date", "Address problem", "Ordered by mistake", "Other"];
const C = { green: "#12b76a", red: "#f04438", grey: "#d0d5dd", indigo: "#6172f3", amber: "#f79009", ink: "#344054" };

export function OfdCalls({ data, tab, manager, query, range, onToast }: { data: OfdData; tab: string; manager: boolean; query: string; range: RangeLike; onToast: (r: Res) => void }) {
  const [params] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setOpenId(null), [tab, query]);
  const tabLink = (t: string) => { const p = new URLSearchParams(params); p.set("mode", "ofd"); p.set("tab", t); return `?${p}`; };
  const c = data.counts;
  const tabs = [
    { id: "to_call", label: "To call", n: c.to_call, tone: "#b26b00" },
    { id: "follow_up", label: "Follow-up", n: c.follow_up, tone: "#5b6cf0" },
    { id: "ndr", label: "NDR", n: c.ndr, tone: "#c4320a" },
    { id: "ready", label: "Ready", n: c.ready, tone: "#1f8f5f" },
    { id: "denied", label: "Denied", n: c.denied, tone: "#c5280c" },
    { id: "delivered", label: "Delivered", n: c.delivered, tone: "#1f8f5f" },
    { id: "all", label: "All", n: c.all, tone: "" },
  ];
  if (manager && !data.team.length && !data.items.length && !data.stats.ofd) {
    return <div className="panel px-6 py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-pine-tint text-pine"><Icon name="shipping" className="h-6 w-6" /></span>
      <p className="mt-3 text-[14px] font-semibold">Call customers on delivery day</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ink-soft">Give team members the "Out for delivery calling" permission. Every parcel that goes out for delivery is shared out between them in turn: they call, and mark the customer Ready, Follow-up or Denied.</p>
      <Link to="/dashboard/team" className="btn-primary mt-4 inline-flex">Add a team member</Link>
    </div>;
  }
  return (
    <>
      <Insights s={data.stats} />
      <section className="panel relative z-20 rounded-xl p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule p-3 sm:px-4">
          <RangePicker current={range} />
          <Form method="get" className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
            {[...params].filter(([k]) => k !== "q").map(([k, v]) => <input key={k} name={k} type="hidden" value={v} />)}
            <input type="hidden" name="mode" value="ofd" />
            <div className="relative min-w-0 flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input className="input h-9 min-w-0 !pl-9" aria-label="Search parcels" name="q" defaultValue={query} placeholder="Order, AWB, name or mobile" />
            </div>
            <button type="submit" className="btn-secondary">Search</button>
          </Form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pt-1 sm:px-4" aria-label="Delivery call status">
          {tabs.map((t) => (
            <Link key={t.id} to={tabLink(t.id)} preventScrollReset aria-current={tab === t.id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium transition ${tab === t.id ? "border-pine font-semibold text-pine" : "border-transparent text-ink-soft hover:border-rule hover:text-ink"}`}>
              {t.label}
              <span className={`num rounded-md px-1.5 text-[11.5px] font-semibold ${tab === t.id ? "bg-pine-tint text-pine" : "bg-paper"}`} style={tab !== t.id && t.n && t.tone ? { color: t.tone } : undefined}>{t.n}</span>
            </Link>
          ))}
        </nav>
      </section>
      <p className="px-1 text-[12px] text-ink-faint">To call, Follow-up and NDR show every open parcel. The other tabs and the charts follow the dates above (day the parcel went out for delivery).</p>
      {data.items.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint text-pine"><Icon name="check" className="h-5 w-5" /></span>
          <p className="mt-3 text-[14px] font-semibold">{tab === "to_call" ? "All caught up" : "Nothing here"}</p>
          <p className="mt-1 max-w-xs text-[12.5px] text-ink-faint">{tab === "to_call" ? "Parcels show up here when the courier takes them out for delivery." : "Try another date range."}</p>
        </div>
      ) : tab === "ndr" ? <NdrList items={data.items} manager={manager} team={data.team} onToast={onToast} onOpen={setOpenId} /> : (
        <div className="panel overflow-hidden rounded-xl p-0">
          <ul className="divide-y divide-rule">{data.items.map((o) => <li key={o.id}><OfdRow o={o} manager={manager} onOpen={() => setOpenId(o.id)} /></li>)}</ul>
        </div>
      )}
      {openId && <OfdSheet key={openId} items={data.items} startId={openId} team={data.team} manager={manager} onClose={() => setOpenId(null)} onToast={onToast} />}
    </>
  );
}

/** KPI strip + three donuts: what Ready and Denied customers did, and how deliveries happened. */
function Insights({ s }: { s: OfdData["stats"] }) {
  const done = (b: Bucket) => b.delivered + b.rto;
  const kpis = [
    { label: "Out for delivery", value: s.ofd.toLocaleString("en-IN"), sub: s.multi ? `${s.multi} on 2nd+ attempt` : "Parcels in this period" },
    { label: "Called", value: `${pct(s.called, s.ofd)}%`, sub: `${s.called.toLocaleString("en-IN")} of ${s.ofd.toLocaleString("en-IN")}` },
    { label: "Delivered", value: `${pct(s.delivered, s.ofd)}%`, sub: `${s.delivered.toLocaleString("en-IN")} · ${inr(s.deliveredValue)}`, tone: "text-[#067647]" },
    { label: "NDR now", value: s.ndr.toLocaleString("en-IN"), sub: "Failed, waiting for re-attempt", tone: s.ndr ? "text-[#b54708]" : "" },
    { label: "Delivered before call", value: s.beforeCall.toLocaleString("en-IN"), sub: s.delivered ? `${pct(s.beforeCall, s.delivered)}% of deliveries` : "—" },
  ];
  const how = [
    { label: "Before any call", n: s.none.delivered, color: C.grey },
    { label: "After Ready", n: s.ready.delivered, color: C.green },
    { label: "After Follow-up", n: s.follow_up.delivered, color: C.indigo },
    { label: "After Denied", n: s.denied.delivered, color: C.red },
  ];
  return (
    <section className="panel overflow-hidden p-0">
      <div className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="bg-surface px-4 py-3.5">
            <p className="text-[12px] font-medium text-ink-soft">{k.label}</p>
            <p className={`num mt-0.5 text-[22px] font-semibold leading-tight tracking-tight ${k.tone || "text-ink"}`}>{k.value}</p>
            <p className="truncate text-[11.5px] text-ink-faint">{k.sub}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-px border-t border-rule bg-rule md:grid-cols-3">
        <DonutCard title="Said Ready" hint="Of customers who said they'll take it" center={done(s.ready) ? `${pct(s.ready.delivered, done(s.ready))}%` : "–"} centerSub="delivered"
          parts={[{ label: "Delivered", n: s.ready.delivered, color: C.green }, { label: "Returned (RTO)", n: s.ready.rto, color: C.red }, { label: "Still open", n: s.ready.open, color: C.grey }]} />
        <DonutCard title="Denied" hint="Of customers who refused on the call" center={done(s.denied) ? `${pct(s.denied.delivered, done(s.denied))}%` : "–"} centerSub="still delivered"
          parts={[{ label: "Delivered anyway", n: s.denied.delivered, color: C.amber }, { label: "Returned (RTO)", n: s.denied.rto, color: C.red }, { label: "Still open", n: s.denied.open, color: C.grey }]} />
        <DonutCard title="How deliveries happened" hint="Last call before the parcel was delivered" center={s.delivered.toLocaleString("en-IN")} centerSub="delivered" parts={how} />
      </div>
    </section>
  );
}

function DonutCard({ title, hint, center, centerSub, parts }: { title: string; hint: string; center: string; centerSub: string; parts: { label: string; n: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div className="flex items-center gap-4 bg-surface px-5 py-4">
      <Donut parts={parts} center={center} sub={centerSub} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="text-[11.5px] text-ink-faint">{hint}</p>
        <ul className="mt-2 space-y-1">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="flex-1 truncate text-ink-soft">{p.label}</span>
              <span className="num font-semibold">{p.n.toLocaleString("en-IN")}</span>
              <span className="num w-9 text-right text-[11px] text-ink-faint">{total ? `${pct(p.n, total)}%` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Donut({ parts, center, sub, size = 104 }: { parts: { label: string; n: number; color: string }[]; center: string; sub?: string; size?: number }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  const r = 40, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")} className="shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#f2f4f7" strokeWidth="12" />
      {total > 0 && parts.filter((p) => p.n > 0).map((p) => {
        const len = (p.n / total) * c;
        const el = <circle key={p.label} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="12" strokeDasharray={`${Math.max(0, len - (parts.filter((x) => x.n > 0).length > 1 ? 1.2 : 0))} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)"><title>{`${p.label}: ${p.n}`}</title></circle>;
        offset += len;
        return el;
      })}
      <text x="50" y={sub ? 49 : 54} textAnchor="middle" fontSize="17" fontWeight="650" fill="#101828" className="num">{center}</text>
      {sub && <text x="50" y="63" textAnchor="middle" fontSize="8.5" fill="#667085">{sub}</text>}
    </svg>
  );
}

const SHIP_PILL: Record<string, [string, string]> = {
  out_for_delivery: ["Out for delivery", "bg-[#eef0ff] text-[#3538cd]"], ndr: ["Delivery failed", "bg-[#fff1e3] text-[#b54708]"],
  delivered: ["Delivered", "bg-[#e3f1ea] text-[#067647]"], rto_transit: ["RTO", "bg-[#fdeceb] text-[#b42318]"], rto: ["RTO", "bg-[#fdeceb] text-[#b42318]"],
  in_transit: ["In transit", "bg-[#eef4ff] text-[#175cd3]"],
};
const CALL_PILL: Record<string, [string, string]> = {
  ready: ["Ready", "bg-[#e3f1ea] text-[#067647]"], denied: ["Denied", "bg-[#fdeceb] text-[#b42318]"], follow_up: ["Follow-up", "bg-[#eef0fe] text-[#3442b8]"],
};

function Pills({ o }: { o: OfdItem }) {
  const ship = SHIP_PILL[o.ship ?? ""];
  const call = CALL_PILL[o.call ?? ""];
  return <span className="flex flex-wrap items-center gap-1.5">
    {ship && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ship[1]}`}>{ship[0]}</span>}
    {o.attempts >= 2 && <span className="rounded-full bg-[#101828] px-2 py-0.5 text-[11px] font-semibold text-white">{ordinal(o.attempts)} attempt</span>}
    {call && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${call[1]}`}>{call[0]}</span>}
  </span>;
}

function Phone({ o }: { o: OfdItem }) {
  const [copied, setCopied] = useState(false);
  if (!o.customer.phone) return null;
  return <span className="flex items-center gap-1.5">
    <a href={`tel:+91${o.customer.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-pine px-3 text-[13px] font-semibold text-white hover:bg-pine/90"><Icon name="phone" className="h-4 w-4" />Call</a>
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(o.customer.phone).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="num inline-flex h-9 items-center rounded-lg bg-white px-2.5 text-[13px] font-medium shadow-[inset_0_0_0_1px_#d0d5dd] hover:bg-paper">{copied ? "Copied" : o.customer.phone}</button>
  </span>;
}

/** One line of the list; tapping it opens the call card. */
function OfdRow({ o, manager, onOpen }: { o: OfdItem; manager: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3.5 text-left transition hover:bg-paper md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_1.75rem] md:gap-4 md:px-5">
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-rule bg-paper text-ink-soft"><Icon name="shipping" className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{o.customer.name || <span className="text-ink-faint">No name</span>} <span className="num font-normal text-ink-faint">{o.name}</span></span>
          <span className="block truncate text-xs text-ink-soft">{[o.customer.city, o.items.join(", ")].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <span className="text-right md:text-left">
        <span className="block text-sm font-semibold tabular-nums">{inr(o.toCollect || o.total)}</span>
        <span className="block text-xs text-ink-soft">{o.toCollect ? "Collect (COD)" : "Prepaid"}</span>
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-12 md:col-span-1 md:block md:pl-0">
        <Pills o={o} />
        <span className="block text-xs text-ink-soft md:mt-1">{o.call === "follow_up" && o.followUpAt ? (Date.parse(o.followUpAt) <= Date.now() ? "Call now" : `Call back ${at(o.followUpAt)}`) : o.ship === "ndr" && o.ndrReason ? o.ndrReason : o.ofdAt ? `Out ${at(o.ofdAt)}` : ""}</span>
      </span>
      <span className="col-span-2 truncate pl-12 text-xs text-ink-soft md:col-span-1 md:pl-0 md:text-sm">{manager ? o.assignee ?? "Unassigned" : ""}</span>
      <Icon name="chevron" className="ml-auto hidden h-4 w-4 shrink-0 -rotate-90 text-ink-faint group-hover:text-pine md:block" />
    </button>
  );
}

/** Side panel (full screen on a phone) with the call card. After Ready / Follow-up / Denied the next parcel opens. */
function OfdSheet({ items, startId, team, manager, onClose, onToast }: { items: OfdItem[]; startId: string; team: OfdData["team"]; manager: boolean; onClose: () => void; onToast: (r: Res) => void }) {
  const [cur, setCur] = useState(startId);
  const lastIdx = useRef(Math.max(0, items.findIndex((a) => a.id === startId)));
  let i = items.findIndex((a) => a.id === cur);
  if (i < 0) i = Math.min(lastIdx.current, items.length - 1); // moved to another tab: show the one that took its place
  useEffect(() => {
    if (i >= 0) lastIdx.current = i;
    const a = items[i];
    if (!a) { onClose(); return; }
    if (a.id !== cur) setCur(a.id);
  }, [items, i, cur, onClose]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  const o = items[i];
  if (!o) return null;
  const go = (step: 1 | -1) => { const j = Math.max(0, Math.min(items.length - 1, i + step)); if (items[j]) setCur(items[j].id); };
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-950/35" onClick={onClose}>
      <aside className="cl-sheet flex h-full w-full flex-col border-l border-rule bg-paper sm:max-w-[38rem] sm:shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="Out for delivery call">
        <div className="flex items-center gap-2 border-b border-rule bg-surface px-4 py-4">
          <button type="button" onClick={onClose} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-soft hover:bg-black/5"><Icon name="chevron" className="h-4 w-4 rotate-90" />List</button>
          <p className="min-w-0 flex-1 text-center text-[12.5px] font-medium"><span className="num">{i + 1}</span> of <span className="num">{items.length}</span></p>
          <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
          <button type="button" onClick={() => go(1)} disabled={i >= items.length - 1} aria-label="Next" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <OfdCard key={o.id} o={o} manager={manager} team={team} onToast={(r) => {
            onToast(r);
            if (r.ok && i < items.length - 1) setCur(items[i + 1].id);
          }} />
        </div>
      </aside>
    </div>
  );
}

function OfdCard({ o, manager, team, onToast }: { o: OfdItem; manager: boolean; team: OfdData["team"]; onToast: (r: Res) => void }) {
  const f = useFetcher<Res>();
  const [panel, setPanel] = useState<null | "follow" | "deny">(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (f.state === "idle" && f.data) { onToast(f.data); if (f.data.ok) setPanel(null); } }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = f.state !== "idle";
  const open = o.ship === "out_for_delivery" || o.ship === "ndr";
  const send = (intent: string, extra: Record<string, string> = {}) => f.submit({ intent, orderId: o.id, note, ...extra }, { method: "post" });
  return (
    <article className="panel flex flex-col gap-3 rounded-xl p-4" {...(busy ? { "data-ofd-busy": "1" } : {})}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2"><span className="num text-[15px] font-semibold">{o.name}</span><Pills o={o} /></p>
          <p className="mt-0.5 truncate text-[13px] font-medium">{o.customer.name || "Customer"}</p>
          <p className="truncate text-[12px] text-ink-soft">{[o.customer.address, o.customer.city, o.customer.pincode].filter(Boolean).join(", ")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-ink-faint">{o.toCollect ? "Collect" : "Prepaid"}</p>
          <p className="num text-[18px] font-semibold">{inr(o.toCollect || o.total)}</p>
        </div>
      </header>
      <p className="line-clamp-2 text-[12.5px] text-ink-soft">{o.items.join(" · ")}</p>
      {o.ship === "ndr" && o.ndrReason && <p className="rounded-lg bg-[#fff8f1] px-3 py-2 text-[12px] text-[#93370d]"><b className="font-semibold">Courier note:</b> {o.ndrReason}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
        {o.ofdAt && <span>Out for delivery {at(o.ofdAt)}</span>}
        {o.awb && <span className="font-mono">{o.awb}</span>}
        {o.callAt && <span>{o.callBy ?? "Called"} · {at(o.callAt)}</span>}
        {o.followUpAt && o.call === "follow_up" && <span className="font-medium text-[#3442b8]">Call back {at(o.followUpAt)}</span>}
        {manager && <span>{o.assignee ?? "Not assigned"}</span>}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <Phone o={o} />
          <span className="flex-1" />
          <button type="button" disabled={busy} onClick={() => send("ofd-ready")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#067647] px-3 text-[13px] font-semibold text-white hover:bg-[#05603a] disabled:opacity-60"><Icon name="check" className="h-4 w-4" />Ready</button>
          <button type="button" disabled={busy} onClick={() => setPanel(panel === "follow" ? null : "follow")} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold shadow-[inset_0_0_0_1px_#c7d7fe] ${panel === "follow" ? "bg-[#eef0fe] text-[#3442b8]" : "bg-white text-[#3442b8] hover:bg-[#f5f7ff]"}`}><Icon name="clock" className="h-4 w-4" />Follow-up</button>
          <button type="button" disabled={busy} onClick={() => setPanel(panel === "deny" ? null : "deny")} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold shadow-[inset_0_0_0_1px_#fecdca] ${panel === "deny" ? "bg-[#fdeceb] text-[#b42318]" : "bg-white text-[#b42318] hover:bg-[#fff5f4]"}`}><Icon name="close" className="h-4 w-4" />Denied</button>
        </div>
      )}
      {panel && (
        <div className="cl-pop space-y-2 rounded-lg bg-[#f9fafb] p-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note (optional)" className="input h-9 text-[13px]" />
          {panel === "follow" ? (
            <div className="flex flex-wrap gap-1.5">
              {[["30", "In 30 min"], ["60", "In 1 hour"], ["120", "In 2 hours"], ["240", "In 4 hours"], ["-1", "Tomorrow 10 AM"]].map(([v, l]) => (
                <button key={v} type="button" disabled={busy} onClick={() => send("ofd-follow", { in: v })} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_#d0d5dd] hover:bg-[#eef0fe]">{l}</button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {DENY.map((r) => (
                <button key={r} type="button" disabled={busy} onClick={() => send("ofd-denied", { reason: r })} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_#d0d5dd] hover:bg-[#fdeceb]">{r}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {manager && team.length > 0 && open && <Reassign id={o.id} team={team} onToast={onToast} />}
      {o.log.length > 0 && (
        <details className="text-[11.5px] text-ink-faint">
          <summary className="cursor-pointer select-none">History</summary>
          <ul className="mt-1 space-y-0.5">{o.log.map((l, i) => <li key={i}>{at(l.at)} · {l.by}: {l.text}</li>)}</ul>
        </details>
      )}
    </article>
  );
}

function Reassign({ id, team, onToast }: { id: string; team: OfdData["team"]; onToast: (r: Res) => void }) {
  const f = useFetcher<Res>();
  useEffect(() => { if (f.state === "idle" && f.data) onToast(f.data); }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return <label className="flex items-center gap-2 text-[12px] text-ink-soft">Give to
    <select defaultValue="" onChange={(e) => e.target.value && f.submit({ intent: "ofd-reassign", orderId: id, member: e.target.value }, { method: "post" })} className="h-8 rounded-md border border-rule bg-white px-2 text-[12.5px] text-ink">
      <option value="">Choose…</option>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  </label>;
}

/** NDR: failed deliveries with a re-attempt button each, and select-all for one click. */
function NdrList({ items, manager, team, onToast, onOpen }: { items: OfdItem[]; manager: boolean; team: OfdData["team"]; onToast: (r: Res) => void; onOpen: (id: string) => void }) {
  const f = useFetcher<Res>();
  const [picked, setPicked] = useState<string[]>([]);
  const eligible = items.filter((o) => o.courier === "delhivery" && o.ship === "ndr");
  useEffect(() => { if (f.state === "idle" && f.data) { onToast(f.data); if (f.data.ok) setPicked([]); } }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = f.state !== "idle";
  const send = (ids: string[]) => { const fd = new FormData(); fd.set("intent", "ofd-reattempt"); ids.forEach((id) => fd.append("orderId", id)); f.submit(fd, { method: "post" }); };
  return (
    <section className="panel overflow-hidden rounded-xl p-0" {...(busy ? { "data-ofd-busy": "1" } : {})}>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-[#fff8f1] px-4 py-3">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" className="h-4 w-4 accent-[#0B5D4B]" checked={eligible.length > 0 && picked.length === eligible.length} onChange={(e) => setPicked(e.target.checked ? eligible.map((o) => o.id) : [])} />
          Select all {eligible.length}
        </label>
        <span className="text-[12.5px] text-ink-soft">The courier tries to deliver again on the next working day.</span>
        <button type="button" disabled={!picked.length || busy} onClick={() => send(picked)} className="btn-primary ml-auto h-9 px-3.5 text-[13px] disabled:opacity-50">
          <Icon name="refresh" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Sending…" : `Re-attempt${picked.length ? ` ${picked.length}` : " selected"}`}
        </button>
      </div>
      <ul className="divide-y divide-rule">
        {items.map((o) => {
          const can = eligible.includes(o);
          return (
            <li key={o.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <input type="checkbox" disabled={!can} aria-label={`Select ${o.name}`} className="mt-1 h-4 w-4 accent-[#0B5D4B] disabled:opacity-30" checked={picked.includes(o.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))} />
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onOpen(o.id)}>
                <p className="flex flex-wrap items-center gap-2"><span className="num font-semibold">{o.name}</span><Pills o={o} /></p>
                <p className="text-[12.5px]">{o.customer.name} · {o.customer.city} {o.customer.pincode} · <span className="num font-medium">{inr(o.toCollect || o.total)}</span>{o.toCollect ? " COD" : " prepaid"}</p>
                {o.ndrReason && <p className="mt-0.5 text-[12px] text-[#b54708]">{o.ndrReason}</p>}
                <p className="text-[11.5px] text-ink-faint">{o.ndrAt ? `Failed ${at(o.ndrAt)}` : ""}{o.reattemptAt ? ` · Re-attempt asked ${at(o.reattemptAt)}` : ""}{manager && o.assignee ? ` · ${o.assignee}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <Phone o={o} />
                <button type="button" disabled={!can || busy} onClick={() => send([o.id])} title={can ? "Ask the courier to deliver again" : "Re-attempt works for Delhivery shipments"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#fff1e3] px-3 text-[13px] font-semibold text-[#8a4b00] hover:bg-[#ffe6cc] disabled:opacity-40">
                  <Icon name="refresh" className="h-4 w-4" />Re-attempt
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {manager && team.length === 0 && null}
    </section>
  );
}

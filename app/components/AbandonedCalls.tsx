// Abandoned checkout calling (inside Order confirmation): the caller's list of true abandoned checkouts, and a card
// to call the customer, fill in what they left out, change the cart (quantity, price, add / remove products) and
// place the order. A placed order is already confirmed, so it goes to the courier straight away.
import { Form, Link, useFetcher, useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { formatINR as inr } from "~/lib/pricing";
import { INDIAN_STATES } from "~/lib/states";

export type AbLine = { variantId: string | null; productId?: string; title: string; variantTitle: string | null; image: string | null; quantity: number; pricePaise: number; listPaise: number };
export type AbItem = {
  id: string; at: string; lastActive: string; tab: "to_call" | "follow_up" | "converted" | "not_interested"; stage: string;
  customer: { firstName: string; lastName: string; email: string; address1: string; address2: string; city: string; state: string; pincode: string };
  missing: string[]; cart: AbLine[]; edited: boolean; attempts: number; followUpAt: string | null; note: string;
  callBy: string | null; callAt: string | null; orderId: string | null; assignee: string | null; assigneeId: number | null;
};
export type AbTeam = { id: number; name: string; you: boolean; waiting: number; follow: number; converted: number; lost: number };
export type AbData = { items: AbItem[]; counts: Record<"to_call" | "follow_up" | "converted" | "not_interested" | "all", number>; team: AbTeam[] };
type Res = { ok?: string | null; error?: string | null; phone?: string; orderId?: string; products?: Found[] };
type Found = { variantId: string; productId: string; title: string; variantTitle: string | null; image: string | null; pricePaise: number; comparePaise: number | null; stock: number | null; available: boolean };

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};
const at = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const cartTotal = (cart: AbLine[]) => cart.reduce((s, l) => s + l.pricePaise * l.quantity, 0);
const STYLE: Record<AbItem["tab"], [string, string]> = {
  to_call: ["To call", "bg-[#fff1e3] text-[#8a4b00]"], follow_up: ["Follow-up", "bg-[#eef0fe] text-[#3442b8]"],
  converted: ["Ordered", "bg-[#e3f1ea] text-[#1f6f4a]"], not_interested: ["Not interested", "bg-[#fdeceb] text-[#b42318]"],
};
const LOST_REASONS = ["Not interested now", "Price too high", "Bought elsewhere", "Wrong number", "Didn't pick up 3+ times", "Other"];

export function AbandonedCalls({ data, tab, manager, query, onToast }: { data: AbData; tab: string; manager: boolean; query: string; onToast: (r: Res) => void }) {
  const [params] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const tabLink = (t: string) => { const p = new URLSearchParams(params); p.set("mode", "abandoned"); p.set("tab", t); p.delete("page"); return `?${p}`; };
  const c = data.counts;
  const tabs = [
    { id: "to_call", label: "To call", n: c.to_call, tone: "#b26b00" },
    { id: "follow_up", label: "Follow-up", n: c.follow_up, tone: "#5b6cf0" },
    { id: "converted", label: "Ordered", n: c.converted, tone: "#1f8f5f" },
    { id: "not_interested", label: "Not interested", n: c.not_interested, tone: "#c5280c" },
    { id: "all", label: "All", n: c.all, tone: "" },
    ...(manager ? [{ id: "team", label: "Team", n: null as number | null, tone: "" }] : []),
  ];
  useEffect(() => setOpenId(null), [tab, query]);
  if (manager && !data.team.length) {
    return <div className="panel px-6 py-10 text-center">
      <p className="text-[14px] font-semibold">Add your abandoned checkout calling team</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ink-soft">Give team members the "Abandoned checkout calling" role (or permission). True abandoned checkouts are then shared out between them in turn. Someone can have both calling roles: they get both tabs.</p>
      <Link to="/dashboard/team" className="btn-primary mt-4 inline-flex">Add a team member</Link>
    </div>;
  }
  return (
    <>
      <section className="panel relative z-20 rounded-xl p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule p-3 sm:px-4">
          <Form method="get" className="flex w-full min-w-0 items-center gap-2 sm:flex-1">
            <input name="mode" type="hidden" value="abandoned" />
            <input name="tab" type="hidden" value={tab === "team" ? "all" : tab} />
            <div className="relative min-w-0 flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input className="input h-9 min-w-0 !pl-9" aria-label="Search checkouts" name="q" defaultValue={query} placeholder="Name, city or mobile" />
            </div>
            <button type="submit" className="btn-secondary">Search</button>
          </Form>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pt-1 sm:px-4" aria-label="Checkout status">
          {tabs.map((t) => (
            <Link key={t.id} to={tabLink(t.id)} preventScrollReset aria-current={tab === t.id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium transition ${tab === t.id ? "border-pine font-semibold text-pine" : "border-transparent text-ink-soft hover:border-rule hover:text-ink"}`}>
              {t.label}
              {t.n != null && <span className={`num rounded-md px-1.5 text-[11.5px] font-semibold ${tab === t.id ? "bg-pine-tint text-pine" : "bg-paper"}`} style={tab !== t.id && t.n && t.tone ? { color: t.tone } : undefined}>{t.n}</span>}
            </Link>
          ))}
        </nav>
      </section>
      <p className="px-1 text-[12px] text-ink-faint">Only true abandoned checkouts: the customer left a mobile number, didn't order later and isn't blocked. Orders you place here are already confirmed and go to the courier straight away.</p>

      {tab === "team" ? <AbTeamTable team={data.team} /> : data.items.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint text-pine"><Icon name="check" className="h-5 w-5" /></span>
          <p className="mt-3 text-[14px] font-semibold">{tab === "to_call" ? "All caught up" : "Nothing here"}</p>
          <p className="mt-1 max-w-xs text-[12.5px] text-ink-faint">{tab === "to_call" ? "New abandoned checkouts show up here about 15 minutes after the customer leaves." : "Try another tab."}</p>
        </div>
      ) : (
        <div className="panel overflow-hidden rounded-xl p-0">
          <ul className="divide-y divide-rule">
            {data.items.map((a) => {
              const name = `${a.customer.firstName} ${a.customer.lastName}`.trim();
              const st = STYLE[a.tab];
              return <li key={a.id}>
                <button type="button" onClick={() => setOpenId(a.id)} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3.5 text-left transition hover:bg-paper md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_1.75rem] md:gap-4 md:px-5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-rule bg-paper text-ink-soft"><Icon name="cart" className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{name || <span className="text-ink-faint">No name</span>}</span>
                      <span className="block truncate text-xs text-ink-soft">{[a.customer.city, a.cart.map((l) => `${l.title} ×${l.quantity}`).join(", ")].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                  <span className="text-right md:text-left">
                    <span className="block text-sm font-semibold tabular-nums">{inr(cartTotal(a.cart))}</span>
                    <span className="block text-xs text-ink-soft">{a.stage}</span>
                  </span>
                  <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-12 md:col-span-1 md:block md:pl-0">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${st[1]}`}>{st[0]}</span>
                    <span className="block text-xs text-ink-soft md:mt-1">{a.tab === "follow_up" && a.followUpAt ? (Date.parse(a.followUpAt) <= Date.now() ? "Call now" : at(a.followUpAt)) : `Left ${ago(a.lastActive)}`}</span>
                    <span className="flex flex-wrap gap-x-2 text-[11px]">
                      <span className={a.attempts ? "font-medium text-ink" : "text-ink-faint"}>{a.attempts ? `${a.attempts} attempt${a.attempts === 1 ? "" : "s"}` : "Not tried"}</span>
                      {a.missing.length > 0 && a.tab !== "converted" && <span className="font-medium text-[#b42318]">{a.missing.length} missing</span>}
                    </span>
                  </span>
                  <span className="col-span-2 truncate pl-12 text-xs text-ink-soft md:col-span-1 md:pl-0 md:text-sm">{manager ? a.assignee ?? "Unassigned" : ""}</span>
                  <Icon name="chevron" className="ml-auto hidden h-4 w-4 shrink-0 -rotate-90 text-ink-faint group-hover:text-pine md:block" />
                </button>
              </li>;
            })}
          </ul>
        </div>
      )}
      {openId && tab !== "team" && <AbSheet key={openId} items={data.items} startId={openId} team={data.team} manager={manager} onClose={() => setOpenId(null)} onToast={onToast} />}
    </>
  );
}

function AbTeamTable({ team }: { team: AbTeam[] }) {
  return <section className="panel overflow-hidden p-0">
    <table className="table">
      <thead><tr><th>Team member</th><th className="text-right">To call</th><th className="text-right">Follow-up</th><th className="text-right">Ordered today</th><th className="text-right">Not interested today</th></tr></thead>
      <tbody>{team.map((t) => <tr key={t.id}><td className="font-medium">{t.name}{t.you && <span className="ml-1.5 rounded bg-black/[.05] px-1.5 py-px text-[11px] text-ink-soft">You</span>}</td>
        <td className="num text-right">{t.waiting}</td><td className="num text-right">{t.follow}</td><td className="num text-right text-[#1f6f4a]">{t.converted}</td><td className="num text-right text-[#b42318]">{t.lost}</td></tr>)}</tbody>
    </table>
  </section>;
}

/** Side panel (full screen on a phone). After an outcome the next checkout of the list opens. */
function AbSheet({ items, startId, team, manager, onClose, onToast }: { items: AbItem[]; startId: string; team: AbTeam[]; manager: boolean; onClose: () => void; onToast: (r: Res) => void }) {
  const [cur, setCur] = useState(startId);
  const lastIdx = useRef(Math.max(0, items.findIndex((a) => a.id === startId)));
  let i = items.findIndex((a) => a.id === cur);
  if (i < 0) i = Math.min(lastIdx.current, items.length - 1); // it moved to another tab: show the one that took its place
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
  const a = items[i];
  if (!a) return null;
  const go = (step: 1 | -1) => { const j = Math.max(0, Math.min(items.length - 1, i + step)); if (items[j]) setCur(items[j].id); };
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-950/35" onClick={onClose}>
      <aside className="cl-sheet flex h-full w-full flex-col border-l border-rule bg-paper sm:max-w-[38rem] sm:shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="Abandoned checkout">
        <div className="flex items-center gap-2 border-b border-rule bg-surface px-4 py-4">
          <button type="button" onClick={onClose} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-soft hover:bg-black/5"><Icon name="chevron" className="h-4 w-4 rotate-90" />List</button>
          <p className="min-w-0 flex-1 text-center text-[12.5px] font-medium"><span className="num">{i + 1}</span> of <span className="num">{items.length}</span></p>
          <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
          <button type="button" onClick={() => go(1)} disabled={i >= items.length - 1} aria-label="Next" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <AbCard key={a.id} a={a} team={team} manager={manager} onDone={(r, moved) => {
            onToast(r);
            if (r.ok && moved && i < items.length - 1) setCur(items[i + 1].id);
          }} />
        </div>
      </aside>
    </div>
  );
}

function AbCard({ a, team, manager, onDone }: { a: AbItem; team: AbTeam[]; manager: boolean; onDone: (r: Res, moved: boolean) => void }) {
  const f = useFetcher<Res>();
  const dial = useFetcher<Res>();
  const search = useFetcher<Res>();
  const [c, setC] = useState(a.customer);
  const [cart, setCart] = useState<AbLine[]>(a.cart);
  const [ship, setShip] = useState("0");
  const [note, setNote] = useState("");
  const [panel, setPanel] = useState<null | "follow" | "lost">(null);
  const [q, setQ] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const moved = useRef(false);
  const done = a.tab === "converted";
  const busy = f.state !== "idle";

  useEffect(() => {
    if (f.state !== "idle" || !f.data) return;
    onDone(f.data, moved.current);
    moved.current = false;
    if (f.data.ok) setPanel(null);
  }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Number: every tap counts as a call attempt
  const phone = dial.data?.phone;
  const pending = useRef(false);
  const copyNumber = () => { setCopyMsg(""); pending.current = true; dial.submit({ intent: "ab-phone", sessionId: a.id }, { method: "post" }); };
  useEffect(() => {
    if (dial.state !== "idle" || !pending.current || !dial.data) return;
    pending.current = false;
    if (dial.data.phone) {
      const v = `+91${dial.data.phone}`;
      if (typeof navigator.clipboard?.writeText === "function") void navigator.clipboard.writeText(v).then(() => setCopyMsg("Number copied"), () => setCopyMsg("Select the number to copy it."));
      else setCopyMsg("Select the number to copy it.");
    }
  }, [dial.state, dial.data]);

  useEffect(() => {
    if (!showSearch) return;
    const t = setTimeout(() => search.submit({ intent: "ab-search", q }, { method: "post" }), 250);
    return () => clearTimeout(t);
  }, [q, showSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!c.firstName.trim()) m.push("firstName");
    if (c.address1.trim().length < 5) m.push("address1");
    if (!c.city.trim()) m.push("city");
    if (!INDIAN_STATES.some((s) => s.code === c.state)) m.push("state");
    if (!/^\d{6}$/.test(c.pincode)) m.push("pincode");
    return m;
  }, [c]);
  const shipPaise = Math.max(0, Math.round((Number(ship) || 0) * 100));
  const subtotal = cartTotal(cart);
  const unavailable = cart.some((l) => !l.variantId);
  const payload = () => JSON.stringify({ cart, customer: c, shippingPaise: shipPaise, note });
  const send = (intent: string, extra: Record<string, string> = {}, move = false) => { moved.current = move; f.submit({ intent, sessionId: a.id, data: payload(), note, ...extra }, { method: "post" }); };
  const setLine = (k: number, patch: Partial<AbLine>) => setCart((list) => list.map((l, j) => (j === k ? { ...l, ...patch } : l)));
  const field = (key: keyof AbItem["customer"], label: string, cls = "", props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={`block ${cls}`}>
      <span className={`text-[11.5px] font-medium ${missing.includes(key) ? "text-[#b42318]" : "text-ink-soft"}`}>{label}{missing.includes(key) ? " · missing" : ""}</span>
      <input value={c[key]} onChange={(e) => setC({ ...c, [key]: key === "pincode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value })} disabled={done}
        className={`input mt-0.5 h-9 text-[13px] ${missing.includes(key) ? "!shadow-[inset_0_0_0_2px_#f3a59b] bg-[#fff7f6]" : ""}`} {...props} />
    </label>
  );

  return (
    <div className={`panel cl-in overflow-hidden rounded-xl p-0 ${busy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule px-5 py-3 text-[12px]">
        <b className="num text-[13px]">#{a.id.slice(-8).toUpperCase()}</b>
        <span className="text-ink-faint">Left {ago(a.lastActive)} · {a.stage}</span>
        <span className={`rounded-md px-1.5 py-px font-semibold ${STYLE[a.tab][1]}`}>{STYLE[a.tab][0]}</span>
        {a.tab === "follow_up" && a.followUpAt && <span className="font-medium text-[#5b6cf0]">call at {at(a.followUpAt)}</span>}
        {manager && !done && team.length > 0 && (
          <select aria-label="Assigned to" className="ml-auto h-6 rounded-md border border-rule bg-white px-1 text-[11.5px]" value={a.assigneeId ?? ""} onChange={(e) => send("ab-reassign", { member: e.target.value })}>
            {a.assigneeId == null && <option value="">Unassigned</option>}
            {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight tracking-tight">{`${c.firstName} ${c.lastName}`.trim() || "No name given"}</p>
            {phone && <p className="num mt-0.5 select-all text-[13px]">+91 {phone}</p>}
            {copyMsg && <p role="status" className="mt-0.5 text-xs text-ink-soft">{copyMsg}</p>}
            <p className="mt-0.5 text-[12px] text-ink-faint">{a.attempts ? `${a.attempts} call attempt${a.attempts === 1 ? "" : "s"}` : "Not called yet"}</p>
          </div>
          <button type="button" disabled={dial.state !== "idle"} onClick={copyNumber} className="flex h-10 items-center gap-2 rounded-lg bg-pine px-3.5 text-sm font-semibold text-white disabled:opacity-60"><Icon name="phone" className="h-4 w-4" />{dial.state !== "idle" ? "Copying…" : "Copy number"}</button>
          {phone && <a href={`https://wa.me/91${phone}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="mt-2"><Icon name="chat" className="h-5 w-5" /></a>}
        </div>
        {dial.data?.error && <p role="alert" className="text-xs text-red-700">{dial.data.error}</p>}
        {a.missing.length > 0 && !done && <p className="rounded-lg bg-[#fdeceb] px-3 py-2 text-[12.5px] text-[#8e1f0b]"><b className="font-semibold">Customer didn't fill in:</b> {a.missing.join(", ")}. Ask on the call and fill it below.</p>}
        {a.note && <p className="whitespace-pre-line rounded-lg bg-[#fffbeb] px-3 py-2 text-[12.5px] text-[#6b5a27]"><b className="font-medium">Notes:</b> {a.note}</p>}
        {done && a.orderId && <p className="rounded-lg bg-[#e3f1ea] px-3 py-2 text-[12.5px] text-[#1f6f4a]">Order placed {a.callAt ? at(a.callAt) : ""}{a.callBy ? ` by ${a.callBy}` : ""}.</p>}

        <section>
          <h3 className="mb-1.5 text-[12.5px] font-semibold">Delivery details</h3>
          <div className="grid grid-cols-2 gap-2">
            {field("firstName", "First name")}
            {field("lastName", "Last name")}
            {field("address1", "House, street, area", "col-span-2")}
            {field("address2", "Landmark (optional)", "col-span-2")}
            {field("city", "City")}
            {field("pincode", "Pincode", "", { inputMode: "numeric" })}
            <label className="col-span-2 block">
              <span className={`text-[11.5px] font-medium ${missing.includes("state") ? "text-[#b42318]" : "text-ink-soft"}`}>State{missing.includes("state") ? " · missing" : ""}</span>
              <select value={c.state} onChange={(e) => setC({ ...c, state: e.target.value })} disabled={done} className={`input mt-0.5 h-9 text-[13px] ${missing.includes("state") ? "!shadow-[inset_0_0_0_2px_#f3a59b] bg-[#fff7f6]" : ""}`}>
                <option value="">Choose state</option>
                {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            {field("email", "Email (optional)", "col-span-2", { type: "email" })}
          </div>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[12.5px] font-semibold">Cart{a.edited ? " (edited)" : ""}</h3>
            {!done && <button type="button" onClick={() => setShowSearch((v) => !v)} className="flex items-center gap-1 text-[12.5px] font-medium text-[#005bd3]"><Icon name="plus" className="h-3.5 w-3.5" />Add product</button>}
          </div>
          {showSearch && !done && (
            <div className="mb-2 rounded-lg bg-[#f6f6f7] p-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" className="input h-8 text-[13px]" aria-label="Search products" />
              <div className="mt-1 max-h-56 overflow-y-auto">
                {search.state !== "idle" && !search.data?.products?.length && <p className="px-2 py-2 text-[12px] text-ink-faint">Searching…</p>}
                {search.data?.error && <p className="px-2 py-2 text-[12px] text-[#8e1f0b]">{search.data.error}</p>}
                {(search.data?.products ?? []).map((p) => (
                  <button key={p.variantId} type="button" disabled={!p.available} onClick={() => {
                    setCart((list) => {
                      const k = list.findIndex((l) => l.variantId === p.variantId);
                      if (k >= 0) return list.map((l, j) => (j === k ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l));
                      return [...list, { variantId: p.variantId, productId: p.productId, title: p.title, variantTitle: p.variantTitle, image: p.image, quantity: 1, pricePaise: p.pricePaise, listPaise: p.comparePaise ?? p.pricePaise }];
                    });
                    setShowSearch(false); setQ("");
                  }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white disabled:opacity-50">
                    {p.image ? <img src={p.image} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-paper-sunk" />}
                    <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{p.title}</span><span className="block truncate text-[11px] text-ink-faint">{p.variantTitle ?? "Default"}{!p.available ? " · Sold out" : ""}</span></span>
                    <span className="num text-[12.5px]">{inr(p.pricePaise)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-white">
            {cart.map((l, k) => (
              <li key={`${l.variantId ?? "x"}-${k}`} className="flex items-center gap-2 px-2.5 py-2">
                {l.image ? <img src={l.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : <span className="h-10 w-10 shrink-0 rounded bg-paper-sunk" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium">{l.title}</p>
                  <p className="truncate text-[11px] text-ink-faint">{l.variantTitle ?? ""}{!l.variantId && <span className="font-medium text-[#b42318]"> Unavailable: remove and add again</span>}{l.listPaise > l.pricePaise && <span> · list {inr(l.listPaise)}</span>}</p>
                </div>
                <div className="flex items-center rounded-md shadow-[inset_0_0_0_1px_#d4d4d4]">
                  <button type="button" disabled={done || l.quantity <= 1} onClick={() => setLine(k, { quantity: l.quantity - 1 })} className="h-7 w-7 text-[15px] disabled:opacity-30" aria-label="Fewer">−</button>
                  <span className="num w-6 text-center text-[12.5px]">{l.quantity}</span>
                  <button type="button" disabled={done || l.quantity >= 99} onClick={() => setLine(k, { quantity: l.quantity + 1 })} className="h-7 w-7 text-[15px] disabled:opacity-30" aria-label="More">+</button>
                </div>
                <label className="flex items-center gap-0.5 text-[12px] text-ink-soft">₹
                  <input value={String(l.pricePaise / 100)} disabled={done} inputMode="decimal" aria-label="Price per unit"
                    onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setLine(k, { pricePaise: Math.round((Number(v) || 0) * 100) }); }}
                    className="input h-7 w-[72px] px-1.5 text-right text-[12.5px]" />
                </label>
                {!done && <button type="button" onClick={() => setCart((list) => list.filter((_, j) => j !== k))} aria-label="Remove" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-[#fdeceb] hover:text-[#b42318]"><Icon name="trash" className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
            {!cart.length && <li className="px-3 py-3 text-center text-[12.5px] text-ink-faint">No products. Add one above.</li>}
          </ul>
          <div className="mt-2 space-y-1 text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink-soft">Products</span><span className="num">{inr(subtotal)}</span></div>
            <div className="flex items-center justify-between"><span className="text-ink-soft">Delivery charge</span>
              <label className="flex items-center gap-0.5 text-ink-soft">₹<input value={ship} disabled={done} onChange={(e) => setShip(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label="Delivery charge" className="input h-7 w-[72px] px-1.5 text-right text-[12.5px]" /></label></div>
            <div className="flex justify-between border-t border-rule pt-1 text-[13.5px] font-semibold"><span>Cash on delivery</span><span className="num">{inr(subtotal + shipPaise)}</span></div>
          </div>
        </section>

        {!done && <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional): what the customer said" className="input h-9 text-[12.5px]" />}

        {panel === "follow" && (
          <div className="rounded-xl bg-[#eef0fe] p-3">
            <p className="text-[12.5px] font-medium text-[#3442b8]">Call again</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([["30 min", 30], ["1 hour", 60], ["3 hours", 180], ["Tomorrow 10 AM", -1]] as const).map(([l, m]) => (
                <button key={l} type="button" disabled={busy} onClick={() => send("ab-follow", { in: String(m) }, true)} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-[0_0_0_1px_#d5d9fb] hover:bg-[#f7f8ff]">{l}</button>
              ))}
            </div>
          </div>
        )}
        {panel === "lost" && (
          <div className="rounded-xl bg-[#fdeceb] p-3">
            <p className="text-[12.5px] font-medium text-[#8e1f0b]">Why not?</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LOST_REASONS.map((r) => <button key={r} type="button" disabled={busy} onClick={() => send("ab-lost", { reason: r }, true)} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-[0_0_0_1px_#f3c7c2] hover:bg-[#fff7f6]">{r}</button>)}
            </div>
          </div>
        )}
      </div>

      {!done && (
        <div className="space-y-1.5 border-t border-rule bg-[#fafafa] p-2">
          {(missing.length > 0 || unavailable || !cart.length) && <p className="px-1 text-[11.5px] text-[#8e1f0b]">{!cart.length ? "Add a product to place the order." : unavailable ? "Remove the unavailable item first." : "Fill in the missing details to place the order."}</p>}
          <div className="grid grid-cols-[1.6fr_1fr_1fr_auto] gap-1.5">
            <button type="button" disabled={busy || missing.length > 0 || unavailable || !cart.length} onClick={() => send("ab-convert", {}, true)} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#1f8f5f] text-[13px] font-semibold text-white active:scale-[.98] disabled:opacity-50"><Icon name="check" className="h-4 w-4" />Place order</button>
            <button type="button" disabled={busy} onClick={() => setPanel(panel === "follow" ? null : "follow")} className={`flex h-10 items-center justify-center gap-1 rounded-xl text-[13px] font-semibold ${panel === "follow" ? "bg-[#5b6cf0] text-white" : "bg-white text-[#3442b8] shadow-[inset_0_0_0_1px_#d5d9fb]"}`}><Icon name="clock" className="h-4 w-4" />Follow-up</button>
            <button type="button" disabled={busy} onClick={() => setPanel(panel === "lost" ? null : "lost")} className={`flex h-10 items-center justify-center gap-1 rounded-xl text-[13px] font-semibold ${panel === "lost" ? "bg-[#c5280c] text-white" : "bg-white text-[#b42318] shadow-[inset_0_0_0_1px_#f3c7c2]"}`}><Icon name="close" className="h-4 w-4" />Not interested</button>
            <button type="button" disabled={busy} onClick={() => send("ab-save")} title="Save changes without placing the order" className="flex h-10 items-center justify-center rounded-xl bg-white px-3 text-[12.5px] font-semibold text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3]">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

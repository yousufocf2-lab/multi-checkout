// Order confirmation: the calling team's queue. Each caller gets new orders in turn (round-robin), calls the customer
// and marks the order confirmed, follow-up or cancelled; fixes the address; adds notes. Teammates' work is visible
// as numbers and customer names, never their customers' mobile numbers.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { and, eq } from "drizzle-orm";
import { Icon } from "~/components/Icons";
import { EmptyState } from "~/components/ui";
import { db, orders } from "~/db.server";
import { can, requireStore, requireViewer, type Viewer } from "~/lib/auth.server";
import { CALL_TABS, callBoard, callersFor, reassign, recordCall, teammateOrders, type CallTab } from "~/lib/calls.server";
import { resolveRange } from "~/lib/dates";
import { RangePicker } from "~/components/Overview";
import { readAddress, updateOrderAddress, updateOrderNotes } from "~/lib/order-edit.server";
import { CANCEL_REASONS } from "~/lib/order-actions.server";
import { shipRuleOf } from "~/lib/ship-rule";
import { storePath } from "~/lib/store-code";
import { INDIAN_STATES } from "~/lib/states";
import { formatINR as inr } from "~/lib/pricing";

/** The caller's own team-member id, or null for the owner / managers (they see everything). */
async function whoAmI(viewer: Viewer, store: Parameters<typeof callersFor>[0]) {
  if (viewer.role !== "owner" || !viewer.member) return null;
  const team = await callersFor(store);
  return team.some((t) => t.id === viewer.member!.id) ? viewer.member.id : null;
}
const byName = (v: Viewer) => (v.role === "admin" ? v.staff?.name ?? "Growpefy" : v.member?.name ?? v.name);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const sp = new URL(request.url).searchParams;
  const tab = [...CALL_TABS, "team"].includes(sp.get("tab") as CallTab) ? (sp.get("tab") as CallTab | "team") : "to_call";
  const me = await whoAmI(viewer, store);
  if (!sp.get("range")) sp.set("range", "max"); // nothing hidden by default
  const range = resolveRange(sp, store.createdAt.toISOString().slice(0, 10));
  const board = await callBoard(store, me, tab === "team" ? "to_call" : tab, range.since, range.until);
  const member = Number(sp.get("member")) || null;
  const rule = shipRuleOf(store);
  return json({
    base: storePath(store.id), tab, me, manager: me == null, rule, range,
    board: tab === "team" ? { ...board, orders: [] } : board,
    teammate: tab === "team" && member && board.team.some((t) => t.id === member)
      ? { id: member, orders: await teammateOrders(store, member, me != null && member !== me) } : null,
    reasons: [...CANCEL_REASONS].filter((r) => r !== "Duplicate order"),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "confirm") && !can(viewer, "orders")) return json({ ok: null, error: "Not allowed" }, { status: 403 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const id = String(fd.get("orderId") ?? "");
  const me = await whoAmI(viewer, store);
  const by = byName(viewer);
  const mine = async () => {
    const [o] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.storeId, store.id))).limit(1);
    if (!o) return null;
    if (me != null && o.assignedTo !== me) return null;
    return o;
  };
  if (intent === "confirmed" || intent === "follow_up" || intent === "cancelled") {
    const mins = Number(fd.get("in")) || 60;
    const r = await recordCall(store, id, me, by, {
      kind: intent, note: String(fd.get("note") ?? ""), reason: String(fd.get("reason") ?? ""),
      followUpAt: intent === "follow_up" ? (mins === -1 ? tomorrow10() : new Date(Date.now() + Math.min(mins, 7 * 1440) * 60_000)) : null,
    });
    return json("error" in r ? { ok: null, error: r.error } : { ok: r.ok, error: null });
  }
  if (intent === "address") {
    const o = await mine();
    if (!o) return json({ ok: null, error: "This order is assigned to someone else." });
    const r = await updateOrderAddress(store, o, readAddress(fd), by);
    return json("error" in r ? { ok: null, error: r.error } : { ok: r.ok, error: null });
  }
  if (intent === "notes") {
    const o = await mine();
    if (!o) return json({ ok: null, error: "This order is assigned to someone else." });
    const r = await updateOrderNotes(o, { staff: String(fd.get("staffNote") ?? ""), customer: String(fd.get("customerNote") ?? "") }, by);
    return json({ ok: r.ok, error: null });
  }
  if (intent === "reassign") {
    if (me != null) return json({ ok: null, error: "Only the owner or a manager can reassign orders." });
    const r = await reassign(store, id, Number(fd.get("member")));
    return json("error" in r ? { ok: null, error: r.error } : { ok: r.ok, error: null });
  }
  return json({ ok: null, error: "Unknown action" }, { status: 400 });
}

function tomorrow10() {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  ist.setUTCDate(ist.getUTCDate() + 1); ist.setUTCHours(10, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600_000);
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
type O = D["board"]["orders"][number];
type Res = { ok: string | null; error: string | null };

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};
const at = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Calls() {
  const d = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const revalidator = useRevalidator();
  const [toast, setToast] = useState<Res | null>(null);
  // New orders arrive while the team works: refresh quietly every 30 seconds
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate(); }, 30_000);
    return () => clearInterval(t);
  }, [revalidator]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const c = d.board.counts;
  const tabs: { id: CallTab | "team"; label: string; n: number | null; tone: string }[] = [
    { id: "to_call", label: "To call", n: c.to_call, tone: "#b26b00" },
    { id: "follow_up", label: "Follow-up", n: c.follow_up, tone: "#5b6cf0" },
    { id: "confirmed", label: "Confirmed", n: c.confirmed, tone: "#1f8f5f" },
    { id: "cancelled", label: "Cancelled", n: c.cancelled, tone: "#c5280c" },
    { id: "all", label: "All", n: c.all, tone: "" },
    { id: "team", label: "Team", n: null, tone: "" },
  ];
  const tabLink = (t: string) => { const p = new URLSearchParams(params); p.set("tab", t); p.delete("member"); return `?${p}`; };
  const [openId, setOpenId] = useState<string | null>(null);

  if (!d.board.team.length && d.manager) {
    return <EmptyState title="Add your calling team" action={<Link to="/dashboard/team" className="btn-primary">Add a team member</Link>}>
      Give team members the "Order confirmation (calling)" role. New orders are then shared out between them in turn, and they call customers to confirm, follow up or cancel.
    </EmptyState>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <style>{CSS}</style>
      <section className="panel overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2.5">
          <RangePicker current={d.range} />
          <span className="ml-auto text-[12px] text-ink-faint">{d.manager ? "Whole team" : "Your orders"} · refreshes every 30 s</span>
        </div>
        {/* status tabs with counts: every assigned order is in exactly one of them */}
        <nav className="flex gap-1 overflow-x-auto px-2 py-2" aria-label="Order status">
          {tabs.map((t) => (
            <Link key={t.id} to={tabLink(t.id)} preventScrollReset aria-current={d.tab === t.id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${d.tab === t.id ? "bg-ink text-white" : "text-ink-soft hover:bg-black/[.04] hover:text-ink"}`}>
              {t.label}
              {t.n != null && <span className={`num rounded-md px-1.5 text-[11.5px] font-semibold ${d.tab === t.id ? "bg-white/20 text-white" : "bg-black/[.05]"}`} style={d.tab !== t.id && t.n && t.tone ? { color: t.tone } : undefined}>{t.n}</span>}
            </Link>
          ))}
        </nav>
      </section>

      {d.tab !== "team" && d.rule.mode === "confirmed" && d.rule.by !== "whatsapp" && <p className="px-1 text-[12px] text-ink-faint">Orders you confirm go to the courier automatically{d.rule.prepaidNow ? "; prepaid orders ship without a call" : ""}.</p>}

      {d.tab === "team" ? <Team d={d} /> : d.board.orders.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint text-pine"><Icon name="check" className="h-5 w-5" /></span>
          <p className="mt-3 text-[14px] font-semibold">{d.tab === "to_call" ? "All caught up" : "No orders here"}</p>
          <p className="mt-1 max-w-xs text-[12.5px] text-ink-faint">{d.tab === "to_call" ? "New orders show up here on their own." : "Try another date range."}</p>
        </div>
      ) : (
        <CallList d={d} onOpen={setOpenId} />
      )}

      {openId && d.tab !== "team" && <Sheet d={d} startId={openId} onClose={() => setOpenId(null)} onDone={setToast} />}

      {toast && (toast.ok || toast.error) && (
        <div className={`cl-pop fixed bottom-5 left-1/2 z-[80] max-w-[90vw] -translate-x-1/2 rounded-lg px-3.5 py-2 text-[13px] font-medium text-white shadow-lg ${toast.error ? "bg-[#b42318]" : "bg-[#1a1a1a]"}`} role="status">{toast.error ?? toast.ok}</div>
      )}
    </div>
  );
}

const TAB_STYLE: Record<string, [string, string]> = {
  to_call: ["To call", "bg-[#fff1e3] text-[#8a4b00]"], follow_up: ["Follow-up", "bg-[#eef0fe] text-[#3442b8]"],
  confirmed: ["Confirmed", "bg-[#e3f1ea] text-[#1f6f4a]"], cancelled: ["Cancelled", "bg-[#fdeceb] text-[#b42318]"],
};
/** Why an order is in its tab when it wasn't the call that put it there. */
function via(o: O) {
  if (o.tab === "confirmed" && o.call !== "confirmed" && o.wa === "confirmed") return "on WhatsApp";
  if (o.tab === "cancelled" && o.call !== "cancelled") return o.wa === "cancelled" ? "on WhatsApp" : o.status === "cancelled" ? "by the store" : "";
  return o.callBy ? `by ${o.callBy}` : "";
}

/** The list: newest order first. Tap a row to open its card. */
function CallList({ d, onOpen }: { d: D; onOpen: (id: string) => void }) {
  const now = Date.now();
  return (
    <ul className="panel divide-y divide-rule overflow-hidden p-0">
      {d.board.orders.map((o) => {
        const due = o.tab === "follow_up" && o.followUpAt && new Date(o.followUpAt).getTime() <= now;
        return (
          <li key={o.id}>
            <button type="button" onClick={() => onOpen(o.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-black/[.02] active:bg-black/[.04]">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[.05] text-[12px] font-semibold text-ink-soft">
                {(o.customer.firstName[0] ?? "?").toUpperCase()}{(o.customer.lastName[0] ?? "").toUpperCase()}
                {due && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#5b6cf0]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><b className="truncate text-[13.5px] font-semibold">{o.customer.firstName} {o.customer.lastName}</b><span className="num shrink-0 text-[11.5px] text-ink-faint">{o.name}</span></span>
                <span className="block truncate text-[12px] text-ink-soft">{o.customer.city} · {o.method === "prepaid" ? "Prepaid" : o.method === "partial" ? "Partial COD" : "COD"} {inr(o.total)}{o.shipped ? " · Shipped" : ""}{d.manager && o.assignee ? ` · ${o.assignee}` : ""}</span>
                <span className="block truncate text-[11.5px] text-ink-faint">
                  {o.tab === "follow_up" && o.followUpAt ? (due ? "Call now" : `Call at ${at(o.followUpAt)}`) : o.tab === "to_call" ? `Placed ${ago(o.at)}` : `${TAB_STYLE[o.tab]?.[0] ?? ""} ${via(o)}`}
                </span>
              </span>
              {d.tab === "all" && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TAB_STYLE[o.tab]?.[1] ?? ""}`}>{TAB_STYLE[o.tab]?.[0]}</span>}
              <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-ink-faint" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The order card over the list (full screen on a phone, a side panel on a computer). Swipe or use the arrows for the
 * next / previous order of the same list. After Confirmed / Follow-up / Cancel the order moves to its tab and the next one opens.
 */
function Sheet({ d, startId, onClose, onDone }: { d: D; startId: string; onClose: () => void; onDone: (r: Res) => void }) {
  const list = d.board.orders;
  const [curId, setCurId] = useState(startId);
  const [dir, setDir] = useState<1 | -1>(1);
  const [dx, setDx] = useState(0);
  const lastIdx = useRef(Math.max(0, list.findIndex((o) => o.id === startId)));
  const advanceFrom = useRef<string | null>(null);
  const start = useRef<{ x: number; y: number; lock: "x" | "y" | null } | null>(null);
  let i = list.findIndex((o) => o.id === curId);
  // The order left this list (moved to another tab): show the one that took its place
  if (i < 0) i = Math.min(lastIdx.current, list.length - 1);
  useEffect(() => {
    if (i >= 0) lastIdx.current = i;
    const o = list[i];
    if (!o) { if (!list.length) onClose(); return; }
    if (o.id !== curId) { setDir(1); setCurId(o.id); }
    // After an action on a list that keeps the order (e.g. "All"), go to the next one
    if (advanceFrom.current && advanceFrom.current === o.id && i < list.length - 1) { advanceFrom.current = null; setDir(1); setCurId(list[i + 1].id); }
    else if (advanceFrom.current && advanceFrom.current !== o.id) advanceFrom.current = null;
  }, [list, i, curId, onClose]);
  const go = useCallback((step: 1 | -1) => {
    const j = Math.max(0, Math.min(list.length - 1, i + step));
    if (j !== i) { setDir(step); setCurId(list[j].id); }
  }, [i, list]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [go, onClose]);
  const o = list[i];
  if (!o) return null;
  const onTouchStart = (e: React.TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY, lock: null }; };
  const onTouchMove = (e: React.TouchEvent) => {
    const s0 = start.current; if (!s0) return;
    const t = e.touches[0]; const x = t.clientX - s0.x, y = t.clientY - s0.y;
    if (!s0.lock && (Math.abs(x) > 10 || Math.abs(y) > 10)) s0.lock = Math.abs(x) > Math.abs(y) * 1.2 ? "x" : "y";
    if (s0.lock === "x") setDx((i === 0 && x > 0) || (i === list.length - 1 && x < 0) ? x / 4 : x);
  };
  const onTouchEnd = () => { const s0 = start.current; start.current = null; if (s0?.lock === "x" && Math.abs(dx) > 70) go(dx < 0 ? 1 : -1); setDx(0); };
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <aside className="cl-sheet flex h-full w-full flex-col bg-[#f3f4f6] sm:max-w-[480px] sm:shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="Order card">
        <div className="flex items-center gap-2 border-b border-rule bg-white px-3 py-2.5">
          <button type="button" onClick={onClose} aria-label="Back to list" className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-soft hover:bg-black/5"><Icon name="chevron" className="h-4 w-4 rotate-90" />List</button>
          <div className="min-w-0 flex-1">
            <p className="text-center text-[12.5px] font-medium"><span className="num">{i + 1}</span> of <span className="num">{list.length}</span></p>
            <div className="mx-auto mt-1 h-1 max-w-[160px] overflow-hidden rounded-full bg-black/[.06]"><div className="h-full rounded-full bg-pine transition-[width] duration-300" style={{ width: `${((i + 1) / list.length) * 100}%` }} /></div>
          </div>
          <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous order" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
          <button type="button" onClick={() => go(1)} disabled={i >= list.length - 1} aria-label="Next order" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3] disabled:opacity-30"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
        </div>
        <div className="flex-1 touch-pan-y overflow-y-auto overflow-x-hidden p-3" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
          <ul key={o.id} className={dir > 0 ? "cl-next" : "cl-prev"} style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 60}deg)`, transition: "none" } : { transition: "transform .2s ease-out" }}>
            <OrderCall o={o} d={d} onDone={(r) => { if (r.ok) advanceFrom.current = o.id; onDone(r); }} onNext={i < list.length - 1 ? () => go(1) : undefined} />
          </ul>
          <p className="mt-2 text-center text-[11.5px] text-ink-faint sm:hidden">Swipe left for the next order</p>
        </div>
      </aside>
    </div>
  );
}

function OrderCall({ o, d, onDone, onNext }: { o: O; d: D; onDone: (r: Res) => void; onNext?: () => void }) {
  const f = useFetcher<Res>();
  const [panel, setPanel] = useState<null | "follow" | "cancel" | "address" | "notes">(null);
  const [note, setNote] = useState("");
  const thenNext = useRef(false);
  const busy = f.state !== "idle";
  useEffect(() => {
    if (f.state !== "idle" || !f.data) return;
    onDone(f.data);
    if (f.data.ok) { setPanel(null); if (thenNext.current && onNext) onNext(); }
    thenNext.current = false;
  }, [f.state, f.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = o.customer;
  const send = (intent: string, extra: Record<string, string> = {}) => f.submit({ intent, orderId: o.id, note, ...extra }, { method: "post" });
  const tel = `+91${c.phone}`;
  const items = o.items.map((l) => `${l.title}${l.variant ? ` (${l.variant})` : ""} ×${l.qty}`).join(", ");
  const due = o.call === "follow_up" && o.followUpAt;
  return (
    <li className={`panel cl-in overflow-hidden p-0 ${busy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule px-4 py-2 text-[12px]">
        <b className="num text-[13px]">{o.name}</b>
        <span className="text-ink-faint">{ago(o.at)}</span>
        <span className={`rounded-md px-1.5 py-px font-semibold ${o.method === "prepaid" ? "bg-[#e9eef5] text-[#1c5cab]" : o.method === "partial" ? "bg-violet-50 text-violet-700" : "bg-[#fff1e3] text-[#8a4b00]"}`}>
          {o.method === "prepaid" ? `Paid ${inr(o.total)}` : `${o.method === "partial" ? "Partial COD · " : "COD · "}collect ${inr(o.toCollect)}`}
        </span>
        {o.wa && <span className={`rounded-md px-1.5 py-px font-medium ${o.wa === "confirmed" ? "bg-[#e3f1ea] text-[#1f6f4a]" : o.wa === "cancelled" ? "bg-[#fdeceb] text-[#b42318]" : "bg-black/[.05] text-ink-soft"}`}>WhatsApp: {o.wa === "sent" ? "no reply" : o.wa}</span>}
        {o.attempts > 0 && <span className="text-ink-faint">· {o.attempts} call{o.attempts === 1 ? "" : "s"}</span>}
        {o.shipped && <span className="rounded-md bg-[#e9eef5] px-1.5 py-px font-medium text-[#1c5cab]">Shipped · {o.shipped.awb}</span>}
        {due && <span className="font-medium text-[#5b6cf0]">· call at {at(o.followUpAt!)}</span>}
        {o.call === "confirmed" && <span className="ml-auto rounded-md bg-[#e3f1ea] px-1.5 py-px font-semibold text-[#1f6f4a]">Confirmed</span>}
        {o.call === "cancelled" && <span className="ml-auto rounded-md bg-[#fdeceb] px-1.5 py-px font-semibold text-[#b42318]">Cancelled</span>}
        {d.manager && o.assignee && o.call !== "confirmed" && o.call !== "cancelled" && (
          <select aria-label="Assigned to" className="ml-auto h-6 rounded-md border border-rule bg-white px-1 text-[11.5px]" value={d.board.team.find((t) => t.name === o.assignee)?.id ?? ""} onChange={(e) => f.submit({ intent: "reassign", orderId: o.id, member: e.target.value }, { method: "post" })}>
            {d.board.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      <div className="space-y-2.5 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight">{c.firstName} {c.lastName}</p>
            <p className="num mt-0.5 text-[13px] text-ink-soft">+91 {c.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}</p>
          </div>
          <a href={`tel:${tel}`} className="flex h-10 items-center gap-1.5 rounded-xl bg-[#1f8f5f] px-3.5 text-[13px] font-semibold text-white shadow-sm active:scale-[.98]"><Icon name="phone" className="h-4 w-4" />Call</a>
          <a href={`https://wa.me/91${c.phone}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="flex h-10 w-10 items-center justify-center rounded-xl text-[#1f8f5f] shadow-[inset_0_0_0_1px_#cfe5da] active:scale-[.98]"><Icon name="chat" className="h-4 w-4" /></a>
        </div>
        <p className="text-[13px] leading-snug"><Icon name="route" className="mr-1 inline h-3.5 w-3.5 text-ink-faint" />{[c.address1, c.address2, c.city, c.state, c.pincode].filter(Boolean).join(", ")}
          {o.status !== "cancelled" && <button type="button" onClick={() => setPanel(panel === "address" ? null : "address")} className="ml-1.5 text-[12px] font-medium text-[#005bd3]">Edit</button>}</p>
        <p className="text-[12.5px] text-ink-soft"><Icon name="bag" className="mr-1 inline h-3.5 w-3.5 text-ink-faint" />{items}</p>
        {(o.staffNote || o.customerNote) && panel !== "notes" && (
          <div className="rounded-lg bg-[#fffbeb] px-3 py-2 text-[12.5px] text-[#6b5a27]">
            {o.staffNote && <p className="whitespace-pre-line"><b className="font-medium">Staff note:</b> {o.staffNote}</p>}
            {o.customerNote && <p className="whitespace-pre-line"><b className="font-medium">For customer:</b> {o.customerNote}</p>}
          </div>
        )}
        {o.log.length > 0 && <p className="text-[11.5px] text-ink-faint">{o.log[0].text} · {o.log[0].by} · {at(o.log[0].at)}</p>}

        {panel === "address" && <AddressForm o={o} f={f} onNext={onNext ? () => { thenNext.current = true; } : undefined} />}
        {panel === "notes" && (
          <f.Form method="post" className="space-y-2 rounded-xl bg-[#f6f6f7] p-3">
            <input type="hidden" name="intent" value="notes" /><input type="hidden" name="orderId" value={o.id} />
            <label className="block"><span className="label">Staff note (only your team sees it)</span><textarea name="staffNote" defaultValue={o.staffNote} rows={2} maxLength={1000} className="input mt-1 text-[13px]" /></label>
            <label className="block"><span className="label">Note for the customer (shows on their order page)</span><textarea name="customerNote" defaultValue={o.customerNote} rows={2} maxLength={500} className="input mt-1 text-[13px]" /></label>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn h-8" onClick={() => setPanel(null)}>Close</button><button type="submit" className="btn-secondary btn h-8" disabled={busy}>Save</button>{onNext && <button type="submit" className="btn-primary btn h-8" disabled={busy} onClick={() => { thenNext.current = true; }}>Save &amp; next</button>}</div>
          </f.Form>
        )}
        {panel === "follow" && (
          <div className="rounded-xl bg-[#eef0fe] p-3">
            <p className="text-[12.5px] font-medium text-[#3442b8]">Call again</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[["30 min", 30], ["1 hour", 60], ["3 hours", 180], ["Tomorrow 10 AM", -1]].map(([l, m]) => (
                <button key={l} type="button" disabled={busy} onClick={() => send("follow_up", { in: String(m) })} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-[0_0_0_1px_#d5d9fb] hover:bg-[#f7f8ff]">{l}</button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional): e.g. didn't pick up, asked to call later" className="input mt-2 h-8 text-[12.5px]" />
          </div>
        )}
        {panel === "cancel" && (
          <div className="rounded-xl bg-[#fdeceb] p-3">
            <p className="text-[12.5px] font-medium text-[#8e1f0b]">Why is it cancelled?</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.reasons.map((r) => (
                <button key={r} type="button" disabled={busy} onClick={() => send("cancelled", { reason: r })} className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium shadow-[0_0_0_1px_#f3c7c2] hover:bg-[#fff7f6]">{r}</button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" className="input mt-2 h-8 text-[12.5px]" />
            {o.method !== "cod" && <p className="mt-1.5 text-[11.5px] text-[#8e1f0b]">This order is paid online, so it stays open for the owner to cancel and refund.</p>}
          </div>
        )}
      </div>

      {o.status !== "cancelled" && (
        <div className="grid grid-cols-[1.3fr_1fr_1fr_auto] gap-1.5 border-t border-rule bg-[#fafafa] p-2">
          <button type="button" disabled={busy || o.call === "confirmed"} onClick={() => send("confirmed")} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#1f8f5f] text-[13px] font-semibold text-white active:scale-[.98] disabled:opacity-60"><Icon name="check" className="h-4 w-4" />{o.call === "confirmed" ? "Confirmed ✓" : "Confirmed"}</button>
          <button type="button" disabled={busy} onClick={() => setPanel(panel === "follow" ? null : "follow")} aria-expanded={panel === "follow"} className={`flex h-10 items-center justify-center gap-1 rounded-xl text-[13px] font-semibold ${panel === "follow" ? "bg-[#5b6cf0] text-white" : "bg-white text-[#3442b8] shadow-[inset_0_0_0_1px_#d5d9fb]"}`}><Icon name="clock" className="h-4 w-4" />Follow-up</button>
          <button type="button" disabled={busy} onClick={() => setPanel(panel === "cancel" ? null : "cancel")} aria-expanded={panel === "cancel"} className={`flex h-10 items-center justify-center gap-1 rounded-xl text-[13px] font-semibold ${panel === "cancel" ? "bg-[#c5280c] text-white" : "bg-white text-[#b42318] shadow-[inset_0_0_0_1px_#f3c7c2]"}`}><Icon name="close" className="h-4 w-4" />Cancel</button>
          <button type="button" onClick={() => setPanel(panel === "notes" ? null : "notes")} aria-label="Notes" className={`flex h-10 w-10 items-center justify-center rounded-xl ${panel === "notes" ? "bg-ink text-white" : "bg-white text-ink-soft shadow-[inset_0_0_0_1px_#e3e3e3]"}`}><Icon name="book" className="h-4 w-4" /></button>
        </div>
      )}
      {onNext && (
        <button type="button" onClick={onNext} className="flex w-full items-center justify-center gap-1 border-t border-rule py-2 text-[12.5px] font-medium text-ink-soft hover:bg-black/[.02]">Skip for now<Icon name="chevron" className="h-3.5 w-3.5 -rotate-90" /></button>
      )}
    </li>
  );
}

function AddressForm({ o, f, onNext }: { o: O; f: ReturnType<typeof useFetcher<Res>>; onNext?: () => void }) {
  const c = o.customer;
  return (
    <f.Form method="post" className="grid grid-cols-2 gap-2 rounded-xl bg-[#f6f6f7] p-3">
      <input type="hidden" name="intent" value="address" /><input type="hidden" name="orderId" value={o.id} />
      <input type="hidden" name="phone" value={c.phone} /><input type="hidden" name="email" value={c.email ?? ""} />
      <input name="firstName" defaultValue={c.firstName} placeholder="First name" className="input h-9 text-[13px]" aria-label="First name" />
      <input name="lastName" defaultValue={c.lastName} placeholder="Last name" className="input h-9 text-[13px]" aria-label="Last name" />
      <input name="address1" defaultValue={c.address1} placeholder="House, street, area" className="input col-span-2 h-9 text-[13px]" aria-label="Address" />
      <input name="address2" defaultValue={c.address2} placeholder="Landmark (optional)" className="input col-span-2 h-9 text-[13px]" aria-label="Landmark" />
      <input name="city" defaultValue={c.city} placeholder="City" className="input h-9 text-[13px]" aria-label="City" />
      <input name="pincode" defaultValue={c.pincode} inputMode="numeric" maxLength={6} placeholder="Pincode" className="input h-9 text-[13px]" aria-label="Pincode" />
      <select name="state" defaultValue={c.state} className="input col-span-2 h-9 text-[13px]" aria-label="State">{INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
      <div className="col-span-2 flex justify-end gap-2"><button type="submit" className="btn-secondary btn h-8" disabled={f.state !== "idle"}>Save address</button>{onNext && <button type="submit" className="btn-primary btn h-8" disabled={f.state !== "idle"} onClick={onNext}>Save &amp; next</button>}</div>
    </f.Form>
  );
}

function Team({ d }: { d: D }) {
  const [params] = useSearchParams();
  const pick = (id: number) => { const p = new URLSearchParams(params); p.set("tab", "team"); p.set("member", String(id)); return `?${p}`; };
  const sel = d.teammate;
  const label = useMemo(() => ({ confirmed: ["Confirmed", "bg-[#e3f1ea] text-[#1f6f4a]"], follow_up: ["Follow-up", "bg-[#eef0fe] text-[#3442b8]"], cancelled: ["Cancelled", "bg-[#fdeceb] text-[#b42318]"] }) as Record<string, [string, string]>, []);
  return (
    <div className="space-y-3">
      <section className="panel overflow-hidden p-0">
        <table className="table">
          <thead><tr><th>Team member</th><th className="text-right">To call</th><th className="text-right">Follow-up</th><th className="text-right">Confirmed today</th><th className="text-right">Cancelled today</th></tr></thead>
          <tbody>
            {d.board.team.map((t) => (
              <tr key={t.id} className={sel?.id === t.id ? "[&>td]:bg-paper" : ""}>
                <td><Link to={pick(t.id)} preventScrollReset className="font-medium text-[#005bd3] hover:underline">{t.name}</Link>{t.you && <span className="ml-1.5 rounded bg-black/[.05] px-1.5 py-px text-[11px] text-ink-soft">You</span>}</td>
                <td className="num text-right">{t.waiting}</td><td className="num text-right">{t.follow}</td>
                <td className="num text-right text-[#1f6f4a]">{t.confirmed}</td><td className="num text-right text-[#b42318]">{t.cancelled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {sel && (
        <section className="panel cl-in overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
            <h2 className="text-[14px] font-semibold">{d.board.team.find((t) => t.id === sel.id)?.name}'s orders · last 14 days</h2>
            {!d.manager && sel.id !== d.me && <span className="text-[11.5px] text-ink-faint">Mobile numbers are hidden</span>}
          </div>
          {sel.orders.length ? (
            <ul className="divide-y divide-rule">
              {sel.orders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                  <span className="num w-16 shrink-0 font-medium">{o.name}</span>
                  <span className="min-w-0 flex-1 truncate"><b className="font-medium">{o.customer}</b><span className="text-ink-faint"> · {o.city}{o.phone ? ` · +91 ${o.phone}` : ""}</span></span>
                  <span className="hidden shrink-0 text-ink-faint sm:inline">{o.method === "prepaid" ? "Prepaid" : "COD"} {inr(o.total)}</span>
                  <span className={`shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold ${o.call ? label[o.call]?.[1] : "bg-[#fff1e3] text-[#8a4b00]"}`}>{o.call ? label[o.call]?.[0] : "To call"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-center text-[12.5px] text-ink-faint">No orders in the last 14 days.</p>}
        </section>
      )}
    </div>
  );
}

const CSS = `
@keyframes cl-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes cl-pop { from { opacity: 0; transform: translate(-50%, 6px) } to { opacity: 1; transform: translate(-50%, 0) } }
@keyframes cl-sheet { from { transform: translateY(16px); opacity: .5 } to { transform: none; opacity: 1 } }
.cl-sheet { animation: cl-sheet .22s cubic-bezier(.2,.7,.2,1) both }
@keyframes cl-next { from { opacity: 0; transform: translateX(40px) } to { opacity: 1; transform: none } }
@keyframes cl-prev { from { opacity: 0; transform: translateX(-40px) } to { opacity: 1; transform: none } }
.cl-next { animation: cl-next .25s cubic-bezier(.2,.7,.2,1) both }
.cl-prev { animation: cl-prev .25s cubic-bezier(.2,.7,.2,1) both }
.cl-in { animation: cl-in .25s ease-out both }
.cl-pop { animation: cl-pop .2s ease-out both }
@media (prefers-reduced-motion: reduce) { .cl-in, .cl-pop, .cl-next, .cl-prev { animation: none } }
`;

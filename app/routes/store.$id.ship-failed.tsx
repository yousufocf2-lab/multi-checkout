// Shipping → Failed shipping: website orders the courier couldn't book (pincode not serviceable, address
// problem, courier error). They never reach the courier's panel, so they're listed here to reship.
// Filters: order date, states (untick the states you don't want to ship to) and the reason.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useLocation, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { Notice, PageHeader, Spinner } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { failedShipments, reshipOrders } from "~/lib/auto-ship.server";
import { addDays, rangeLabel, resolveRange } from "~/lib/dates";
import { formatINR } from "~/lib/pricing";
import { INDIAN_STATES, stateCodeFromName, stateName } from "~/lib/states";
import { codAmount } from "~/lib/store-fulfil.server";
import { cancelOrders } from "~/lib/order-actions.server";

const isPin = (e: string) => /non[-\s]?serviceable|not serviceable|doesn't deliver to pincode/i.test(e);
const stateCode = (s: string) => { const t = (s ?? "").trim(); return t.length <= 3 ? t.toUpperCase() : stateCodeFromName(t) ?? t; };
type Why = "all" | "pin" | "other";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  if (!url.searchParams.get("range")) url.searchParams.set("range", "max");
  const range = resolveRange(url.searchParams, store.createdAt.toISOString().slice(0, 10));
  const excluded = new Set((url.searchParams.get("xs") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  const w = url.searchParams.get("why");
  const why: Why = w === "pin" || w === "other" ? w : "all";
  const from = new Date(`${range.since}T00:00:00+05:30`).getTime();
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`).getTime();

  const all = (await failedShipments(store.id)).map((o) => {
    const code = stateCode(o.customer.state);
    return {
      id: o.id, name: o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`, at: o.createdAt.toISOString(), tried: o.shipBookAt?.toISOString() ?? null,
      error: o.shipError ?? "", pin: isPin(o.shipError ?? ""), method: o.paymentMethod, cod: codAmount(o), total: o.total,
      customer: `${o.customer.firstName} ${o.customer.lastName}`.trim(), phone: o.customer.phone, city: o.customer.city, pincode: o.customer.pincode,
      state: code, stateName: stateName(code),
      items: o.items.map((l) => `${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`).join(", "),
    };
  });
  const inRange = all.filter((o) => { const t = new Date(o.at).getTime(); return t >= from && t < to; });
  // Count per state before the state filter, so the menu shows what each state holds
  const perState: Record<string, number> = {};
  for (const o of inRange) perState[o.state] = (perState[o.state] ?? 0) + 1;
  const kept = inRange.filter((o) => !excluded.has(o.state));
  const shown = kept.filter((o) => why === "all" || (why === "pin" ? o.pin : !o.pin));

  return json({
    range, label: rangeLabel(range), why, excluded: [...excluded], perState,
    totals: {
      all: kept.length, pin: kept.filter((o) => o.pin).length, other: kept.filter((o) => !o.pin).length,
      hidden: inRange.length - kept.length,
      value: shown.reduce((s, o) => s + (o.method === "prepaid" ? o.total : o.cod), 0),
    },
    orders: shown,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const ids = fd.getAll("id").map(String).filter(Boolean);
  if (!ids.length) return json({ error: "Select at least one order.", results: [] as { id: string; name: string; ok: boolean; message: string }[], removed: null }, { status: 400 });
  if (fd.get("intent") === "remove") {
    // Remove = cancel for good (never shipped, stock back). Only Cash on Delivery: paid orders need a refund from Orders.
    const list = (await failedShipments(store.id)).filter((o) => ids.includes(o.id));
    const cod = list.filter((o) => o.paymentMethod === "cod").map((o) => o.id);
    const paid = list.length - cod.length;
    const by = viewer.role === "admin" ? viewer.staff?.name ?? "Growpefy" : viewer.member?.name ?? viewer.name;
    const r = cod.length ? await cancelOrders(store, cod, { refund: false, reason: "Removed from Failed shipping", by }) : { done: [] as string[], failed: [] as { name: string; error: string }[] };
    return json({
      error: !cod.length && paid ? "Paid orders can't be removed here. Cancel and refund them from Orders." : null,
      results: [] as { id: string; name: string; ok: boolean; message: string }[], removed: { count: r.done.length, paid, failed: r.failed.map((f) => `${f.name}: ${f.error}`) },
    });
  }
  const r = await reshipOrders(store, ids);
  return json({ ...r, removed: null }, { status: r.error ? 400 : 200 });
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

export default function FailedShipping() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const busy = nav.state === "submitting";
  const busyIntent = busy ? String(nav.formData?.get("intent") ?? "reship") : "";
  const submit = useSubmit();
  const [confirm, setConfirm] = useState<string[] | null>(null); // orders waiting for "Remove" to be confirmed
  const run = (intent: "reship" | "remove", ids: string[]) => {
    const fd = new FormData(); fd.set("intent", intent); ids.forEach((id) => fd.append("id", id));
    submit(fd, { method: "post" });
  };
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Filters changed or orders got booked: keep only selections still on screen
  useEffect(() => setSel((s) => new Set([...s].filter((id) => d.orders.some((o) => o.id === id)))), [d.orders]);
  const all = d.orders.length > 0 && sel.size === d.orders.length;
  const some = sel.size > 0 && !all;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ok = a?.results?.filter((r) => r.ok) ?? [];
  const bad = a?.results?.filter((r) => !r.ok) ?? [];
  const href = (k: string, v: string | null) => { const q = new URLSearchParams(params); v == null ? q.delete(k) : q.set(k, v); return `?${q}`; };
  const selValue = useMemo(() => d.orders.filter((o) => sel.has(o.id)).reduce((s, o) => s + (o.method === "prepaid" ? o.total : o.cod), 0), [d.orders, sel]);
  const filtered = d.excluded.length > 0 || d.why !== "all" || d.range.preset !== "max";

  return (
    <div className="space-y-5">
      <PageHeader title="Failed shipping" icon="shipping"
        description="Orders your courier couldn't book automatically. They never reach the courier's panel, so reship them from here." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting to reship" value={d.totals.all.toLocaleString("en-IN")} icon="box" />
        <Stat label="Pincode not serviceable" value={d.totals.pin.toLocaleString("en-IN")} icon="route" tone={d.totals.pin ? "warn" : undefined} />
        <Stat label="Other courier errors" value={d.totals.other.toLocaleString("en-IN")} icon="alert" tone={d.totals.other ? "bad" : undefined} />
        <Stat label="Order value on screen" value={formatINR(d.totals.value)} icon="rupee" />
      </div>

      <div className="panel flex flex-wrap items-center gap-2 px-3 py-2.5">
        <RangePicker current={d.range} />
        <StateFilter excluded={d.excluded} perState={d.perState} />
        <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist" aria-label="Reason">
          {([["all", "All reasons", d.totals.all], ["pin", "Pincode", d.totals.pin], ["other", "Other errors", d.totals.other]] as const).map(([id, l, n]) => (
            <Link key={id} to={href("why", id === "all" ? null : id)} preventScrollReset role="tab" aria-selected={d.why === id}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${d.why === id ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
              {l}<span className={`num rounded px-1 text-[11px] ${d.why === id ? "bg-white/20" : "bg-paper-sunk"}`}>{n}</span>
            </Link>
          ))}
        </div>
        {filtered && <Link to="?" className="ml-auto text-[13px] font-medium text-ink-soft hover:text-ink">Clear filters</Link>}
      </div>

      {d.totals.hidden > 0 && (
        <p className="-mt-2 text-xs text-ink-faint">{d.totals.hidden} order{d.totals.hidden === 1 ? "" : "s"} hidden from {d.excluded.length} unticked state{d.excluded.length === 1 ? "" : "s"}.</p>
      )}

      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {a?.removed && a.removed.count > 0 && <Notice tone="success"><b>{a.removed.count} order{a.removed.count === 1 ? "" : "s"} removed.</b> They're cancelled and won't be shipped.</Notice>}
      {a?.removed && a.removed.paid > 0 && a.removed.count > 0 && <Notice tone="warning">{a.removed.paid} paid order{a.removed.paid === 1 ? " was" : "s were"} kept: cancel and refund paid orders from Orders.</Notice>}
      {a?.removed && a.removed.failed.length > 0 && <Notice tone="warning">{a.removed.failed.join(" · ")}</Notice>}
      {ok.length > 0 && <Notice tone="success"><b>{ok.length} booked.</b> {ok.map((r) => `${r.name}: ${r.message}`).join(" · ")}</Notice>}
      {bad.length > 0 && <Notice tone="warning"><b>{bad.length} still failed.</b> {bad.map((r) => `${r.name}: ${r.message}`).join(" · ")}</Notice>}

      {d.orders.length === 0 ? (
        <section className="panel px-6 py-16 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#e6f2ee]"><Icon name="check" className="h-5 w-5 text-pine" /></span>
          <p className="mt-3 font-semibold">{filtered ? "Nothing matches these filters" : "No failed shipments"}</p>
          <p className="mt-1 text-sm text-ink-soft">{filtered ? "Change the date, states or reason to see more." : "Every order reached the courier."}</p>
        </section>
      ) : (
        <div className="panel overflow-hidden">
          <div className={`flex min-h-[52px] flex-wrap items-center gap-3 border-b px-4 py-2 transition ${sel.size ? "border-[#cfe5da] bg-[#f1f8f4]" : "border-rule bg-surface"}`}>
            {sel.size ? (
              <>
                <span className="text-sm font-semibold">{sel.size} selected</span>
                <span className="num text-xs text-ink-soft">{formatINR(selValue)}</span>
                <button type="button" disabled={busy} onClick={() => run("reship", [...sel])} className="btn-primary ml-auto h-9">
                  {busyIntent === "reship" ? <><Spinner /> Reshipping…</> : <><Icon name="refresh" className="h-4 w-4" /> Reship {sel.size}</>}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm([...sel])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#f3c7c2] bg-white px-3 text-[13px] font-semibold text-[#b42318] hover:bg-[#fff5f4] disabled:opacity-50">
                  {busyIntent === "remove" ? <><Spinner /> Removing…</> : <><Icon name="trash" className="h-4 w-4" /> Remove {sel.size}</>}
                </button>
                <button type="button" onClick={() => setSel(new Set())} className="btn-secondary h-9">Clear</button>
              </>
            ) : (
              <>
                <span className="text-sm text-ink-soft"><b className="num text-ink">{d.orders.length}</b> order{d.orders.length === 1 ? "" : "s"} · {d.label}</span>
                <span className="ml-auto hidden text-xs text-ink-faint sm:inline">Reship tries every connected courier: Delhivery, then Shiprocket on pincode errors.</span>
              </>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-[13px]">
              <thead>
                <tr className="border-b border-rule bg-paper text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                  <th className="w-10 py-2.5 pl-4">
                    <input type="checkbox" className="h-4 w-4 align-middle" checked={all} ref={(el) => { if (el) el.indeterminate = some; }}
                      onChange={() => setSel(all ? new Set() : new Set(d.orders.map((o) => o.id)))} aria-label="Select all orders" />
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Order</th>
                  <th className="px-3 py-2.5 font-semibold">Ordered</th>
                  <th className="px-3 py-2.5 font-semibold">Customer</th>
                  <th className="px-3 py-2.5 font-semibold">Ship to</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2.5 font-semibold">Reason</th>
                  <th className="px-3 py-2.5 pr-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {d.orders.map((o) => {
                  const on = sel.has(o.id);
                  return (
                    <tr key={o.id} onClick={() => toggle(o.id)} className={`cursor-pointer align-top transition ${on ? "bg-[#f4faf7]" : "hover:bg-paper"}`}>
                      <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => toggle(o.id)} aria-label={`Select ${o.name}`} />
                      </td>
                      <td className="max-w-[260px] px-3 py-3">
                        <p className="num font-semibold">{o.name}</p>
                        <p className="truncate text-xs text-ink-soft" title={o.items}>{o.items}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p>{date(o.at)}</p>
                        <p className="text-xs text-ink-faint">{time(o.at)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{o.customer || "—"}</p>
                        <p className="num text-xs text-ink-faint">{o.phone}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p>{o.city}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                          <span className="rounded bg-paper-sunk px-1.5 py-px font-semibold text-ink-soft" title={o.stateName}>{o.state}</span>
                          <span className="num text-ink-faint">{o.pincode}</span>
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <p className="num font-semibold">{formatINR(o.method === "prepaid" ? o.total : o.cod)}</p>
                        <span className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10.5px] font-semibold ${o.method === "prepaid" ? "bg-[#e6f2ee] text-[#0B5D4B]" : "bg-[#fdf0ea] text-[#b0461a]"}`}>{o.method === "prepaid" ? "Prepaid" : "COD"}</span>
                      </td>
                      <td className="max-w-[300px] px-3 py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${o.pin ? "bg-[#fff4e0] text-[#8a5a00]" : "bg-[#fdeceb] text-[#b42318]"}`}>
                          <Icon name={o.pin ? "route" : "alert"} className="h-3 w-3" />{o.pin ? "Pincode not serviceable" : "Courier error"}
                        </span>
                        <p className="mt-1 line-clamp-2 text-xs text-ink-soft" title={o.error}>{o.error}</p>
                        {o.tried && <p className="mt-0.5 text-[11px] text-ink-faint">Last tried {date(o.tried)}, {time(o.tried)}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1.5">
                          <button type="button" disabled={busy} onClick={() => run("reship", [o.id])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rule-strong bg-white px-2.5 text-[12.5px] font-semibold hover:bg-paper disabled:opacity-50">
                            <Icon name="refresh" className="h-3.5 w-3.5" />Reship
                          </button>
                          <button type="button" disabled={busy} onClick={() => setConfirm([o.id])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#f3c7c2] bg-white px-2.5 text-[12.5px] font-semibold text-[#b42318] hover:bg-[#fff5f4] disabled:opacity-50">
                            <Icon name="trash" className="h-3.5 w-3.5" />Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirm && (
        <RemoveDialog
          orders={d.orders.filter((o) => confirm.includes(o.id))}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { run("remove", confirm); setConfirm(null); }}
        />
      )}
    </div>
  );
}

/** "Are you sure?" before removing failed orders for good. */
function RemoveDialog({ orders, onCancel, onConfirm }: { orders: { id: string; name: string; customer: string; method: string }[]; onCancel: () => void; onConfirm: () => void }) {
  const n = orders.length;
  const paid = orders.filter((o) => o.method !== "cod").length;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="rm-title" className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdeceb] text-[#b42318]"><Icon name="trash" className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id="rm-title" className="text-[16px] font-semibold">Remove {n === 1 ? orders[0]?.name ?? "this order" : `${n} orders`}?</h2>
            <p className="mt-1 text-[13px] text-ink-soft">
              {n === 1 ? `${orders[0]?.customer || "This customer"}'s order` : "These orders"} will be cancelled and taken off Failed shipping.
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-[#f3c7c2] bg-[#fff5f4] px-3.5 py-3 text-[13px] text-[#8e1f0b]">
          <p className="font-semibold">This can't be undone.</p>
          <p className="mt-0.5">You won't be able to ship {n === 1 ? "this order" : "these orders"} again. {n === 1 ? "It" : "They"} will be removed permanently.</p>
          {paid > 0 && <p className="mt-1.5 text-[12.5px]">{paid} paid order{paid === 1 ? "" : "s"} will be kept: cancel and refund paid orders from Orders.</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} className="btn-secondary h-10 px-4">Keep {n === 1 ? "order" : "orders"}</button>
          <button type="button" onClick={onConfirm} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#c5280c] px-4 text-[13.5px] font-semibold text-white hover:bg-[#a8220a]">
            <Icon name="trash" className="h-4 w-4" />Remove {n === 1 ? "order" : `${n} orders`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: "box" | "route" | "alert" | "rupee"; tone?: "warn" | "bad" }) {
  const c = tone === "warn" ? { bg: "#fff4e0", fg: "#8a5a00" } : tone === "bad" ? { bg: "#fdeceb", fg: "#b42318" } : { bg: "#eef1ee", fg: "#475467" };
  return (
    <div className="panel flex items-center gap-3 px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: c.bg, color: c.fg }}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0">
        <p className="truncate text-xs text-ink-soft">{label}</p>
        <p className="num text-[20px] font-semibold leading-tight">{value}</p>
      </div>
    </div>
  );
}

/** States menu: every state ticked by default; untick the ones you don't want to see (and reship). */
function StateFilter({ excluded, perState }: { excluded: string[]; perState: Record<string, number> }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set(excluded));
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setOff(new Set(excluded)); setOpen(false); }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  // States with failed orders first (most first), then the rest A–Z; plus any unknown codes from orders
  const known = new Set(INDIAN_STATES.map((s) => s.code));
  const list = [
    ...INDIAN_STATES.map((s) => ({ ...s, n: perState[s.code] ?? 0 })),
    ...Object.keys(perState).filter((c) => !known.has(c)).map((c) => ({ code: c, name: c || "Unknown", n: perState[c] })),
  ].sort((a, b) => (b.n > 0 ? 1 : 0) - (a.n > 0 ? 1 : 0) || b.n - a.n || a.name.localeCompare(b.name));
  const visible = q ? list.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase() === q.toLowerCase()) : list;
  const total = list.length;
  const ticked = list.filter((s) => !off.has(s.code)).length;
  const allOn = off.size === 0;
  const flip = (c: string) => setOff((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const keep = [...params.entries()].filter(([k]) => k !== "xs");
  const appliedTicked = total - excluded.filter((c) => list.some((s) => s.code === c)).length;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-sm shadow-sm transition hover:border-ink/30 ${excluded.length ? "border-ink/40" : "border-rule-strong"}`}>
        <Icon name="globe" className="h-4 w-4 text-ink-faint" />
        <span className="font-medium">States</span>
        <span className="text-xs text-ink-faint">{excluded.length ? `${appliedTicked} of ${total}` : "All"}</span>
        <Icon name="chevron" className={`h-3.5 w-3.5 text-ink-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <Form method="get" preventScrollReset className="fixed inset-x-3 bottom-3 z-50 max-h-[80vh] overflow-y-auto animate-fadein rounded-2xl border border-rule bg-surface shadow-lift sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:z-40 sm:mt-1.5 sm:max-h-none sm:w-[300px] sm:overflow-visible sm:rounded-xl" role="dialog" aria-label="States">
          {keep.map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
          {off.size > 0 && <input type="hidden" name="xs" value={[...off].join(",")} />}
          <div className="border-b border-rule p-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search states" className="input h-8 text-[13px]" autoFocus />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 border-b border-rule px-3 py-2.5 text-sm font-semibold hover:bg-paper">
            <input type="checkbox" className="h-4 w-4" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && ticked > 0; }}
              onChange={() => setOff(allOn ? new Set(list.map((s) => s.code)) : new Set())} />
            All states <span className="ml-auto text-xs font-normal text-ink-faint">{ticked}/{total}</span>
          </label>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {visible.map((s) => (
              <label key={s.code} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-paper">
                <input type="checkbox" className="h-4 w-4" checked={!off.has(s.code)} onChange={() => flip(s.code)} />
                <span className={`flex-1 truncate ${s.n ? "font-medium" : "text-ink-soft"}`}>{s.name}</span>
                {s.n > 0 && <span className="num rounded-full bg-[#fdeceb] px-1.5 text-[11px] font-semibold text-[#b42318]">{s.n}</span>}
              </label>
            ))}
            {!visible.length && <p className="px-3 py-3 text-[13px] text-ink-faint">No state matches.</p>}
          </div>
          <div className="flex items-center gap-2 border-t border-rule p-2">
            <button type="button" onClick={() => setOff(new Set())} className="text-[13px] font-medium text-ink-soft hover:text-ink">Reset</button>
            <button type="submit" className="btn-primary ml-auto h-8 px-4 text-[13px]">Apply</button>
          </div>
        </Form>
      )}
    </div>
  );
}

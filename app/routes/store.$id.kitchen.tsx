// Restaurant → Kitchen: live orders on one screen. New orders ring; tap to move them along:
// New → Accepted → Preparing → Ready → Out for delivery / Picked up / Served → Done.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { PageHeader } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { kitchenBoard, setKitchenStatus } from "~/lib/kitchen.server";
import { formatINR } from "~/lib/pricing";
import { KITCHEN_COLUMNS, openNow, resolveRestaurant, type KitchenStatus } from "~/lib/restaurant";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (store.businessType !== "restaurant") throw new Response("The kitchen screen is for restaurants and cloud kitchens.", { status: 404 });
  const r = resolveRestaurant(store.restaurant);
  return json({ ...(await kitchenBoard(store)), open: openNow(r), sound: r.kitchen.sound, prep: r.prepMinutes, now: Date.now() });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const fd = await request.formData();
  const err = await setKitchenStatus(store, String(fd.get("id")), String(fd.get("to")) as KitchenStatus, viewer.name ?? "Kitchen", String(fd.get("reason") ?? ""));
  return json({ error: err });
}

const ago = (iso: string, now: number) => { const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

/** Two short chimes (no audio file needed). Browsers only allow sound after a tap, hence the "Turn on sound" button. */
function chime(ctx: AudioContext) {
  [0, 0.22].forEach((t, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = i ? 1046 : 784;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.4);
  });
}

export default function Kitchen() {
  const d = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [now, setNow] = useState(d.now);
  const [audio, setAudio] = useState<AudioContext | null>(null);
  const [filter, setFilter] = useState<"all" | "delivery" | "takeaway" | "dine_in">("all");
  const seen = useRef<Set<string> | null>(null);

  // Fresh orders every 10 seconds (and when the tab comes back), the clock every 30
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && rv.state === "idle") rv.revalidate(); }, 10_000);
    const c = setInterval(() => setNow(Date.now()), 30_000);
    const v = () => document.visibilityState === "visible" && rv.revalidate();
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); clearInterval(c); document.removeEventListener("visibilitychange", v); };
  }, [rv]);

  // Ring for orders we haven't seen yet
  useEffect(() => {
    const ids = new Set(d.orders.filter((o) => o.status === "new").map((o) => o.id));
    if (seen.current && audio && d.sound && [...ids].some((id) => !seen.current!.has(id))) chime(audio);
    seen.current = new Set([...(seen.current ?? []), ...ids]);
  }, [d.orders, audio, d.sound]);

  const list = useMemo(() => d.orders.filter((o) => filter === "all" || o.fulfilment === filter), [d.orders, filter]);
  const count = (f: string) => d.orders.filter((o) => f === "all" || o.fulfilment === f).length;
  const cols = KITCHEN_COLUMNS.filter((c) => c.id !== "out" || d.orders.some((o) => o.fulfilment === "delivery") || filter === "delivery");

  return (
    <div className="space-y-4">
      <PageHeader title="Kitchen" icon="bell" description="Live orders. New orders ring; tap the button on a card to move it to the next step."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${d.open.open ? "bg-[#e6f2ee] text-[#0B5D4B]" : "bg-[#fdeceb] text-[#b42318]"}`}>
              <i className={`h-2 w-2 rounded-full ${d.open.open ? "bg-[#1baf7a]" : "bg-[#d92d20]"}`} />{d.open.open ? "Taking orders" : d.open.reason === "paused" ? "Paused" : "Closed now"}
            </span>
            {d.sound && (audio
              ? <span className="inline-flex items-center gap-1 text-xs text-ink-soft"><Icon name="bell" className="h-3.5 w-3.5" />Sound on</span>
              : <button type="button" className="btn-primary h-9" onClick={() => { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const c = new C(); chime(c); setAudio(c); }}><Icon name="bell" className="h-4 w-4" />Turn on sound</button>)}
            <Link to="../restaurant" relative="path" className="btn-secondary h-9"><Icon name="settings" className="h-4 w-4" />Settings</Link>
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Live orders" value={String(d.orders.length)} />
        <Stat label="Completed today" value={String(d.today.done ?? 0)} />
        <Stat label="Rejected today" value={String(d.today.rejected ?? 0)} />
        <Stat label="Sales today" value={formatINR(d.today.sales)} />
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-rule-strong bg-surface p-0.5">
        {([["all", "All"], ["delivery", "Delivery"], ["takeaway", "Takeaway"], ["dine_in", "Dine-in"]] as const).map(([id, l]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${filter === id ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
            {l}<span className={`num rounded px-1 text-[11px] ${filter === id ? "bg-white/20" : "bg-paper-sunk"}`}>{count(id)}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cols.map((c) => {
          const items = list.filter((o) => c.statuses.includes(o.status));
          return (
            <section key={c.id} className="flex min-h-[200px] flex-col rounded-2xl bg-[#eceef1] p-2">
              <h2 className="flex items-center justify-between px-2 py-1.5 text-[13px] font-semibold">
                {c.label}<span className="num rounded-full bg-white px-2 text-xs">{items.length}</span>
              </h2>
              <div className="space-y-2">
                {items.map((o) => <Ticket key={o.id} o={o} now={now} prep={d.prep} />)}
                {!items.length && <p className="px-2 py-6 text-center text-xs text-ink-faint">Nothing here</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

type O = ReturnType<typeof useLoaderData<typeof loader>>["orders"][number];

function Ticket({ o, now, prep }: { o: O; now: number; prep: number }) {
  const f = useFetcher<{ error: string | null }>();
  const [rejecting, setRejecting] = useState(false);
  const busy = f.state !== "idle";
  const waitMin = Math.round((now - new Date(o.at).getTime()) / 60000);
  const late = o.status !== "ready" && o.status !== "out" && waitMin > prep;
  const tone = o.fulfilment === "delivery" ? "bg-[#eef4ff] text-[#1d4ed8]" : o.fulfilment === "takeaway" ? "bg-[#fff4e0] text-[#8a5a00]" : "bg-[#f3e8ff] text-[#6b21a8]";
  return (
    <article className={`rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,.06)] ${o.status === "new" ? "ring-2 ring-[#1baf7a]" : ""} ${busy ? "opacity-60" : ""}`}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="num text-[15px] font-semibold">{o.name}</p>
          <p className="text-[11px] text-ink-faint">{clock(o.at)} · <span className={late ? "font-semibold text-[#b42318]" : ""}>{ago(o.at, now)} ago</span></p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{o.fulfilmentLabel}{o.table ? ` · T${o.table}` : ""}</span>
      </header>
      <ul className="mt-2 space-y-0.5 border-y border-dashed border-rule py-2 text-[13px]">
        {o.items.map((l, i) => <li key={i} className="flex gap-2"><b className="num w-6 shrink-0">{l.qty}×</b><span>{l.title}{l.variant ? <span className="text-ink-soft"> · {l.variant}</span> : null}</span></li>)}
      </ul>
      {o.note && <p className="mt-1.5 rounded-md bg-[#fff8e6] px-2 py-1 text-xs text-[#7a5200]">Note: {o.note}</p>}
      <p className="mt-1.5 text-xs text-ink-soft">{o.customer}{o.phone ? ` · ${o.phone}` : ""}</p>
      {o.address && <p className="text-xs text-ink-faint">{o.address}</p>}
      <p className="mt-1 text-xs"><b className="num">{formatINR(o.total)}</b> {o.paid ? <span className="text-[#0B5D4B]">· Paid online</span> : <span className="text-[#b0461a]">· Collect {formatINR(o.cod)}</span>}</p>
      {f.data?.error && <p className="mt-1 text-xs text-bad">{f.data.error}</p>}
      {rejecting ? (
        <f.Form method="post" className="mt-2 space-y-1.5" onSubmit={() => setRejecting(false)}>
          <input type="hidden" name="id" value={o.id} /><input type="hidden" name="to" value="rejected" />
          <input name="reason" placeholder="Reason (item finished, closing…)" className="input h-8 w-full text-[13px]" autoFocus />
          <div className="flex gap-1.5"><button className="btn-danger h-8 flex-1">Reject order</button><button type="button" onClick={() => setRejecting(false)} className="btn-secondary h-8">Back</button></div>
        </f.Form>
      ) : (
        <div className="mt-2 flex gap-1.5">
          {o.next && (
            <f.Form method="post" className="flex-1">
              <input type="hidden" name="id" value={o.id} /><input type="hidden" name="to" value={o.next.to} />
              <button disabled={busy} className="btn-primary h-9 w-full">{o.next.label}</button>
            </f.Form>
          )}
          {(o.status === "new" || o.status === "accepted") && <button type="button" onClick={() => setRejecting(true)} className="btn-secondary h-9 px-3 text-[#b42318]">Reject</button>}
        </div>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="panel px-4 py-3"><p className="text-xs text-ink-soft">{label}</p><p className="num mt-0.5 text-[20px] font-semibold">{value}</p></div>;
}

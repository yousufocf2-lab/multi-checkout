// Live view: visitors on the store's website and checkout right now, refreshed every few seconds.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { liveSnapshot, type LiveSnapshot, type Stage } from "~/lib/live.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  return json({
    base: storePath(store.id),
    website: store.platform === "growpefy" || store.storefrontEnabled,
    initial: await liveSnapshot(store.id),
  });
}

const POLL_MS = 3000;
const STAGE: Record<Stage, { label: string; color: string }> = {
  home: { label: "Home page", color: "#5b6cf0" },
  browsing: { label: "Browsing", color: "#9b5de5" },
  product: { label: "Viewing product", color: "#0e9f9a" },
  cart: { label: "In cart", color: "#e8a317" },
  checkout: { label: "In checkout", color: "#1f8f5f" },
};
const STEP = { 1: "Mobile number", 2: "Address", 3: "Payment" } as const;
const ORDER: Stage[] = ["home", "browsing", "product", "cart", "checkout"];
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967295; };

function useLive(base: string, initial: LiveSnapshot) {
  const [data, setData] = useState(initial);
  const [ok, setOk] = useState(true);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`${base}/live/data`, { headers: { Accept: "application/json" }, cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as LiveSnapshot;
        if (alive) { setData(d); setOk(true); }
      } catch { if (alive) setOk(false); }
    };
    const t = setInterval(pull, POLL_MS);
    const vis = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [base]);
  return { data, ok };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Counts smoothly to the new value. */
function AnimatedNumber({ value, className = "" }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value;
    if (a === b) return;
    setBump((n) => n + 1);
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700), e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (b - a) * e);
      setShown(v); from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span key={bump} className={`num inline-block ${bump ? "lv-bump" : ""} ${className}`}>{shown.toLocaleString("en-IN")}</span>;
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function LiveView() {
  const { base, website, initial } = useLoaderData<typeof loader>();
  const { data, ok } = useLive(base, initial as LiveSnapshot);
  const now = useNow();
  const skew = useMemo(() => Date.now() - data.now, [data.now]); // server vs browser clock
  const t = now - skew;

  return (
    <div className="space-y-4">
      <style>{CSS}</style>
      {!website && <Notice>Live view shows shoppers on your checkout. Website visitors appear here once your website runs on Growpefy Store.</Notice>}

      {/* ---------- hero ---------- */}
      <section className="panel lv-hero relative overflow-hidden p-0">
        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="relative flex items-center gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5">
            <Radar on={data.total > 0} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
                Visitors right now
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold ${ok ? "bg-[#e3f1ea] text-[#1f6f4a]" : "bg-[#fff1e3] text-[#7a4b00]"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${ok ? "lv-blink bg-[#1f8f5f]" : "bg-[#c47f00]"}`} />{ok ? "LIVE" : "Reconnecting"}
                </span>
              </p>
              <p className="mt-1 text-[38px] font-semibold leading-none tracking-tight sm:text-[44px]"><AnimatedNumber value={data.total} /></p>
              <p className="mt-2 text-[12px] text-ink-faint">
                {data.peak.n > 0 ? <>Peak today <b className="num font-semibold text-ink-soft">{data.peak.n}</b> at {new Date(data.peak.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</> : "Peak today will show here"}
                <span className="mx-1.5">·</span>updates every few seconds
              </p>
            </div>
          </div>
          <div className="border-t border-rule px-4 pb-3 pt-3 md:border-l md:border-t-0 sm:px-6 sm:pt-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px] text-ink-faint"><span>Last 30 minutes</span><span className="flex gap-3">
              <span>Carts <b className="num font-semibold text-ink">{inr(data.cartValuePaise)}</b></span>
              <span><Icon name="phone" className="mr-0.5 inline h-3 w-3" /><b className="num font-semibold text-ink">{data.devices.mobile}</b></span>
              <span><Icon name="overview" className="mr-0.5 inline h-3 w-3" /><b className="num font-semibold text-ink">{data.devices.desktop}</b></span>
            </span></div>
            <Sparkline values={data.history} />
          </div>
        </div>
      </section>

      {/* ---------- where visitors are ---------- */}
      <section className="panel p-0">
        <div className="flex items-center justify-between border-b border-rule px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-semibold">Where visitors are</h2>
          <span className="hidden text-[11.5px] text-ink-faint sm:inline">Each dot is one visitor · <span className="inline-block h-2 w-2 rounded-full bg-ink-faint align-middle" /> mobile <span className="ml-1 inline-block h-2 w-2 rounded-[3px] bg-ink-faint align-middle" /> desktop</span>
        </div>
        <StageMap data={data} />
      </section>

      {/* ---------- visitors + activity ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="panel p-0">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3 sm:px-5">
            <h2 className="text-[14px] font-semibold">Active visitors</h2>
            <span className="num text-[12px] text-ink-faint">{data.total}</span>
          </div>
          {data.visitors.length ? (
            <ul className="max-h-[480px] divide-y divide-rule overflow-y-auto sm:max-h-[420px]">
              {data.visitors.slice().reverse().map((v) => (
                <li key={v.key} className="lv-in flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: `hsl(${v.hue} 55% 52%)` }}>
                    {v.known ? v.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : v.name.slice(-2)}
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ background: STAGE[v.stage].color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {v.known ? (
                      <p className="flex min-w-0 items-center gap-1.5 text-[13px]"><b key={v.name} className="lv-glow truncate font-semibold">{v.name}</b>{v.place && <span key={v.place} className="lv-glow flex min-w-0 items-center gap-0.5 truncate text-[12px] text-ink-soft"><Icon name="route" className="h-3 w-3 shrink-0" />{v.place}</span>}</p>
                    ) : <p className="truncate text-[13px] font-medium">{v.page}</p>}
                    <p className="truncate text-[11.5px] text-ink-faint">{v.stage === "checkout" && v.step ? `On ${STEP[v.step as 1 | 2 | 3]} · ` : ""}{v.source} · {v.device === "desktop" ? "Desktop" : "Mobile"}{v.stage !== "checkout" ? ` · ${v.pages} page${v.pages === 1 ? "" : "s"}` : ""}{v.cartQty ? ` · ${v.cartQty} in cart${v.cartPaise ? ` (${inr(v.cartPaise)})` : ""}` : ""}</p>
                  </div>
                  <span className="hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline" style={{ color: STAGE[v.stage].color, background: `${STAGE[v.stage].color}14` }}>{STAGE[v.stage].label}</span>
                  <span className="num w-12 shrink-0 text-right text-[11px] text-ink-faint sm:w-14 sm:text-[11.5px]">{ago(t - v.since)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty />}
        </section>

        <section className="panel p-0">
          <div className="border-b border-rule px-4 py-3 sm:px-5"><h2 className="text-[14px] font-semibold">Live activity</h2></div>
          {data.events.length ? (
            <ol className="max-h-[360px] overflow-y-auto px-4 py-3 sm:max-h-[420px] sm:px-5">
              {data.events.map((e) => (
                <li key={e.id} className="lv-drop relative flex gap-3 pb-3 last:pb-0">
                  <span className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: EVT[e.kind].bg, color: EVT[e.kind].fg }}>
                    <Icon name={EVT[e.kind].icon} className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium leading-tight">{e.text}</p>
                    {e.sub && <p className="truncate text-[11.5px] text-ink-faint">{e.sub}</p>}
                    {e.kind === "left" && <Link to="/dashboard/orders/abandoned" className="text-[11.5px] font-medium text-[#005bd3] hover:underline">Saved in abandoned checkouts →</Link>}
                  </div>
                  <span className="num shrink-0 text-[11px] text-ink-faint">{ago(t - e.at)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="px-5 py-8 text-center text-[12.5px] text-ink-faint">New visitors, add-to-carts, checkouts and orders show up here as they happen.</p>}
        </section>
      </div>

      {/* ---------- pages + sources ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Bars title="Top pages right now" rows={data.pages} total={data.total} color="#0e9f9a" />
        <Bars title="Where they came from" rows={data.sources} total={data.total} color="#5b6cf0" />
      </div>
    </div>
  );
}

const EVT = {
  join: { icon: "user", bg: "#eef0fe", fg: "#4453d6" },
  cart: { icon: "cart", bg: "#fff3dc", fg: "#a96f00" },
  checkout: { icon: "rupee", bg: "#e3f1ea", fg: "#1f6f4a" },
  order: { icon: "check", bg: "#1f8f5f", fg: "#ffffff" },
  details: { icon: "user", bg: "#e6f4f3", fg: "#0b7c77" },
  left: { icon: "alert", bg: "#fdeceb", fg: "#b42318" },
} as const;

function Radar({ on }: { on: boolean }) {
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center sm:h-16 sm:w-16">
      {on && [0, 1, 2].map((i) => <span key={i} className="lv-ring absolute inset-0 rounded-full border-2 border-[#1f8f5f]" style={{ animationDelay: `${i * 0.8}s` }} />)}
      <span className={`relative flex h-9 w-9 items-center justify-center rounded-full ${on ? "bg-[#1f8f5f] text-white shadow-[0_0_0_6px_rgba(31,143,95,.12)]" : "bg-black/5 text-ink-faint"}`}>
        <Icon name="eye" className="h-[18px] w-[18px]" />
      </span>
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 300, H = 70, max = Math.max(3, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 6 - (v / max) * (H - 16)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[78px] w-full overflow-visible" aria-label="Visitors over the last 30 minutes">
        <defs>
          <linearGradient id="lv-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#1f8f5f" stopOpacity=".22" /><stop offset="100%" stopColor="#1f8f5f" stopOpacity="0" /></linearGradient>
        </defs>
        {[0.33, 0.66].map((k) => <line key={k} x1="0" x2={W} y1={H * k} y2={H * k} stroke="currentColor" className="text-black/[.05]" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />)}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#lv-area)" className="lv-fade" />
        <path d={line} fill="none" stroke="#1f8f5f" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="lv-draw" pathLength={1} />
      </svg>
      <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2" style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 78}px` }}>
        <span className="lv-ping absolute inset-0 rounded-full bg-[#1f8f5f]" /><span className="absolute inset-0 rounded-full border-2 border-white bg-[#1f8f5f]" />
      </span>
      <div className="mt-1 flex justify-between text-[10.5px] text-ink-faint"><span>30 min ago</span><span>15 min</span><span>Now</span></div>
    </div>
  );
}

function StageMap({ data }: { data: LiveSnapshot }) {
  const max = Math.max(1, ...ORDER.map((s) => data.stages[s]));
  return (
    <>
    {/* Phones: one row per stage, dots moving along a track */}
    <ul className="divide-y divide-rule sm:hidden">
      {ORDER.map((s) => {
        const dots = data.visitors.filter((v) => v.stage === s);
        const n = data.stages[s];
        return (
          <li key={s} className="flex items-center gap-3 px-4 py-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STAGE[s].color }} />
            <span className="w-[104px] shrink-0 truncate text-[12.5px] font-medium text-ink-soft">{STAGE[s].label}</span>
            <span className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-black/[.035]">
              <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${(n / max) * 100}%`, background: `${STAGE[s].color}1f` }} />
              {dots.slice(0, 24).map((v) => {
                const hx = hash(v.key);
                return <span key={v.key} className="lv-dot absolute top-1/2 -mt-[5px]" style={{ left: `${6 + hx * 86}%` }}>
                  <span className={`lv-float block h-2.5 w-2.5 ${v.device === "desktop" ? "rounded-[3px]" : "rounded-full"}`} style={{ background: STAGE[s].color, animationDelay: `${-hx * 3}s` }} />
                </span>;
              })}
            </span>
            <span className="w-7 shrink-0 text-right text-[16px] font-semibold leading-none" style={{ color: n ? STAGE[s].color : undefined }}><AnimatedNumber value={n} /></span>
          </li>
        );
      })}
    </ul>
    <div className="hidden grid-cols-5 sm:grid">
      {ORDER.map((s, i) => {
        const dots = data.visitors.filter((v) => v.stage === s);
        return (
          <div key={s} className={`relative min-w-0 ${i ? "border-l border-rule" : ""}`}>
            <div className="px-3 pt-3 sm:px-4">
              <p className="truncate text-[11.5px] font-medium text-ink-soft">{STAGE[s].label}</p>
              <p className="mt-0.5 text-[22px] font-semibold leading-none" style={{ color: data.stages[s] ? STAGE[s].color : undefined }}><AnimatedNumber value={data.stages[s]} /></p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/[.05]"><div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${(data.stages[s] / max) * 100}%`, background: STAGE[s].color }} /></div>
            </div>
            <div className="relative h-[120px] overflow-hidden">
              {dots.map((v) => {
                const hx = hash(v.key), hy = hash(v.key + "y");
                return (
                  <span key={v.key} className="lv-dot absolute" style={{ left: `${10 + hx * 78}%`, top: `${12 + hy * 70}%` }} title={`${v.page} · ${v.source}`}>
                    <span className={`lv-float block h-2.5 w-2.5 ${v.device === "desktop" ? "rounded-[3px]" : "rounded-full"}`} style={{ background: STAGE[s].color, boxShadow: `0 0 0 3px ${STAGE[s].color}22`, animationDelay: `${-hx * 3}s` }} />
                  </span>
                );
              })}
              {i < ORDER.length - 1 && <Icon name="chevron" className="absolute -right-1.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 -rotate-90 rounded-full bg-paper-raised text-ink-faint" />}
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

function Bars({ title, rows, total, color }: { title: string; rows: { label: string; n: number }[]; total: number; color: string }) {
  return (
    <section className="panel p-0">
      <div className="border-b border-rule px-4 py-3 sm:px-5"><h2 className="text-[14px] font-semibold">{title}</h2></div>
      {rows.length ? (
        <ul className="space-y-2.5 px-4 py-4 sm:px-5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-center justify-between gap-3 text-[12.5px]"><span className="truncate">{r.label}</span><span className="num shrink-0 text-ink-soft">{r.n}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[.05]"><div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${(r.n / Math.max(1, total)) * 100}%`, background: color }} /></div>
            </li>
          ))}
        </ul>
      ) : <p className="px-5 py-8 text-center text-[12.5px] text-ink-faint">Nothing yet.</p>}
    </section>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center px-5 py-10 text-center">
      <span className="relative flex h-14 w-14 items-center justify-center">
        <span className="lv-ring absolute inset-0 rounded-full border-2 border-black/10" />
        <span className="lv-ring absolute inset-0 rounded-full border-2 border-black/10" style={{ animationDelay: "1.2s" }} />
        <Icon name="eye" className="h-5 w-5 text-ink-faint" />
      </span>
      <p className="mt-3 text-[13px] font-medium">No one on your store right now</p>
      <p className="mt-1 max-w-xs text-[12px] text-ink-faint">Visitors appear here within a few seconds of opening your website or checkout.</p>
    </div>
  );
}

const CSS = `
@keyframes lv-ring { 0% { transform: scale(.55); opacity: .55 } 100% { transform: scale(1.35); opacity: 0 } }
@keyframes lv-ping { 0% { transform: scale(1); opacity: .6 } 100% { transform: scale(3); opacity: 0 } }
@keyframes lv-blink { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }
@keyframes lv-bump { 0% { transform: translateY(0) } 30% { transform: translateY(-3px); color: #1f8f5f } 100% { transform: translateY(0) } }
@keyframes lv-in { from { opacity: 0; transform: translateX(-10px); background: rgba(31,143,95,.07) } to { opacity: 1; transform: none; background: transparent } }
@keyframes lv-drop { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: none } }
@keyframes lv-pop { 0% { transform: scale(0) } 70% { transform: scale(1.5) } 100% { transform: scale(1) } }
@keyframes lv-float { 0%, 100% { transform: translate(0, 0) } 33% { transform: translate(3px, -4px) } 66% { transform: translate(-3px, 2px) } }
@keyframes lv-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes lv-glow { 0% { background: rgba(31,143,95,.18); border-radius: 4px } 100% { background: transparent } }
@keyframes lv-fade { from { opacity: 0 } to { opacity: 1 } }
.lv-hero { background: radial-gradient(120% 140% at 0% 0%, rgba(31,143,95,.07), transparent 55%), #fff; }
.lv-ring { animation: lv-ring 2.4s cubic-bezier(.2,.6,.3,1) infinite; }
.lv-ping { animation: lv-ping 1.6s ease-out infinite; }
.lv-blink { animation: lv-blink 1.4s ease-in-out infinite; }
.lv-bump { animation: lv-bump .6s ease-out; }
.lv-in { animation: lv-in .55s ease-out both; }
.lv-drop { animation: lv-drop .45s ease-out both; }
.lv-dot { transition: left .9s cubic-bezier(.3,.7,.2,1), top .9s cubic-bezier(.3,.7,.2,1); animation: lv-pop .5s ease-out both; }
.lv-float { animation: lv-float 3.4s ease-in-out infinite; }
.lv-draw { stroke-dasharray: 1; animation: lv-draw 1.1s ease-out both; }
.lv-fade { animation: lv-fade 1.1s ease-out both; }
.lv-glow { animation: lv-glow 1.6s ease-out; padding: 0 2px; margin: 0 -2px; }
@media (prefers-reduced-motion: reduce) { .lv-ring, .lv-ping, .lv-blink, .lv-bump, .lv-in, .lv-drop, .lv-dot, .lv-float, .lv-draw, .lv-fade, .lv-glow { animation: none !important; transition: none !important; } }
`;

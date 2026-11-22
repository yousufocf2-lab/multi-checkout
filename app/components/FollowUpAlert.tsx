// Yellow, nudging reminder when a follow-up call is due. One order at a time (the oldest due first); calling or
// copying the number from it is a call attempt and brings up the next one. Shows on every dashboard page.
import { Link } from "@remix-run/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";

type Due = { id: string; name: string; customer: string; city: string; total: number; cod: boolean; followUpAt: string; note: string; items: string; link: string };

const inr = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
function late(iso: string, now: number) {
  const m = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min late`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m late` : `${Math.floor(h / 24)}d late`;
}
const spaced = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.17);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch { /* sound blocked until the page is used; the card still shows */ }
}

export function FollowUpAlert() {
  const [items, setItems] = useState<Due[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [small, setSmall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ id: string; phone: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastTop = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/follow-ups-due", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (r.ok) setItems(((await r.json()) as { items: Due[] }).items ?? []);
    } catch { /* offline: try again on the next tick */ }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { setNow(Date.now()); void load(); }, 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const queue = items.filter((i) => !done.has(i.id));
  const top = queue[0] ?? null;
  useEffect(() => {
    if (top && top.id !== lastTop.current) { setSmall(false); setError(null); beep(); }
    lastTop.current = top?.id ?? null;
  }, [top]);

  if (!top) return null;

  // Every copy / call from here is one call attempt; the next due follow-up then takes its place
  const attempt = async (call: boolean) => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.set("orderId", top.id);
      const r = await fetch("/api/follow-ups-due", { method: "POST", body: fd, credentials: "same-origin" });
      const d = (await r.json()) as { phone?: string; error?: string };
      if (!d.phone) { setError(d.error ?? "Couldn't get the number."); return; }
      let copied = false;
      if (!call) { try { await navigator.clipboard.writeText(d.phone); copied = true; } catch { /* number stays on screen */ } }
      setShown({ id: top.id, phone: d.phone, copied });
      if (call) window.location.href = `tel:+91${d.phone}`;
    } catch { setError("No connection. Try again."); } finally { setBusy(false); }
  };
  const next = () => { setDone((s) => new Set(s).add(top.id)); setShown(null); void load(); };
  const mine = shown?.id === top.id ? shown : null;
  const more = queue.length - 1;

  if (small) return (
    <button type="button" onClick={() => setSmall(false)}
      className="followup-nudge fixed bottom-[84px] right-3 z-[60] flex items-center gap-2 rounded-full bg-[#FFE45C] px-4 py-2.5 text-[13px] font-bold text-ink shadow-[0_10px_30px_-8px_rgba(0,0,0,.45)] ring-2 ring-black/10 lg:bottom-6 lg:right-6">
      <span className="h-2 w-2 animate-ping rounded-full bg-red-500" />
      <Icon name="phone" className="h-4 w-4" /> {queue.length} follow-up{queue.length === 1 ? "" : "s"} due
    </button>
  );

  return (
    <div role="alertdialog" aria-live="assertive" aria-label={`Follow-up call due: ${top.customer}`}
      className="followup-nudge fixed inset-x-3 bottom-[84px] z-[60] mx-auto max-w-[400px] rounded-2xl bg-[#FFE45C] p-4 text-ink shadow-[0_18px_40px_-12px_rgba(0,0,0,.5)] ring-2 ring-black/10 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[380px]">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" /></span>
        <b className="whitespace-nowrap text-[12px] uppercase tracking-wide">Follow-up due</b>
        <span className="num ml-auto whitespace-nowrap rounded-md bg-black/10 px-1.5 py-0.5 text-[11.5px] font-semibold">{clock(top.followUpAt)} · {late(top.followUpAt, now)}</span>
        <button type="button" onClick={() => setSmall(true)} className="rounded-md p-1 hover:bg-black/10" aria-label="Make it small" title="Make it small">
          <Icon name="minus" className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 text-[17px] font-bold leading-tight">{top.customer}</p>
      <p className="mt-0.5 text-[12.5px] text-ink/75">{top.name}{top.city ? ` · ${top.city}` : ""} · {inr(top.total)}{top.cod ? " COD" : ""}</p>
      {top.items && <p className="mt-1 line-clamp-1 text-[12.5px] text-ink/75">{top.items}</p>}
      {top.note && <p className="mt-1.5 line-clamp-2 rounded-lg bg-white/50 px-2 py-1 text-[12.5px]">“{top.note}”</p>}

      {mine ? (
        <div className="mt-3 rounded-xl bg-white/70 p-3">
          <div className="flex items-center gap-2">
            <a href={`tel:+91${mine.phone}`} className="num text-[18px] font-bold tracking-wide underline-offset-2 hover:underline">{spaced(mine.phone)}</a>
            <span className="ml-auto text-[12px] font-medium text-ink/70">{mine.copied ? "Copied · attempt saved" : "Attempt saved"}</span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <Link to={top.link} onClick={next} className="flex h-10 flex-1 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">Update the order</Link>
            <button type="button" onClick={next} className="flex h-10 items-center justify-center rounded-lg bg-black/10 px-3 text-[13px] font-semibold">{more > 0 ? "Next" : "Done"}</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void attempt(true)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-[14px] font-semibold text-white disabled:opacity-60">
            <Icon name="phone" className="h-4 w-4" /> Call now
          </button>
          <button type="button" disabled={busy} onClick={() => void attempt(false)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-white text-[14px] font-semibold ring-1 ring-black/15 disabled:opacity-60">
            <Icon name="copy" className="h-4 w-4" /> Copy number
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] font-medium text-[#8e1f0b]">{error}</p>}
      {more > 0 && <p className="mt-2 text-[12px] font-medium text-ink/70">{more} more follow-up{more === 1 ? "" : "s"} due after this one</p>}
    </div>
  );
}

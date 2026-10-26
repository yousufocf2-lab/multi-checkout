// Admin side: small tilted reminder for the nearest scheduled demo, pinned top-centre so it never pushes the page.
// The × hides it for 15 minutes, or until the next login.
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { DEMO_MINUTES, demoLabel } from "~/lib/leads";

export type NextDemo = { key: string; name: string; phone: string | null; demoAt: string; more: number };

const HIDE_KEY = "gp:demoHidden";
const HIDE_MS = 15 * 60_000;

function until(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

function hiddenNow(login: string) {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? "null") as { until: number; login: string } | null;
    return Boolean(v && v.login === login && v.until > Date.now());
  } catch { return false; }
}

export function DemoBar({ demo, login }: { demo: NextDemo; login: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [hidden, setHidden] = useState(true); // decided after mount (storage is browser-only)
  useEffect(() => {
    setHidden(hiddenNow(login));
    const t = setInterval(() => { setNow(Date.now()); setHidden(hiddenNow(login)); }, 30_000);
    return () => clearInterval(t);
  }, [login]);
  const left = new Date(demo.demoAt).getTime() - now;
  if (hidden || left < -DEMO_MINUTES * 60_000) return null;
  const live = left <= 0;
  const soon = left <= 15 * 60_000;
  const tone = live ? "bg-emerald-500 text-white" : soon ? "bg-amber-300 text-ink" : "bg-[#FFE45C] text-ink";
  const hide = () => {
    try { localStorage.setItem(HIDE_KEY, JSON.stringify({ until: Date.now() + HIDE_MS, login })); } catch { /* private mode */ }
    setHidden(true);
  };

  return (
    <div className="fixed left-1/2 top-[60px] z-40 -translate-x-1/2 lg:left-[calc(50%+130px)] lg:top-3" role="status">
      <div className={`flex max-w-[calc(100vw-24px)] -rotate-[1.5deg] items-center gap-2 rounded-xl py-1.5 pl-3 pr-1.5 text-xs shadow-[0_8px_20px_-8px_rgba(0,0,0,.35)] ring-1 ring-black/10 transition hover:rotate-0 ${tone}`}>
        <Link to={`/dashboard/leads/${demo.key}`} className="flex min-w-0 items-center gap-2" aria-label={`Next demo with ${demo.name}, ${demoLabel(demo.demoAt)}`}>
          <span className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${live ? "bg-white" : "bg-red-500"}`} />
          <b className="shrink-0 uppercase tracking-wide">{live ? "Demo live" : "Next demo"}</b>
          <span className="num shrink-0 font-bold">{demoLabel(demo.demoAt)}</span>
          <span className="hidden min-w-0 max-w-[140px] truncate opacity-80 sm:inline">{demo.name}</span>
          {!live && <span className="num hidden shrink-0 items-center gap-0.5 font-semibold sm:flex"><Icon name="clock" className="h-3 w-3" />{until(left)}</span>}
          {demo.more > 0 && <span className="shrink-0 rounded-full bg-black/10 px-1.5 text-[10px]">+{demo.more}</span>}
        </Link>
        <button type="button" onClick={hide} className="shrink-0 rounded-md p-1 opacity-70 hover:bg-black/10 hover:opacity-100" aria-label="Hide for 15 minutes" title="Hide for 15 minutes">
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

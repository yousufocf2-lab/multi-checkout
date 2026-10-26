// Admin side: small tilted reminder card for the nearest scheduled demo, pinned to the top-right of every page.
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { DEMO_MINUTES, demoLabel } from "~/lib/leads";

export type NextDemo = { key: string; name: string; phone: string | null; demoAt: string; more: number };

function until(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

export function DemoBar({ demo }: { demo: NextDemo }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const left = new Date(demo.demoAt).getTime() - now;
  if (left < -DEMO_MINUTES * 60_000) return null; // demo is over
  const live = left <= 0;
  const soon = left <= 15 * 60_000;
  const tone = live ? "bg-emerald-500 text-white" : soon ? "bg-amber-300 text-ink" : "bg-[#FFE45C] text-ink";

  return (
    // Phones: pinned under the top bar. Desktop: sticky in the top-right corner of the page, with the page flowing around it.
    <div className="pointer-events-none fixed right-2 top-[62px] z-40 lg:pointer-events-auto lg:sticky lg:right-auto lg:top-4 lg:float-right lg:mb-3 lg:ml-5">
    <Link to={`/dashboard/leads/${demo.key}`} role="status" aria-label={`Upcoming demo with ${demo.name}, ${demoLabel(demo.demoAt)}`}
      className={`pointer-events-auto block w-[150px] rotate-[3deg] rounded-xl px-3 py-2 shadow-[0_10px_24px_-8px_rgba(0,0,0,.35)] ring-1 ring-black/10 transition hover:rotate-0 hover:scale-[1.03] lg:w-[190px] ${tone}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
        <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-white" : "animate-pulse bg-red-500"}`} />
        {live ? "Demo live now" : "Next demo"}
        {demo.more > 0 && <span className="ml-auto rounded-full bg-black/10 px-1.5 text-[10px] normal-case tracking-normal">+{demo.more}</span>}
      </span>
      <span className="num mt-0.5 block text-sm font-bold leading-tight">{demoLabel(demo.demoAt)}</span>
      <span className="block truncate text-xs font-medium opacity-80">{demo.name}</span>
      {!live && <span className="num mt-0.5 flex items-center gap-1 text-[11px] font-semibold"><Icon name="clock" className="h-3 w-3" />{until(left)}</span>}
    </Link>
    </div>
  );
}

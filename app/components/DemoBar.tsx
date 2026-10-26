// Super admin: sticky reminder of the nearest scheduled demo, shown on every dashboard page.
import { Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { DEMO_MINUTES, demoLabel } from "~/lib/leads";

export type NextDemo = { key: string; name: string; phone: string | null; demoAt: string; more: number };

function until(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} hr${m % 60 ? ` ${m % 60} min` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

export function DemoBar({ demo }: { demo: NextDemo }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const at = new Date(demo.demoAt).getTime();
  const left = at - now;
  if (left < -DEMO_MINUTES * 60_000) return null; // demo is over
  const live = left <= 0;
  const soon = left <= 15 * 60_000;
  const tone = live ? "bg-pine text-white" : soon ? "bg-amber-400 text-ink" : "bg-ink text-white";

  return (
    <div className={`sticky top-[57px] z-20 -mx-4 -mt-5 mb-5 shadow-lift sm:-mx-6 lg:top-0 lg:-mx-10 lg:-mt-8 lg:mb-6 ${tone}`} role="status">
      <Link to={`/dashboard/leads/${demo.key}`} className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-sm sm:px-6 lg:px-10">
        <span className="flex items-center gap-1.5 font-semibold">
          <Icon name="calendar" className="h-4 w-4" />{live ? "Demo live now" : "Upcoming demo"}
        </span>
        <span className="num font-semibold">{demoLabel(demo.demoAt)}</span>
        <span className="min-w-0 truncate opacity-90">{demo.name}{demo.phone ? ` · +91 ${demo.phone}` : ""}</span>
        <span className="ml-auto flex items-center gap-2 text-xs font-medium opacity-90">
          {!live && <span className="num">{until(left)}</span>}
          {demo.more > 0 && <span className="rounded-full bg-white/20 px-2 py-px">+{demo.more} more</span>}
          <Icon name="arrow" className="h-3.5 w-3.5" />
        </span>
      </Link>
    </div>
  );
}

// "Visitors by location" next to the live globe: cities and countries, biggest first.
import { Icon } from "./Icons";

type Place = { label: string; cc: string; flag: string; n: number; lat: number | null; lon: number | null };
type Country = { cc: string; flag: string; n: number };

/** Visitors by city (Hyderabad, Telangana · 3) and by country; tapping a place turns the globe to it. */
export function PlacesPanel({ data, onPick }: { data: { places: Place[]; countries: Country[]; unknown: number; total: number }; onPick: (lat: number, lon: number) => void }) {
  const max = Math.max(1, ...data.places.map((p) => p.n));
  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-4 pb-1 pt-3.5 sm:px-5">
        <p className="text-[12px] font-medium text-ink-soft">Visitors by location</p>
        {data.countries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.countries.map((c) => <span key={c.cc} className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11.5px]"><span>{c.flag}</span><span className="text-ink-soft">{c.cc}</span><b className="num font-semibold">{c.n}</b></span>)}
          </div>
        )}
      </div>
      {data.places.length ? (
        <ul className="max-h-[340px] flex-1 space-y-0.5 overflow-y-auto px-2 py-2 sm:px-3">
          {data.places.map((p) => (
            <li key={p.label}>
              <button type="button" disabled={p.lat == null} onClick={() => p.lat != null && p.lon != null && onPick(p.lat, p.lon)}
                className="group w-full rounded-lg px-2 py-1.5 text-left hover:bg-paper disabled:cursor-default">
                <span className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-1.5"><span className="shrink-0">{p.flag || <Icon name="route" className="h-3 w-3 text-ink-faint" />}</span><span className="truncate">{p.label}</span></span>
                  <span className="flex shrink-0 items-center gap-1.5"><b className="num font-semibold">{p.n}</b>{p.lat != null && <Icon name="target" className="h-3 w-3 text-ink-faint opacity-0 transition group-hover:opacity-100" />}</span>
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/[.05]"><span className="block h-full rounded-full bg-[#0ea5e9] transition-[width] duration-700 ease-out" style={{ width: `${(p.n / max) * 100}%` }} /></span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex-1 px-5 py-8 text-center text-[12.5px] text-ink-faint">{data.total ? "Finding where your visitors are…" : "Cities appear here as visitors arrive."}</p>
      )}
      {data.unknown > 0 && data.places.length > 0 && <p className="border-t border-rule px-4 py-2 text-[11.5px] text-ink-faint sm:px-5">{data.unknown} visitor{data.unknown === 1 ? "" : "s"} still being located</p>}
    </div>
  );
}


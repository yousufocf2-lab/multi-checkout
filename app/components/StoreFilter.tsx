import { Form, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

/** Multi-select store filter that writes ?s=1&s=2 into the URL (keeps the date range). */
export function StoreFilter({ stores, selected, max, label = "Stores" }: { stores: { id: number; name: string }[]; selected: number[]; max?: number; label?: string }) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<number[]>(selected);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setPick(selected), [selected.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const keep = [...params.entries()].filter(([k]) => k !== "s" && k !== "store");
  const summary = selected.length === 0 || selected.length === stores.length ? `All stores (${stores.length})`
    : selected.length === 1 ? stores.find((s) => s.id === selected[0])?.name ?? "1 store" : `${selected.length} stores`;
  const toggle = (id: number) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : max && p.length >= max ? p : [...p, id]));

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="inline-flex h-9 min-w-[170px] items-center justify-between gap-2 rounded-lg border border-rule-strong bg-surface px-3 text-sm shadow-sm hover:border-ink/30" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span className="truncate"><span className="text-ink-faint">{label}: </span>{summary}</span>
        <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <Form method="get" preventScrollReset onSubmit={() => setOpen(false)}
          className="absolute right-0 z-30 mt-1.5 w-72 animate-fadein rounded-xl border border-rule bg-white p-2 shadow-lift">
          {keep.map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
          <div className="max-h-64 overflow-y-auto">
            {stores.map((s) => {
              const on = pick.includes(s.id);
              const blocked = !on && Boolean(max && pick.length >= max);
              return (
                <label key={s.id} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${blocked ? "text-ink-faint" : "cursor-pointer hover:bg-paper"}`}>
                  <input type="checkbox" name="s" value={s.id} checked={on} disabled={blocked} onChange={() => toggle(s.id)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                  <span className="truncate">{s.name}</span>
                </label>
              );
            })}
          </div>
          {max && <p className="px-2.5 pt-1 text-xs text-ink-faint">Pick up to {max}.</p>}
          <div className="mt-2 flex justify-between gap-2 border-t border-rule pt-2">
            <button type="button" className="btn-quiet text-xs" onClick={() => setPick(max ? stores.slice(0, max).map((s) => s.id) : [])}>{max ? "Reset" : "All stores"}</button>
            <button className="btn-primary px-3 py-1.5 text-xs">Apply</button>
          </div>
        </Form>
      )}
    </div>
  );
}

export function selectedStoreIds(params: URLSearchParams) {
  const raw = [...params.getAll("s"), ...(params.get("store") ? [params.get("store")!] : [])];
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

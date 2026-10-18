import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

export type PickedProduct = { id: string; title: string; image: string | null };

/** Search the store's Shopify products and pick several. Submits JSON in a hidden input. */
export function ProductPicker({ storeId, name, initial = [], placeholder = "Search products by name" }: {
  storeId: number; name: string; initial?: PickedProduct[]; placeholder?: string;
}) {
  const fetcher = useFetcher<{ products?: { id: string; title: string; image: string | null }[]; error?: string }>();
  const [picked, setPicked] = useState<PickedProduct[]>(initial);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const box = useRef<HTMLDivElement>(null);

  // Close the list on a click/tap outside, or when focus leaves the picker
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    document.addEventListener("focusin", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); document.removeEventListener("focusin", close); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetcher.load(`/dashboard/stores/${storeId}/products?q=${encodeURIComponent(q)}`), 250);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, storeId]);

  const toggle = (p: PickedProduct) =>
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));

  const results = fetcher.data?.products ?? [];

  return (
    <div ref={box}>
      <input type="hidden" name={name} value={JSON.stringify(picked)} />
      {picked.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 rounded-full border border-rule bg-paper py-1 pl-1 pr-2 text-xs">
              {p.image ? <img src={p.image} alt="" className="h-5 w-5 rounded-full object-cover" /> : <span className="h-5 w-5 rounded-full bg-paper-sunk" />}
              <span className="max-w-[180px] truncate">{p.title}</span>
              <button type="button" onClick={() => toggle(p)} className="ml-0.5 text-ink-faint hover:text-bad" aria-label={`Remove ${p.title}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input className="input" placeholder={placeholder} value={q}
          onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); if (e.key === "Escape") setOpen(false); }} />
        {fetcher.state !== "idle" && <span className="absolute right-3 top-3 text-ink-faint"><Spinner /></span>}
      </div>
      {open && (
        <div className="mt-1.5 max-h-64 overflow-auto rounded-lg border border-rule bg-white shadow-lift">
          {fetcher.data?.error && <p className="p-3 text-sm text-bad">{fetcher.data.error}</p>}
          {!fetcher.data?.error && results.length === 0 && fetcher.state === "idle" && (
            <p className="p-3 text-sm text-ink-faint">{fetcher.data ? "No products found" : "Start typing to search"}</p>
          )}
          <ul>
            {results.map((p) => {
              const on = picked.some((x) => x.id === p.id);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => toggle(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-paper">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? "border-brand bg-brand text-white" : "border-rule-strong"}`}>{on ? "✓" : ""}</span>
                    {p.image ? <img src={p.image} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="h-8 w-8 rounded bg-paper-sunk" />}
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end border-t border-rule p-2">
            <button type="button" className="btn-quiet text-xs" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function parsePicked(v: FormDataEntryValue | null): PickedProduct[] {
  try {
    const arr = JSON.parse(String(v ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p) => p && /^\d+$/.test(String(p.id)))
      .slice(0, 200)
      .map((p) => ({ id: String(p.id), title: String(p.title ?? "").slice(0, 200), image: p.image ? String(p.image).slice(0, 500) : null }));
  } catch {
    return [];
  }
}

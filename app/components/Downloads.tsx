// Download buttons for digital products (order page and customer account)
type File = { name: string; bytes: number; url: string };
const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function Downloads({ list, locked, base = "", className = "" }: { list: { itemId: number; title: string; files: File[] }[]; locked: boolean; base?: string; className?: string }) {
  if (locked) {
    return (
      <div className={`rounded-xl border border-rule bg-paper p-4 text-sm ${className}`}>
        <p className="font-semibold">Your downloads</p>
        <p className="mt-1 text-ink-soft">Files unlock here as soon as the payment is confirmed.</p>
      </div>
    );
  }
  if (!list.length) return null;
  return (
    <div className={`rounded-xl border border-[rgb(var(--brand,17_24_39)/.25)] bg-[rgb(var(--brand,17_24_39)/.05)] p-4 ${className}`}>
      <p className="text-sm font-semibold">Your downloads</p>
      <div className="mt-3 space-y-3">
        {list.map((it) => (
          <div key={it.itemId}>
            {list.length > 1 && <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">{it.title}</p>}
            <ul className="space-y-2">
              {it.files.map((f) => (
                <li key={f.url}>
                  <a href={`${base}${f.url}`} download className="flex items-center gap-3 rounded-lg border border-rule bg-white px-3 py-2.5 text-sm hover:border-ink-faint">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-paper text-base" aria-hidden>⬇</span>
                    <span className="min-w-0 flex-1"><span className="line-clamp-1 font-medium">{f.name}</span><span className="text-xs text-ink-faint">{size(f.bytes)}</span></span>
                    <span className="shrink-0 text-xs font-semibold">Download</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-faint">You can download these again any time from this page or your account.</p>
    </div>
  );
}

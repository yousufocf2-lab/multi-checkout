/** Growpefy brand pieces. Artwork lives in /public/brand (SVG, crisp at any size). */
export const BRAND = "Growpefy";

/** Bars + arrow mark. `tile` puts it on a white rounded square (for dark backgrounds). */
export function BrandIcon({ className = "h-7 w-7", tile = false }: { className?: string; tile?: boolean }) {
  if (tile) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-[28%] bg-white p-[14%] shadow-sm ${className}`}>
        <img src="/brand/growpefy-icon.svg" alt="" className="h-full w-full" />
      </span>
    );
  }
  return <img src="/brand/growpefy-icon.svg" alt="" className={`shrink-0 ${className}`} />;
}

/** Icon + "Growpefy" wordmark in one line. Use tone="light" on dark backgrounds. */
export function BrandLockup({ className = "h-7", tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return <img src={tone === "light" ? "/brand/growpefy-lockup-white.svg" : "/brand/growpefy-lockup.svg"} alt={BRAND} className={`w-auto ${className}`} />;
}

/** Animated loader: the bars rise and the arrow shoots up. Respects reduced motion. */
export function BrandLoader({ className = "h-14 w-14", label = "Loading" }: { className?: string; label?: string }) {
  return <img src="/brand/growpefy-loader.svg" alt={label} className={className} />;
}

/** Quiet "Powered by Growpefy" line for customer-facing pages. */
export function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <a href="https://growpefy.com" target="_blank" rel="noopener" className={`inline-flex items-center gap-1.5 text-[11px] text-ink-faint transition hover:text-ink-soft ${className}`}>
      Powered by
      <img src="/brand/growpefy-icon.svg" alt="" className="h-3.5 w-3.5" />
      <span className="font-semibold tracking-tight text-ink-soft">{BRAND}</span>
    </a>
  );
}

/** Full-screen Growpefy loader for actions that take a moment (login, connecting APIs, switching store, exports). */
export function BusyOverlay({ title, note }: { title: string; note?: string }) {
  return (
    <div className="fixed inset-0 z-[90] flex animate-fadein items-center justify-center bg-white/85 px-6 text-center backdrop-blur-[3px]" role="status" aria-live="polite">
      <div className="flex flex-col items-center">
        <BrandLoader className="h-20 w-20" label={title} />
        <p className="mt-4 text-[15px] font-semibold text-ink">{title}</p>
        {note && <p className="mt-1 max-w-xs text-sm text-ink-soft">{note}</p>}
      </div>
    </div>
  );
}

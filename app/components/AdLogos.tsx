// Meta and Google Ads marks (artwork in /public/brand/ads).
export type AdPlatform = "meta" | "google";
export const PLATFORM_NAME: Record<AdPlatform, string> = { meta: "Meta", google: "Google Ads" };

/** Icon only: the Meta infinity / the Google Ads mark. */
export function AdIcon({ p, className = "h-4 w-auto" }: { p: AdPlatform; className?: string }) {
  return <img src={p === "meta" ? "/brand/ads/meta-icon.png" : "/brand/ads/google-ads-icon.png"} alt={PLATFORM_NAME[p]} className={`shrink-0 object-contain ${className}`} />;
}

/** Full logo. Meta uses its wordmark; Google Ads shows its mark + name (the stacked wordmark is unreadable when small). */
export function AdLogo({ p, className = "h-5 w-auto", text = "text-[15px]" }: { p: AdPlatform; className?: string; text?: string }) {
  if (p === "meta") return <img src="/brand/ads/meta.png" alt="Meta" className={`shrink-0 object-contain ${className}`} />;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 ${className}`} aria-label="Google Ads">
      <img src="/brand/ads/google-ads-icon.png" alt="" className="h-full w-auto object-contain" />
      <span className={`whitespace-nowrap font-medium leading-none tracking-tight text-[#5F6368] ${text}`}>Google Ads</span>
    </span>
  );
}

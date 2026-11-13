// Store widgets (Settings → Widgets). Shared by the settings page, the theme editor and the storefront.

export type ReviewModeration = "all" | "none" | "low";
export type ReviewSettings = {
  enabled: boolean;
  /** Star colour on light backgrounds and on dark backgrounds (the theme's background decides which one is used). */
  starLight: string; starDark: string;
  /** Review text colour; empty = the theme's own text colour. */
  textLight: string; textDark: string;
  allowPhotos: boolean; allowVideos: boolean; maxVideoSeconds: number; maxMedia: number;
  /** all = every review waits for approval · none = publish straight away · low = only ratings up to lowUpTo wait */
  moderation: ReviewModeration; lowUpTo: number;
  /** Reviews with photos or videos always wait for approval */
  checkMedia: boolean;
  showVerified: boolean; showDate: boolean; showBreakdown: boolean;
  sort: "newest" | "highest" | "media";
};
export type WidgetSettings = { reviews: ReviewSettings };

export const REVIEW_DEFAULTS: ReviewSettings = {
  enabled: true, starLight: "#15803d", starDark: "#f59e0b", textLight: "", textDark: "",
  allowPhotos: true, allowVideos: true, maxVideoSeconds: 30, maxMedia: 4,
  moderation: "all", lowUpTo: 3, checkMedia: true,
  showVerified: true, showDate: true, showBreakdown: true, sort: "newest",
};

const COLOR = /^#[0-9a-f]{3,8}$/i;
const color = (v: unknown, d: string, empty = false) => (typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : empty && v === "" ? "" : d);
const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function reviewSettings(raw: unknown): ReviewSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ReviewSettings>;
  const d = REVIEW_DEFAULTS;
  return {
    enabled: bool(r.enabled, d.enabled),
    starLight: color(r.starLight, d.starLight), starDark: color(r.starDark, d.starDark),
    textLight: color(r.textLight, "", true), textDark: color(r.textDark, "", true),
    allowPhotos: bool(r.allowPhotos, d.allowPhotos), allowVideos: bool(r.allowVideos, d.allowVideos),
    maxVideoSeconds: num(r.maxVideoSeconds, d.maxVideoSeconds, 5, 120), maxMedia: num(r.maxMedia, d.maxMedia, 1, 8),
    moderation: r.moderation === "none" || r.moderation === "low" ? r.moderation : "all",
    lowUpTo: num(r.lowUpTo, d.lowUpTo, 1, 4),
    checkMedia: bool(r.checkMedia, d.checkMedia),
    showVerified: bool(r.showVerified, d.showVerified), showDate: bool(r.showDate, d.showDate), showBreakdown: bool(r.showBreakdown, d.showBreakdown),
    sort: r.sort === "highest" || r.sort === "media" ? r.sort : "newest",
  };
}

export function widgetSettings(raw: unknown): WidgetSettings {
  const w = (raw && typeof raw === "object" ? raw : {}) as { reviews?: unknown };
  return { reviews: reviewSettings(w.reviews) };
}

/** Does a new review wait for the owner's approval? */
export function needsApproval(s: ReviewSettings, rating: number, hasMedia: boolean) {
  if (hasMedia && s.checkMedia) return true;
  if (s.moderation === "none") return false;
  if (s.moderation === "low") return rating <= s.lowUpTo;
  return true;
}

/** Light or dark background, from a hex colour. */
export function isDark(hex: unknown) {
  const h = typeof hex === "string" ? hex.trim().replace("#", "") : "";
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return false;
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

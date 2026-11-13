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
export type WidgetSettings = { reviews: ReviewSettings; filters: FilterSettings };

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
  const w = (raw && typeof raw === "object" ? raw : {}) as { reviews?: unknown; filters?: unknown };
  return { reviews: reviewSettings(w.reviews), filters: filterSettings(w.filters) };
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

// ---------- Product filters (Storefront → Product filters) ----------

export type FilterType = "price" | "category" | "option" | "availability" | "rating" | "discount" | "vendor" | "type" | "feature" | "tag";
export type FilterDisplay = "checkbox" | "chips" | "swatch" | "list";
export type FilterDef = {
  id: string; type: FilterType; label: string;
  /** option filters: the option name (Colour, Size…); tag filters: the tag prefix ("age:" → "age:3-5 years") */
  key?: string;
  display: FilterDisplay; open: boolean;
};
export type FilterSettings = {
  enabled: boolean;
  layout: "sidebar" | "top" | "drawer";
  side: "left" | "right";
  style: "minimal" | "boxed" | "pills";
  mobile: "sheet" | "drawer";
  showCounts: boolean; hideEmpty: boolean; maxValues: number;
  showSort: boolean; sorts: string[];
  priceBands: number[]; // rupees
  filters: FilterDef[];
};

export const SORTS: [string, string][] = [
  ["featured", "Featured"], ["newest", "Newest first"], ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"],
  ["discount", "Biggest discount"], ["rating", "Top rated"], ["name", "Name A–Z"],
];
export const FILTER_TYPES: { type: FilterType; label: string; needsKey?: "option" | "tag"; displays: FilterDisplay[] }[] = [
  { type: "price", label: "Price", displays: ["checkbox", "chips"] },
  { type: "category", label: "Category", displays: ["checkbox", "chips", "list"] },
  { type: "option", label: "Variant option (Colour, Size, Age…)", needsKey: "option", displays: ["checkbox", "chips", "swatch"] },
  { type: "availability", label: "In stock only", displays: ["checkbox"] },
  { type: "rating", label: "Customer rating", displays: ["checkbox", "chips"] },
  { type: "discount", label: "Discount", displays: ["checkbox", "chips"] },
  { type: "vendor", label: "Brand", displays: ["checkbox", "chips", "list"] },
  { type: "type", label: "Product type", displays: ["checkbox", "chips", "list"] },
  { type: "feature", label: "Feature chips", displays: ["checkbox", "chips"] },
  { type: "tag", label: "Tags with a prefix (age:, material:…)", needsKey: "tag", displays: ["checkbox", "chips"] },
];

export const FILTER_DEFAULTS: FilterSettings = {
  enabled: true, layout: "sidebar", side: "left", style: "minimal", mobile: "sheet",
  showCounts: true, hideEmpty: true, maxValues: 6,
  showSort: true, sorts: ["featured", "newest", "price-asc", "price-desc", "discount", "rating"],
  priceBands: [499, 999, 1999, 4999],
  filters: [
    { id: "price", type: "price", label: "Price", display: "checkbox", open: true },
    { id: "category", type: "category", label: "Category", display: "checkbox", open: true },
    { id: "colour", type: "option", key: "Colour", label: "Colour", display: "swatch", open: true },
    { id: "age", type: "tag", key: "age", label: "Age", display: "chips", open: true },
    { id: "size", type: "option", key: "Size", label: "Size", display: "chips", open: false },
    { id: "rating", type: "rating", label: "Rating", display: "checkbox", open: false },
    { id: "stock", type: "availability", label: "Availability", display: "checkbox", open: false },
  ],
};

const ID_RE = /^[a-z0-9-]{1,30}$/;
export function filterSettings(raw: unknown): FilterSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FilterSettings>;
  const d = FILTER_DEFAULTS;
  const types = new Set(FILTER_TYPES.map((t) => t.type));
  const sortIds = new Set(SORTS.map((s) => s[0]));
  const seen = new Set<string>();
  const filters = (Array.isArray(r.filters) ? r.filters : d.filters).flatMap((f): FilterDef[] => {
    if (!f || !types.has(f.type)) return [];
    let id = String(f.id ?? f.type).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 30) || f.type;
    if (!ID_RE.test(id) || seen.has(id)) id = `${f.type}-${seen.size + 1}`;
    seen.add(id);
    const meta = FILTER_TYPES.find((t) => t.type === f.type)!;
    const display = meta.displays.includes(f.display) ? f.display : meta.displays[0];
    const key = meta.needsKey ? String(f.key ?? "").trim().slice(0, 40) : undefined;
    if (meta.needsKey && !key) return [];
    return [{ id, type: f.type, label: String(f.label ?? meta.label).trim().slice(0, 40) || meta.label, ...(key ? { key } : {}), display, open: f.open !== false }];
  }).slice(0, 16);
  const bands = (Array.isArray(r.priceBands) ? r.priceBands : d.priceBands).map((n) => Math.round(Number(n))).filter((n) => n > 0 && n < 10_000_000).sort((a, b) => a - b);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    layout: r.layout === "top" || r.layout === "drawer" ? r.layout : "sidebar",
    side: r.side === "right" ? "right" : "left",
    style: r.style === "boxed" || r.style === "pills" ? r.style : "minimal",
    mobile: r.mobile === "drawer" ? "drawer" : "sheet",
    showCounts: typeof r.showCounts === "boolean" ? r.showCounts : d.showCounts,
    hideEmpty: typeof r.hideEmpty === "boolean" ? r.hideEmpty : d.hideEmpty,
    maxValues: Math.min(30, Math.max(3, Math.round(Number(r.maxValues) || d.maxValues))),
    showSort: typeof r.showSort === "boolean" ? r.showSort : d.showSort,
    sorts: (Array.isArray(r.sorts) ? r.sorts : d.sorts).filter((s) => sortIds.has(s)).slice(0, 7),
    priceBands: [...new Set(bands)].slice(0, 8),
    filters,
  };
}

import type { FilterDef, FilterSettings } from "~/lib/widgets";
import { SORTS } from "~/lib/widgets";

/** The bits of a product drop the filters read. */
type FP = {
  id: number; title: string; price: number; compare_at_price: number; available: boolean; discount_pct: number;
  rating: number; vendor: string; product_type: string; chips: string[]; tags?: string[]; categories?: string[];
  options: { name: string; values: string[] }[]; variants: { option_values: string[]; available: boolean }[];
};
type Val = { value: string; label: string; count: number; active: boolean; swatch?: string };

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const COLOUR_WORDS: Record<string, string> = {
  black: "#111", white: "#fff", grey: "#9ca3af", gray: "#9ca3af", silver: "#c0c4cc", gold: "#d4a537", red: "#dc2626", maroon: "#7f1d1d",
  pink: "#f472b6", rose: "#f9a8b8", orange: "#f97316", yellow: "#facc15", mustard: "#d4a017", green: "#16a34a", olive: "#6b7f2a", mint: "#a7f3d0",
  teal: "#0d9488", blue: "#2563eb", navy: "#1e2a5a", sky: "#7dd3fc", purple: "#7c3aed", lavender: "#c4b5fd", violet: "#8b5cf6", brown: "#7c4a26",
  beige: "#e8dcc4", cream: "#f5efdc", ivory: "#fffbeb", tan: "#d2b48c", khaki: "#c3b091", peach: "#fbc7a4", coral: "#fb7f6b", wine: "#6b1d2f",
  graphite: "#4b5563", onyx: "#151515", charcoal: "#36454f", slate: "#64748b", sage: "#9caf88", sand: "#d8c3a5", stone: "#a8a29e", lilac: "#c8a2c8",
  plum: "#8e4585", ruby: "#9b111e", emerald: "#10b981", mocha: "#6f4e37", denim: "#1560bd", wood: "#a0703c", wooden: "#a0703c", natural: "#e4d3b4",
  multi: "conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#c084fc,#f87171)", rainbow: "conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#c084fc,#f87171)",
};
function swatchOf(v: string) {
  const words = v.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) if (COLOUR_WORDS[words[i]]) return COLOUR_WORDS[words[i]];
  return /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : "";
}
const sameOption = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/colour/g, "color").replace(/[^a-z0-9]/g, "");
  return n(a) === n(b);
};

function bands(fs: FilterSettings) {
  const out: { value: string; label: string; lo: number; hi: number }[] = [];
  let lo = 0;
  for (const b of fs.priceBands) { out.push({ value: `${lo}-${b}`, label: lo === 0 ? `Under ${rupees(b)}` : `${rupees(lo)} – ${rupees(b)}`, lo, hi: b }); lo = b; }
  out.push({ value: `${lo}-`, label: lo === 0 ? "Any price" : `${rupees(lo)} & above`, lo, hi: Infinity });
  return out;
}

/** Every value a product has for one filter. */
function valuesOf(p: FP, f: FilterDef, fs: FilterSettings): string[] {
  switch (f.type) {
    case "price": { const r = p.price / 100; return bands(fs).filter((b) => r >= b.lo && r < b.hi).map((b) => b.value); }
    case "category": return p.categories ?? [];
    case "option": {
      const idx = p.options.findIndex((o) => sameOption(o.name, f.key ?? ""));
      if (idx < 0) return [];
      const live = p.variants.filter((v) => v.available);
      return [...new Set((live.length ? live : p.variants).map((v) => v.option_values[idx]).filter(Boolean))];
    }
    case "availability": return p.available ? ["in-stock"] : [];
    case "rating": return ["4", "3", "2"].filter((n) => p.rating >= Number(n));
    case "discount": return ["50", "40", "25", "10"].filter((n) => p.discount_pct >= Number(n));
    case "vendor": return p.vendor ? [p.vendor] : [];
    case "type": return p.product_type ? [p.product_type] : [];
    case "feature": return p.chips ?? [];
    case "tag": {
      const pre = (f.key ?? "").toLowerCase().replace(/:?$/, ":");
      return (p.tags ?? []).filter((t) => t.toLowerCase().startsWith(pre)).map((t) => t.slice(pre.length).trim()).filter(Boolean);
    }
  }
}

function labelOf(f: FilterDef, v: string, fs: FilterSettings, cats: Map<string, string>) {
  if (f.type === "price") return bands(fs).find((b) => b.value === v)?.label ?? v;
  if (f.type === "category") return cats.get(v) ?? v;
  if (f.type === "availability") return "In stock only";
  if (f.type === "rating") return `${v}★ & above`;
  if (f.type === "discount") return `${v}% off or more`;
  return v;
}

const ORDER: Partial<Record<FilterDef["type"], string[]>> = { rating: ["4", "3", "2"], discount: ["10", "25", "40", "50"] };

/**
 * Filters and sorts a category/search page from the URL (f.<filter id>=value, sort=…),
 * and builds the facet list the theme shows: counts, active values and remove links.
 */
export function applyFilters<T extends FP>(
  products: T[], fs: FilterSettings, url: URL, opts: { base: string; keep?: string[]; categories?: { handle: string; title: string }[]; layout?: string },
) {
  const cats = new Map((opts.categories ?? []).map((c) => [c.handle, c.title]));
  const priceMin = Number(url.searchParams.get("price_min")) || 0;
  const priceMax = Number(url.searchParams.get("price_max")) || 0;
  const picked = new Map<string, Set<string>>();
  for (const f of fs.filters) {
    const vals = url.searchParams.getAll(`f.${f.id}`).map((v) => v.slice(0, 80)).filter(Boolean);
    if (vals.length) picked.set(f.id, new Set(vals));
  }
  const vcache = new Map<string, string[]>();
  const vals = (p: T, f: FilterDef) => { const k = `${p.id}|${f.id}`; let v = vcache.get(k); if (!v) { v = valuesOf(p, f, fs); vcache.set(k, v); } return v; };
  const priceOk = (p: T) => (!priceMin || p.price / 100 >= priceMin) && (!priceMax || p.price / 100 <= priceMax);
  const matches = (p: T, skip?: string) => priceOk(p) && fs.filters.every((f) => {
    if (f.id === skip) return true;
    const sel = picked.get(f.id);
    return !sel || vals(p, f).some((v) => sel.has(v));
  });

  // Keep extra params (search text, preview flags) on every link
  const keep = new URLSearchParams();
  for (const k of opts.keep ?? []) { const v = url.searchParams.get(k); if (v) keep.set(k, v); }
  const sort = SORTS.some((s) => s[0] === url.searchParams.get("sort")) ? url.searchParams.get("sort")! : "featured";
  const link = (mut: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(keep);
    for (const [id, set] of picked) for (const v of set) q.append(`f.${id}`, v);
    if (priceMin) q.set("price_min", String(priceMin));
    if (priceMax) q.set("price_max", String(priceMax));
    if (sort !== "featured") q.set("sort", sort);
    mut(q);
    const s = q.toString();
    return s ? `${opts.base}?${s}` : opts.base;
  };

  const groups = fs.filters.map((f) => {
    const sel = picked.get(f.id) ?? new Set<string>();
    const pool = products.filter((p) => matches(p, f.id));
    const counts = new Map<string, number>();
    const all = new Set<string>();
    for (const p of products) for (const v of vals(p, f)) all.add(v);
    for (const p of pool) for (const v of vals(p, f)) counts.set(v, (counts.get(v) ?? 0) + 1);
    let keys = [...all];
    if (f.type === "price") keys = bands(fs).map((b) => b.value).filter((v) => all.has(v));
    else if (ORDER[f.type]) keys = ORDER[f.type]!.filter((v) => all.has(v));
    else if (f.type === "category") keys.sort((a, b) => (cats.get(a) ?? a).localeCompare(cats.get(b) ?? b));
    else if (f.type !== "option") keys.sort((a, b) => a.localeCompare(b));
    const param = `f.${f.id}`;
    const toggle = (v: string) => link((q) => { const rest = q.getAll(param).filter((x) => x !== v); q.delete(param); for (const r of rest) q.append(param, r); if (!sel.has(v)) q.append(param, v); });
    const values: (Val & { url: string })[] = keys.map((v) => ({ value: v, label: labelOf(f, v, fs, cats), count: counts.get(v) ?? 0, active: sel.has(v), url: toggle(v), ...(f.display === "swatch" ? { swatch: swatchOf(v) } : {}) }))
      .filter((v) => v.active || !fs.hideEmpty || v.count > 0);
    return {
      id: f.id, label: f.label, type: f.type, display: f.display, open: f.open || sel.size > 0, param,
      values, active_count: sel.size, max: fs.maxValues, has_more: values.length > fs.maxValues,
      ...(f.type === "price" ? { min: priceMin || "", max_price: priceMax || "" } : {}),
    };
  }).filter((g) => g.values.length > 0 && (g.type !== "category" || g.values.length > 1 || g.active_count > 0));

  const active = groups.flatMap((g) => g.values.filter((v) => v.active).map((v) => ({
    group: g.label, label: v.label,
    remove_url: link((q) => { const rest = q.getAll(g.param).filter((x) => x !== v.value); q.delete(g.param); for (const r of rest) q.append(g.param, r); }),
  })));
  if (priceMin || priceMax) active.push({ group: "Price", label: priceMin && priceMax ? `${rupees(priceMin)} – ${rupees(priceMax)}` : priceMin ? `From ${rupees(priceMin)}` : `Up to ${rupees(priceMax)}`, remove_url: link((q) => { q.delete("price_min"); q.delete("price_max"); }) });

  const shown = products.filter((p) => matches(p));
  const by: Record<string, (a: T, b: T) => number> = {
    newest: (a, b) => Math.abs(b.id) - Math.abs(a.id), "price-asc": (a, b) => a.price - b.price, "price-desc": (a, b) => b.price - a.price,
    discount: (a, b) => b.discount_pct - a.discount_pct, rating: (a, b) => b.rating - a.rating, name: (a, b) => a.title.localeCompare(b.title),
  };
  if (by[sort]) shown.sort(by[sort]);

  const keepFields = [...keep.entries()].map(([name, value]) => ({ name, value }));
  return {
    products: shown,
    filters: {
      enabled: fs.enabled && groups.length > 0, layout: opts.layout && ["sidebar", "top", "drawer"].includes(opts.layout) ? opts.layout : fs.layout,
      side: fs.side, style: fs.style, mobile: fs.mobile, show_counts: fs.showCounts,
      groups, active, active_count: active.length, clear_url: link((q) => { for (const k of [...q.keys()]) if (k.startsWith("f.") || k === "price_min" || k === "price_max") q.delete(k); }),
      action: opts.base, keep: keepFields, total: shown.length, all_total: products.length,
      show_sort: fs.showSort && fs.sorts.length > 1,
      sort: { current: sort, options: SORTS.filter(([v]) => fs.sorts.includes(v) || v === sort).map(([value, label]) => ({ value, label, active: value === sort, url: link((q) => { if (value === "featured") q.delete("sort"); else q.set("sort", value); }) })) },
      sort_value: sort === "featured" ? "" : sort,
    },
  };
}

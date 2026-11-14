// Growpefy Store storefront: renders a store's website from a Liquid theme (Shopify OS 2.0 style:
// layout + JSON templates listing sections, each section a Liquid file with a {% schema %} of settings).
// Themes ship in app/themes/<name>; later a store's own copy (edited in "Edit code") will live in the database.
import { Liquid, Tag, type Context, type Emitter, type TagToken, type TopLevelToken } from "liquidjs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { coverOf } from "./catalog.server";
import { menusForTheme } from "./menus.server";
import { footerPages } from "./store-pages.server";
import { renderCustomLiquid } from "./custom-liquid.server";
import { allProductsPath, categoryPath, productPath } from "./storefront-paths";
import { accountSettings } from "./customer-accounts";
import { storeIcon } from "./store-icon";
import { isDark, widgetSettings } from "./widgets";
import { PLAY_CATEGORIES, PLAY_FAQS, PLAY_PRODUCTS, playImg } from "./playday-demo";
import { PULSE_CATEGORIES, PULSE_FAQS, PULSE_PRODUCTS, pulseImg } from "./pulse-demo";

const accountsOn = (s: Store) => accountSettings(s.accountSettings).enabled;
import { catalogCategories, catalogCategoryItems, catalogItems, catalogVariants, db, productReviews, stores, storeThemes, type CatalogItem, type CatalogVariant, type Store, type ThemeData, type ThemeTemplate } from "~/db.server";

// ---------- theme files ----------

const RAW = import.meta.glob("../themes/*/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** theme name -> { "sections/hero.liquid": "...", ... } */
const THEMES: Record<string, Record<string, string>> = {};
for (const [path, text] of Object.entries(RAW)) {
  const m = path.match(/^\.\.\/themes\/([^/]+)\/(.+)$/);
  if (m) (THEMES[m[1]] ??= {})[m[2]] = text;
}

/** Theme folders that ship with Growpefy. */
export const THEME_NAMES = Object.keys(THEMES);
export const BASE_THEME = "swift";
/** Which theme renders a saved design: its own "theme" field when that theme exists, else Swift. */
export function themeOf(data: { theme?: unknown } | null | undefined): string {
  const t = typeof data?.theme === "string" ? data.theme : "";
  return t && THEMES[t] ? t : BASE_THEME;
}

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
type SchemaSetting = { id: string; default?: unknown };
function schemaOf(src: string): { name?: string; category?: string; description?: string; requires?: string; settings?: SchemaSetting[] } {
  const m = src.match(SCHEMA_RE);
  if (!m) return {};
  try { return JSON.parse(m[1]); } catch { return {}; }
}
const stripSchema = (src: string) => src.replace(SCHEMA_RE, "");

// ---------- engine ----------

const engines = new Map<string, Liquid>();

function engineFor(theme: string): Liquid {
  const cached = engines.get(theme);
  if (cached) return cached;
  const files = THEMES[theme];
  if (!files) throw new Error(`Theme not found: ${theme}`);
  const read = (f: string) => {
    const key = f.replace(/^\/+/, "");
    if (!(key in files)) throw new Error(`Theme file not found: ${key}`);
    return stripSchema(files[key]);
  };
  const liquid = new Liquid({
    root: [""], extname: ".liquid", cache: true, strictFilters: false, strictVariables: false, jsTruthy: false,
    fs: {
      exists: async (f) => f.replace(/^\/+/, "") in files,
      existsSync: (f) => f.replace(/^\/+/, "") in files,
      readFile: async (f) => read(f),
      readFileSync: (f) => read(f),
      resolve: (_dir, file, ext) => (file.endsWith(ext) ? file : file + ext),
      contains: async () => true,
      containsSync: () => true,
      sep: "/",
      dirname: (f) => f.split("/").slice(0, -1).join("/"),
    },
  });

  liquid.registerFilter("money", (paise: unknown) => formatMoney(Number(paise) || 0));
  liquid.registerFilter("img_url", (url: unknown, width?: unknown) => imgUrl(String(url ?? ""), Number(width) || 0));
  liquid.registerFilter("asset_content", (name: unknown) => files[`assets/${String(name)}`] ?? "");
  // Links from section settings: only web, mail, phone and in-store paths (never javascript: and the like)
  // Store paths ("/products/all") get the preview prefix (/s/<store>) when the site is shown on growpefy.com
  liquid.registerFilter("safe_url", function (this: { context?: Context }, url: unknown) {
    const u = safeUrl(String(url ?? ""));
    const base = String((this.context?.getAll() as { routes?: { base?: string } } | undefined)?.routes?.base ?? "");
    return base && u.startsWith("/") && !u.startsWith("/api/") && u !== base && !u.startsWith(base + "/") ? base + u : u;
  });

  // {% section 'header' %}: renders one section file with its default settings (used in the layout)
  liquid.registerTag("section", class extends Tag {
    private file: string;
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid) {
      super(token, remain, l);
      this.file = token.args.trim().replace(/^['"]|['"]$/g, "");
    }
    *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
      const html = (yield renderSection(theme, this.file, `s-${this.file}`, {}, ctx.getAll() as Record<string, unknown>)) as string;
      emitter.write(html);
    }
  });

  engines.set(theme, liquid);
  return liquid;
}

export function safeUrl(url: string) {
  const u = url.trim();
  if (!u) return "";
  if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#|\?)/i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;
  return "#";
}

export function formatMoney(paise: number) {
  const r = paise / 100;
  return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/** Shopify CDN images take a width parameter; other hosts are returned as they are. */
export function imgUrl(url: string, width: number) {
  if (!url) return "";
  if (!width || !/cdn\.shopify\.com/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + `width=${width}`;
}

type Look = { data?: ThemeData | null; editor?: boolean };

async function renderSection(theme: string, type: string, id: string, settings: Record<string, unknown>, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const files = THEMES[theme];
  const src = files[`sections/${type}.liquid`];
  if (src == null) return `<!-- missing section ${type} -->`;
  const defaults = Object.fromEntries((schemaOf(src).settings ?? []).map((s) => [s.id, s.default ?? ""]));
  const liquid = engineFor(theme);
  const merged = { ...defaults, ...settings };
  if (type === "custom-liquid") {
    // The store's own code: rendered in a locked-down engine, then sanitized or framed (see custom-liquid.server.ts)
    const custom = await renderCustomLiquid(String(merged.code ?? ""), { ...scope, products: extra.products ?? [], section: { id, settings: merged } }, {
      id, editor: Boolean(scope.editor), vars: frameVars((scope.settings ?? {}) as Record<string, unknown>),
    });
    extra = { ...extra, custom_html: custom.html, custom_mode: custom.mode };
  }
  return liquid.renderFile(`sections/${type}`, { ...scope, section: { id, type, settings: merged, ...extra } });
}

/** Theme colours and fonts as CSS variables, for code running in a sandboxed frame. */
export function frameVars(st: Record<string, unknown>) {
  const safe = (v: unknown, d: string) => (typeof v === "string" && /^[#\w\s(),.%-]{1,40}$/.test(v) ? v : d);
  return `--brand:${safe(st.color_brand, "#111827")};--ink:${safe(st.color_text, "#14171a")};--soft:${safe(st.color_muted, "#5a6169")};--bg:${safe(st.color_bg, "#ffffff")};--font-body:"${safe(st.font_body, "DM Sans")}"`;
}

/** Extra data a section needs before it renders (product grids load their products). */
type SectionData = (type: string, settings: Record<string, unknown>) => Promise<Record<string, unknown>>;

const parseJson = <T,>(text: string | undefined, fallback: T): T => { try { return text ? (JSON.parse(text) as T) : fallback; } catch { return fallback; } };
const EMPTY: ThemeTemplate = { sections: {}, order: [] };
export const TEMPLATES = ["index", "product", "collection", "cart", "page"] as const;

type SettingDef = { id: string; type: string; label?: string; default?: unknown; [k: string]: unknown };
export type SettingGroup = { name: string; settings: SettingDef[] };
export type SectionKind = { type: string; name: string; settings: SettingDef[]; where: "template" | "header" | "footer" | "fixed"; category?: string; description?: string; requires?: string };

/** Everything the theme editor needs to know about a theme: global settings, the sections it can add, and its defaults. */
export function themeManifest(theme: string) {
  const files = THEMES[theme];
  if (!files) throw new Error(`Theme not found: ${theme}`);
  const settingsSchema = parseJson<SettingGroup[]>(files["config/settings_schema.json"], []);
  const sections: SectionKind[] = Object.keys(files).filter((f) => /^sections\/[^/]+\.liquid$/.test(f)).map((f) => {
    const type = f.slice(9, -7);
    const sc = schemaOf(files[f]);
    const where = type.startsWith("main-") ? "fixed" : type === "header" || type === "announcement" || type === "deal-bar" ? "header" : type === "footer" ? "footer" : "template";
    return { type, name: sc.name ?? type, settings: (sc.settings ?? []) as SettingDef[], where, ...(sc.category ? { category: sc.category } : {}), ...(sc.description ? { description: sc.description } : {}), ...(sc.requires ? { requires: sc.requires } : {}) };
  });
  return { settingsSchema, sections, defaults: defaultThemeData(theme) };
}

export function defaultThemeData(theme: string): ThemeData {
  const files = THEMES[theme];
  const settings: Record<string, unknown> = {};
  for (const g of parseJson<SettingGroup[]>(files["config/settings_schema.json"], [])) for (const s of g.settings) if (s.default !== undefined) settings[s.id] = s.default;
  const templates = Object.fromEntries(TEMPLATES.map((t) => [t, parseJson<ThemeTemplate>(files[`templates/${t}.json`], EMPTY)]));
  return {
    theme, settings, templates,
    groups: { header: parseJson<ThemeTemplate>(files["sections/header-group.json"], EMPTY), footer: parseJson<ThemeTemplate>(files["sections/footer-group.json"], EMPTY) },
  };
}

async function renderList(theme: string, list: ThemeTemplate, group: string, scope: Record<string, unknown>, data: SectionData, editor: boolean) {
  const parts: string[] = [];
  for (const id of list.order) {
    const s = list.sections[id];
    if (!s || s.disabled) continue;
    const settings = s.settings ?? {};
    const html = await renderSection(theme, s.type, id, settings, scope, await data(s.type, settings));
    parts.push(editor ? `<div data-gp-section="${group}/${id}" data-gp-group="${group}">${html}</div>` : html);
  }
  return parts.join("\n");
}

/** Renders one page: header group + the template's sections + footer group inside layout/theme.liquid. */
export async function renderPage(theme: string, template: string, scope: Record<string, unknown>, data: SectionData, look: Look = {}) {
  const base = defaultThemeData(theme);
  // A design saved for another theme can't be drawn with this theme's files: use this theme's defaults instead
  const saved = look.data && themeOf(look.data) === theme ? look.data : null;
  const tpl = saved?.templates?.[template] ?? base.templates[template] ?? EMPTY;
  const groups = { header: saved?.groups?.header ?? base.groups.header, footer: saved?.groups?.footer ?? base.groups.footer };
  const editor = Boolean(look.editor);
  const settings: Record<string, unknown> = { ...base.settings, ...(saved?.settings ?? {}) };
  // Review stars and text: the colour set for light or dark backgrounds, chosen from the theme's background
  const rw = (scope.widgets as { reviews?: { starLight: string; starDark: string; textLight: string; textDark: string } } | undefined)?.reviews;
  const dark = isDark(settings.color_bg);
  const review_ui = rw ? { star: dark ? rw.starDark : rw.starLight, text: dark ? rw.textDark : rw.textLight } : { star: dark ? "#f59e0b" : "#15803d", text: "" };
  const reviewsOn = (scope.widgets as { reviews?: { enabled?: boolean } } | undefined)?.reviews?.enabled !== false;
  settings.reviews_enabled = reviewsOn;
  // Section types on this page, so a section can step aside when a dedicated one is added (e.g. reviews)
  const template_sections = tpl.order.map((id) => (tpl.sections[id] as { type?: string; disabled?: boolean } | undefined)).filter((x) => x && !x.disabled).map((x) => x!.type ?? "");
  const full = { ...scope, settings, review_ui, reviews_enabled: reviewsOn, editor, template_sections };
  const [content, head, foot] = await Promise.all([
    renderList(theme, tpl, "template", full, data, editor),
    renderList(theme, groups.header, "header", full, data, editor),
    renderList(theme, groups.footer, "footer", full, data, editor),
  ]);
  return engineFor(theme).renderFile("layout/theme", { ...full, content_for_layout: content, content_for_header_group: head, content_for_footer_group: foot });
}

// ---------- data (Liquid "drops") ----------

/** owner: the store's own team is looking (preview/draft), so unpublished pages may be shown. */
export type ShopContext = { store: Store; root: string; preview: boolean; look?: Look; owner?: boolean; ownerPreview?: boolean; demoPreset?: string };

/** The store's saved design: live for shoppers, the draft for the editor. */
export async function themeLook(storeId: number, mode: "live" | "draft" | "editor" = "live"): Promise<Look> {
  const [row] = await db.select({ live: storeThemes.live, draft: storeThemes.draft }).from(storeThemes).where(eq(storeThemes.storeId, storeId)).limit(1);
  if (mode === "live") return { data: row?.live ?? null };
  return { data: row?.draft ?? row?.live ?? null, editor: mode === "editor" };
}

export async function storeBySlug(slug: string) {
  const [s] = await db.select().from(stores).where(eq(stores.slug, slug)).limit(1);
  return s ?? null;
}

/** Storefront details a store adds per product (Catalog → product → Website details): card badge, short line, feature chips,
 *  key features, specifications and questions. Older products can use tags instead: "badge:New launch", "chip:32 dB ANC". */
export type SiteExtra = { banners?: { image: string; mobile?: string; alt?: string; link?: string }[]; badge?: string; subtitle?: string; feature?: string; chips?: string[]; usp?: string[]; specs?: { label: string; value: string }[]; faqs?: { q: string; a: string }[]; rating?: number; ratingCount?: number };
function siteExtra(item: CatalogItem) {
  const raw = ((item.extra ?? {}) as { site?: SiteExtra }).site ?? {};
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const tag = (p: string) => tags.filter((t) => t.toLowerCase().startsWith(p)).map((t) => t.slice(p.length).trim()).filter(Boolean);
  const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : []);
  const chips = strs(raw.chips, 6);
  return {
    badge: String(raw.badge ?? "").trim() || tag("badge:")[0] || "",
    subtitle: String(raw.subtitle ?? "").trim(),
    feature: String(raw.feature ?? "").trim(),
    chips: chips.length ? chips : tag("chip:").slice(0, 6),
    usp: strs(raw.usp, 12),
    specs: (Array.isArray(raw.specs) ? raw.specs : []).filter((x) => x && String(x.label ?? "").trim()).slice(0, 30).map((x) => ({ label: String(x.label).trim(), value: String(x.value ?? "").trim() })),
    faqs: (Array.isArray(raw.faqs) ? raw.faqs : []).filter((x) => x && String(x.q ?? "").trim()).slice(0, 20).map((x) => ({ q: String(x.q).trim(), a: String(x.a ?? "").trim() })),
    banners: (Array.isArray(raw.banners) ? raw.banners : []).filter((b) => b && typeof b.image === "string" && /^https?:\/\//.test(b.image)).slice(0, 20)
      .map((b) => ({ image: b.image, mobile: typeof b.mobile === "string" && /^https?:\/\//.test(b.mobile) ? b.mobile : "", alt: String(b.alt ?? ""), link: String(b.link ?? "") })),
    demoRating: Number(raw.rating) || 0, demoCount: Number(raw.ratingCount) || 0,
  };
}

/** Approved review average and count per product, for star ratings on product cards. */
async function ratingsFor(itemIds: number[]) {
  const map = new Map<number, { average: number; count: number }>();
  if (!itemIds.length) return map;
  const rows = await db.select({ id: productReviews.productId, count: sql<number>`count(*)::int`, average: sql<number>`avg(${productReviews.rating})::float` })
    .from(productReviews).where(and(inArray(productReviews.productId, itemIds), eq(productReviews.status, "approved"))).groupBy(productReviews.productId);
  for (const r of rows) map.set(r.id, { average: Math.round(Number(r.average) * 10) / 10, count: Number(r.count) });
  return map;
}

function productDrop(ctx: ShopContext, item: CatalogItem, variants: CatalogVariant[], rating?: { average: number; count: number }) {
  const vs = variants.slice().sort((a, b) => a.position - b.position);
  const images = item.images.map((i) => ({ src: i.url, alt: i.alt ?? item.title, type: i.type ?? "image", poster: i.poster ?? null }));
  const cover = coverOf(item.images);
  const variantDrops = vs.map((v) => ({
    id: v.id, title: v.title, option_values: v.optionValues, price: v.pricePaise, compare_at_price: v.compareAtPaise ?? 0,
    available: v.stock == null || v.stock > 0 || Boolean((item.extra as { continueSelling?: boolean } | null)?.continueSelling), image: v.imageUrl ? imgUrl(v.imageUrl, 1100) : null, sku: v.sku,
    // Shopify's variant number, so old links and ads with ?variant=<Shopify id> open the right variant
    source: v.sourceId ? String(v.sourceId).replace(/^.*\//, "") : null,
    // The id Shopify's Facebook channel used in the Meta catalog, so pixel events still match an older Shopify catalog
    meta_alt: v.sourceId && item.sourceId ? `shopify_IN_${String(item.sourceId).replace(/^.*\//, "")}_${String(v.sourceId).replace(/^.*\//, "")}` : null,
  }));
  const cheapest = variantDrops.filter((v) => v.available).sort((a, b) => a.price - b.price)[0] ?? variantDrops[0];
  const price = cheapest?.price ?? 0;
  const compare = cheapest?.compare_at_price ?? 0;
  const url = productPath(ctx.root, item.handle);
  const drop = {
    id: item.id, title: item.title, handle: item.handle, url, description: item.descriptionHtml, images, featured_image: cover, has_video: images.some((i) => i.type === "video"), featured_video: images.find((i) => i.type === "video")?.src ?? null,
    options: item.options, variants: variantDrops, price, compare_at_price: compare, available: variantDrops.some((v) => v.available),
    discount_pct: compare > price ? Math.round((1 - price / compare) * 100) : 0,
    seo_title: item.seoTitle, seo_description: item.seoDescription,
    ...(() => {
      const x = siteExtra(item);
      return {
        banners: x.banners, badge: x.badge, subtitle: x.subtitle, feature: x.feature, chips: x.chips, usp: x.usp, specs: x.specs, faqs: x.faqs,
        rating: rating?.count ? rating.average : x.demoRating, rating_count: rating?.count ? rating.count : x.demoCount,
        vendor: item.vendor ?? "", product_type: item.productType ?? "", origin: String((item.extra as { origin?: string } | null)?.origin ?? ""),
        tags: item.tags ?? [], categories: [] as string[],
        second_image: item.images.filter((i) => (i.type ?? "image") === "image")[1]?.url ?? null,
      };
    })(),
  };
  // For the product page script (safe inside <script>)
  const json = JSON.stringify({ id: drop.id, title: drop.title, url, image: cover ? imgUrl(cover, 300) : null, options: drop.options, variants: variantDrops }).replace(/</g, "\\u003c");
  return { ...drop, json };
}

/** Ready-made themes whose preview shows sample products, categories and pages. */
export const DEMO_PRESETS = ["mira", "luma", "thread", "stride", "playday", "scentelier", "pulse"];
export const isDemo = (ctx: ShopContext) => Boolean(ctx.demoPreset && DEMO_PRESETS.includes(ctx.demoPreset));

/** Editor preview when the store has no product yet. */
export const SAMPLE = "__sample";
export function sampleProduct(ctx: ShopContext) {
  const svg = (c: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="${c}"/><circle cx="300" cy="300" r="140" fill="#fff" opacity=".55"/></svg>`)}`;
  const now = new Date();
  const item = {
    id: 0, storeId: ctx.store.id, title: "Sample product", handle: SAMPLE, status: "active", productType: null, vendor: null, tags: [], source: "manual", sourceId: null,
    descriptionHtml: "<p>Your product description shows here: what it is, what's in the box, size and care.</p>",
    images: [{ url: svg("#e9e2d8") }, { url: svg("#dfe7e4") }, { url: svg("#e4e1ee") }],
    options: [{ name: "Color", values: ["Black", "White"] }, { name: "Size", values: ["M", "L"] }],
    seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
  } as unknown as CatalogItem;
  const variants = ["Black", "White"].flatMap((c, i) => ["M", "L"].map((sz, j) => ({
    id: -(i * 2 + j + 1), itemId: 0, storeId: ctx.store.id, title: `${c} / ${sz}`, optionValues: [c, sz], pricePaise: 99900, compareAtPaise: 149900, stock: null, sku: null, imageUrl: null, position: i * 2 + j,
  }))) as unknown as CatalogVariant[];
  return productDrop(ctx, item, variants);
}

const MIRA_BAGS = [
  { handle: "mira-sunday-tote", title: "The Sunday Tote", category: "totes", price: 189000, compare: 249000, bg: "#f2e6df", bag: "#ad7063", trim: "#d9b99a", shape: "tote" },
  { handle: "mira-market-carryall", title: "The Market Carryall", category: "shoulder-bags", price: 229000, compare: 299000, bg: "#e9eee9", bag: "#526e5e", trim: "#cdb18b", shape: "carryall" },
  { handle: "mira-mini-crossbody", title: "The Mini Crossbody", category: "crossbody", price: 149000, compare: 199000, bg: "#eee9f0", bag: "#85748d", trim: "#d4bd9c", shape: "crossbody" },
  { handle: "mira-city-satchel", title: "The City Satchel", category: "shoulder-bags", price: 209000, compare: 279000, bg: "#f2ebdc", bag: "#c19b62", trim: "#eed5a8", shape: "satchel" },
] as const;

const LUMA_BEAUTY = [
  { handle: "luma-cloud-cleanser", title: "Cloud Cleanser", category: "cleansers", price: 89000, compare: 109000, bg: "#e1f3f8", bottle: "#fbffff", accent: "#5368e8", shape: "tube", subtitle: "GENTLE DAILY CLEANSER" },
  { handle: "luma-dew-serum", title: "Dew Drops Serum", category: "serums", price: 129000, compare: 159000, bg: "#ecebff", bottle: "#dce6f3", accent: "#5368e8", shape: "serum", subtitle: "HYDRATING FACE SERUM" },
  { handle: "luma-ceramide-cream", title: "Cloud Nine Cream", category: "moisturisers", price: 119000, compare: 149000, bg: "#ffefe9", bottle: "#fffdfb", accent: "#df8878", shape: "jar", subtitle: "DAILY BARRIER CREAM" },
  { handle: "luma-daily-spf", title: "Daylight SPF 50", category: "sun-care", price: 99000, compare: 129000, bg: "#e9f7eb", bottle: "#fffdf6", accent: "#4c9b76", shape: "tube", subtitle: "LIGHTWEIGHT SUN VEIL" },
] as const;

const THREAD_CLOTHES = [
  { handle: "thread-heavyweight-tee", title: "Heavyweight Box Tee", category: "tees", price: 89900, compare: 119900, bg: "#e9e9df", cloth: "#262925", accent: "#c9e958", shape: "tee", subtitle: "HEAVYWEIGHT COTTON" },
  { handle: "thread-oxford-shirt", title: "Everyday Oxford Shirt", category: "shirts", price: 179900, compare: 229900, bg: "#e5eaf0", cloth: "#8ea0b4", accent: "#29394a", shape: "shirt", subtitle: "RELAXED OXFORD" },
  { handle: "thread-utility-overshirt", title: "Utility Overshirt", category: "outerwear", price: 249900, compare: 319900, bg: "#e8e2d7", cloth: "#b37b4d", accent: "#4c3e30", shape: "jacket", subtitle: "EVERYDAY LAYER" },
  { handle: "thread-relaxed-cargo", title: "Relaxed Cargo Pant", category: "bottoms", price: 199900, compare: 259900, bg: "#e5e8de", cloth: "#657153", accent: "#2d3328", shape: "pants", subtitle: "RELAXED FIT" },
] as const;

const SHOE_PRODUCTS = [
  { handle: "stride-city-low", title: "City Low Sneaker", category: "everyday", price: 249900, compare: 329900, image: "https://images.unsplash.com/photo-1700178310305-0e05d7930f9f?auto=format&fit=crop&w=1000&q=82", altImage: "https://images.unsplash.com/photo-1780824946608-c13717489f97?auto=format&fit=crop&w=1000&q=82" },
  { handle: "stride-pace-runner", title: "Pace Runner 02", category: "running", price: 319900, compare: 399900, image: "https://images.unsplash.com/photo-1637437757614-6491c8e915b5?auto=format&fit=crop&w=1000&q=82", altImage: "https://images.unsplash.com/photo-1581285864607-ef85509e7324?auto=format&fit=crop&w=1000&q=82" },
  { handle: "stride-court-classic", title: "Court Classic", category: "sneakers", price: 279900, compare: 359900, image: "https://images.unsplash.com/photo-1724921194807-c0d17dc7cfe4?auto=format&fit=crop&w=1000&q=82", altImage: "https://images.unsplash.com/photo-1780824946973-ab4e10ec90f6?auto=format&fit=crop&w=1000&q=82" },
  { handle: "stride-trail-move", title: "Trail Move XT", category: "running", price: 389900, compare: 479900, image: "https://images.unsplash.com/photo-1698108223703-0af88bee1104?auto=format&fit=crop&w=1000&q=82", altImage: "https://images.unsplash.com/photo-1637437757614-6491c8e915b5?auto=format&fit=crop&w=1000&q=82" },
  { handle: "stride-everyday-knit", title: "Everyday Knit", category: "walking", price: 219900, compare: 289900, image: "https://images.unsplash.com/photo-1780824946608-c13717489f97?auto=format&fit=crop&w=1000&q=82", altImage: "https://images.unsplash.com/photo-1553835584-c3eab150319e?auto=format&fit=crop&w=1000&q=82" },
  { handle: "stride-retro-court", title: "Retro Court 88", category: "sneakers", price: 299900, compare: 379900, image: "https://images.unsplash.com/photo-1553835584-c3eab150319e?auto=format&fit=crop&w=1000&q=82", altImage: "https://images.unsplash.com/photo-1581285864607-ef85509e7324?auto=format&fit=crop&w=1000&q=82" },
] as const;

const SCENTELIER_PRODUCTS = [
  { handle: "scentelier-amber-veil", title: "Amber Veil · Eau de Parfum", category: "warm-woods", price: 189900, compare: 229900, image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=1100&q=85", altImage: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1100&q=85", notes: "Saffron · amber · sandalwood" },
  { handle: "scentelier-rose-afterglow", title: "Rose Afterglow · Eau de Parfum", category: "floral", price: 159900, compare: 199900, image: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1100&q=85", altImage: "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=1100&q=85", notes: "Damask rose · peony · musk" },
  { handle: "scentelier-citrus-no-04", title: "Citrus No. 04 · Eau de Parfum", category: "fresh", price: 139900, compare: 179900, image: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1100&q=85", altImage: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1100&q=85", notes: "Bergamot · neroli · cedar" },
  { handle: "scentelier-oud-at-dusk", title: "Oud at Dusk · Parfum Intense", category: "warm-woods", price: 219900, compare: 259900, image: "https://images.unsplash.com/photo-1590736969955-71cc94901144?auto=format&fit=crop&w=1100&q=85", altImage: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1100&q=85", notes: "Oud · smoked vanilla · vetiver" },
  { handle: "scentelier-soft-hours", title: "Soft Hours · Skin Scent", category: "soft-scents", price: 129900, compare: 159900, image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=1100&q=85", altImage: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1100&q=85", notes: "White musk · iris · cashmere" },
  { handle: "scentelier-golden-hour", title: "Golden Hour · Discovery Set", category: "discovery-sets", price: 89900, compare: 109900, image: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=1100&q=85", altImage: "https://images.unsplash.com/photo-1590736969955-71cc94901144?auto=format&fit=crop&w=1100&q=85", notes: "Five little journeys · 5 × 2 ml" },
] as const;

const REAL_PHOTOS = {
  bags: ["https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1000&q=82"],
  beauty: ["https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=1000&q=82"],
  clothing: ["https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1000&q=82", "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=1000&q=82"],
};

const miraBagImage = (bag: (typeof MIRA_BAGS)[number], alternate = false) => {
  const bg = alternate ? "#f8f2ed" : bag.bg;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#fffaf6"/></linearGradient><filter id="shadow" x="-40%" y="-30%" width="180%" height="190%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#352724" flood-opacity=".16"/></filter></defs><rect width="600" height="750" fill="url(#bg)"/><circle cx="470" cy="155" r="112" fill="#fff" opacity=".32"/><ellipse cx="300" cy="617" rx="150" ry="20" fill="#51403a" opacity=".10"/><g filter="url(#shadow)" stroke-linejoin="round" stroke-linecap="round">${bag.shape === "crossbody" ? `<path d="M206 352c0-128 46-194 94-194s94 66 94 194" fill="none" stroke="#493d4e" stroke-width="18"/><path d="M178 342h244l-24 235H202z" fill="${bag.bag}"/><path d="M178 342h244l-14 53H192z" fill="${bag.trim}"/><path d="M252 433h96v86h-96z" fill="#78677f"/><path d="M275 468h50" stroke="${bag.trim}" stroke-width="12"/>` : bag.shape === "satchel" ? `<path d="M210 348c0-124 37-182 90-182s90 58 90 182" fill="none" stroke="#554538" stroke-width="18"/><path d="M166 354h268l-22 229H188z" fill="${bag.bag}"/><path d="m166 354 43 83h182l43-83z" fill="${bag.trim}"/><path d="M244 437h112v98H244z" fill="#b38d55"/><path d="m300 455 21 31-21 31-21-31z" fill="${bag.trim}"/>` : `<path d="M204 345c0-122 39-185 96-185s96 63 96 185" fill="none" stroke="#51352f" stroke-width="18"/><path d="M150 350h300l-24 237H174z" fill="${bag.bag}"/><path d="M150 350h300l-18 52H168z" fill="${bag.trim}"/><path d="M244 435h112v95H244z" fill="${bag.bag}"/><path d="M276 469h48" stroke="${bag.trim}" stroke-width="15"/>`}</g><circle cx="300" cy="624" r="4" fill="#a7655f" opacity=".42"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const lumaBeautyImage = (item: (typeof LUMA_BEAUTY)[number], alternate = false) => {
  const bg = alternate ? "#f8fcff" : item.bg;
  const art = item.shape === "serum"
    ? `<rect x="267" y="218" width="66" height="80" rx="12" fill="#f6f8ff" stroke="#b8c5dd" stroke-width="5"/><path d="M278 211h44v18h-44z" rx="5" fill="${item.accent}"/><path d="M289 144h22v68h-22z" fill="#263454"/><path d="M289 145h22v58h-22z" fill="#293752"/><rect x="220" y="280" width="160" height="295" rx="30" fill="${item.bottle}" stroke="#c5d4e6" stroke-width="5"/><rect x="236" y="372" width="128" height="136" rx="8" fill="#ffffff" opacity=".82"/><circle cx="300" cy="401" r="16" fill="${item.accent}"/><path d="M286 401h28m-14-14v28" stroke="#fff" stroke-width="3"/><text x="300" y="450" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#263454">LUMA</text><text x="300" y="476" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" letter-spacing="1.4" fill="#65738f">DEW SERUM</text>`
    : item.shape === "jar"
      ? `<ellipse cx="300" cy="555" rx="132" ry="24" fill="#314768" opacity=".10"/><rect x="190" y="303" width="220" height="225" rx="45" fill="${item.bottle}" stroke="#e1d2ce" stroke-width="6"/><path d="M190 366h220v112a45 45 0 0 1-45 45H235a45 45 0 0 1-45-45z" fill="${item.accent}" opacity=".16"/><rect x="203" y="264" width="194" height="58" rx="17" fill="#f5f1ee" stroke="#daccc5" stroke-width="5"/><path d="M212 279h176" stroke="#fff" stroke-width="5"/><text x="300" y="414" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#263454">LUMA</text><text x="300" y="442" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" letter-spacing="1.2" fill="#65738f">CERAMIDE CREAM</text>`
      : `<path d="M255 195q45-35 90 0l15 48q22 18 25 53l-24 232q-3 30-34 30h-58q-31 0-34-30l-24-232q3-35 25-53z" fill="${item.bottle}" stroke="#cfdae7" stroke-width="5"/><path d="M266 203q34-24 68 0l8 37h-84z" fill="${item.accent}"/><path d="M235 328h130l-19 176q-2 20-22 20h-48q-20 0-22-20z" fill="${item.accent}" opacity=".13"/><rect x="249" y="371" width="102" height="105" rx="8" fill="#ffffff" opacity=".88"/><text x="300" y="410" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#263454">LUMA</text><text x="300" y="435" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" letter-spacing="1" fill="#65738f">${item.subtitle}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#fff"/></linearGradient><filter id="shadow" x="-40%" y="-30%" width="180%" height="190%"><feDropShadow dx="0" dy="20" stdDeviation="20" flood-color="#263454" flood-opacity=".13"/></filter></defs><rect width="600" height="750" fill="url(#bg)"/><circle cx="110" cy="150" r="100" fill="#fff" opacity=".42"/><circle cx="508" cy="565" r="70" fill="${item.accent}" opacity=".06"/><g filter="url(#shadow)">${art}</g><text x="300" y="640" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" letter-spacing="3" fill="#65738f">FORMULATED FOR EVERYDAY</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const threadClothesImage = (item: (typeof THREAD_CLOTHES)[number], alternate = false) => {
  const bg = alternate ? "#f3f2ec" : item.bg;
  const art = item.shape === "pants"
    ? `<path d="M224 172h152l-10 190-23 222h-62l-10-170-10 170h-62l-23-222z" fill="${item.cloth}"/><path d="M224 172h152l-5 56H229z" fill="${item.accent}" opacity=".5"/><path d="M300 174v232" stroke="#f5f4ee" stroke-opacity=".28" stroke-width="5"/><path d="M233 345h49v74h-49zm85 0h49v74h-49z" fill="${item.accent}" opacity=".26"/><path d="M260 193v22m80-22v22" stroke="#f5f4ee" stroke-width="6" stroke-linecap="round"/>`
    : item.shape === "jacket"
      ? `<path d="m239 171 61-30 61 30 59 65-43 43-24-24v311H247V255l-24 24-43-43z" fill="${item.cloth}"/><path d="m239 171 61-30-25 110-48-39zm122 0-61-30 25 110 48-39z" fill="${item.accent}"/><path d="M300 251v315" stroke="#f5f4ee" stroke-opacity=".5" stroke-width="4"/><path d="M259 347h34v68h-34zm48 0h34v68h-34z" fill="${item.accent}" opacity=".5"/><circle cx="307" cy="291" r="4" fill="#c9e958"/><circle cx="307" cy="329" r="4" fill="#c9e958"/><circle cx="307" cy="367" r="4" fill="#c9e958"/>`
      : item.shape === "shirt"
        ? `<path d="m242 169 58-28 58 28 58 68-42 42-27-24v292H253V255l-27 24-42-42z" fill="${item.cloth}"/><path d="m242 169 58-28-19 86-39 30zm116 0-58-28 19 86 39 30z" fill="#f5f4ee"/><path d="M300 227v320" stroke="#f5f4ee" stroke-opacity=".8" stroke-width="4"/><path d="M309 267h8m-8 36h8m-8 36h8m-8 36h8" stroke="${item.accent}" stroke-width="5" stroke-linecap="round"/><path d="M344 348h36v62h-36z" fill="${item.accent}" opacity=".4"/>`
        : `<path d="m240 170 60-29 60 29 57 67-43 43-26-25v292H252V255l-26 25-43-43z" fill="${item.cloth}"/><path d="m240 170 60-29-18 89-42 25zm120 0-60-29 18 89 42 25z" fill="${item.accent}" opacity=".7"/><path d="M300 231v316" stroke="#f5f4ee" stroke-opacity=".4" stroke-width="4"/><path d="M264 360h72v84h-72z" fill="${item.accent}" opacity=".22"/><path d="M264 360h72" stroke="#f5f4ee" stroke-opacity=".5" stroke-width="3"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#f5f4ee"/></linearGradient><filter id="shadow" x="-40%" y="-30%" width="180%" height="190%"><feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#171816" flood-opacity=".18"/></filter></defs><rect width="600" height="750" fill="url(#bg)"/><path d="M28 92h544M28 658h544" stroke="#171816" stroke-opacity=".1"/><text x="38" y="74" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="3" fill="#171816">THREAD / STUDIO</text><g filter="url(#shadow)">${art}</g><text x="300" y="704" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="#62645b">${item.subtitle}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** Non-purchasable catalog examples used only in a theme preview iframe. */
export function demoProducts(ctx: ShopContext, category?: string) {
  if (ctx.demoPreset === "pulse") return PULSE_PRODUCTS.filter((p) => !category || category === "all" || p.category === category).map((p, i) => {
    const now = new Date();
    const id = -(i + 601);
    const photos = [...p.colours.map((c) => c[1]), ...p.extra];
    const item = {
      id, storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: p.type, vendor: "Your brand", tags: ["sample"], source: "manual", sourceId: null,
      descriptionHtml: `<h2>${p.subtitle}</h2><p>Sample product for the theme preview. Your own product description shows here, and the wide banners below come from Catalog → product → Description banners.</p>`,
      images: photos.map((ph, j) => ({ url: pulseImg(ph, 1100, 1100), alt: j === 0 ? p.title : `${p.title} view ${j + 1}` })),
      options: [{ name: "Colour", values: p.colours.map((c) => c[0]) }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
      extra: { origin: "India", site: { banners: [{ image: pulseImg("photo-1605890822326-ab63270c7189", 1600, 800), mobile: pulseImg("photo-1605890822326-ab63270c7189", 800, 1000), alt: "Made for everyday listening" }, { image: pulseImg(p.colours[0][1], 1600, 800), alt: p.title }, { image: pulseImg(p.extra[0] ?? p.colours[1][1], 1600, 800), alt: `${p.title} detail` }], badge: p.badge, subtitle: p.subtitle, feature: p.feature, chips: p.chips, usp: p.usp, specs: p.specs.map(([label, value]) => ({ label, value })), faqs: PULSE_FAQS, rating: p.rating, ratingCount: p.count } },
    } as unknown as CatalogItem;
    const variants = p.colours.map(([colour, ph], j) => ({ id: id * 10 - j - 1, itemId: id, storeId: ctx.store.id, title: colour, optionValues: [colour], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: pulseImg(ph, 1100, 1100), position: j })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [p.category as string] };
  });
  if (ctx.demoPreset === "scentelier") return SCENTELIER_PRODUCTS.filter((p) => !category || category === "fragrance" || p.category === category).map((p, i) => {
    const now = new Date();
    const item = {
      id: -(i + 501), storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: "Fine fragrance", vendor: "Scentelier Parfums", tags: ["sample", "fragrance", p.category], source: "manual", sourceId: null,
      descriptionHtml: `<p>${p.notes} open into a balanced fragrance that settles close to the skin and stays with you through the day. A considered scent for everyday rituals and evenings worth remembering.</p><h3>The fragrance</h3><ul><li>Concentration: Eau de Parfum</li><li>Thoughtfully layered top, heart and base notes</li><li>Presented in a keepsake glass bottle</li></ul><h3>Wear it your way</h3><p>Spritz lightly on pulse points. Let the fragrance settle naturally. Sample product shown for theme preview only.</p>`,
      images: [{ url: p.image, alt: p.title }, { url: p.altImage, alt: `${p.title} fragrance bottle detail` }],
      options: [{ name: "Size", values: ["50 ml", "10 ml travel"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["50 ml", "10 ml travel"].map((size, j) => ({ id: -((i + 501) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: size, optionValues: [size], pricePaise: j === 0 ? p.price : Math.round(p.price * .38), compareAtPaise: j === 0 ? p.compare : Math.round(p.compare * .38), stock: null, sku: null, imageUrl: null, position: j })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [p.category as string] };
  });
  if (ctx.demoPreset === "playday") return PLAY_PRODUCTS.filter((p) => !category || category === "all" || category === "toys" || p.category === category).map((p, i) => {
    const now = new Date();
    const id = -(i + 401);
    const photos = [...p.colours.map((c) => c[1]), ...p.extra];
    const item = {
      id, storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: p.type, vendor: "Your brand", tags: ["sample", ...p.ages.map((a) => `age:${a}`)], source: "manual", sourceId: null,
      descriptionHtml: `<h2>${p.subtitle}</h2><p>Sample toy for the theme preview. Your own product description shows here, and the wide pictures below come from Catalog → product → Description banners.</p><ul>${p.usp.map((u) => `<li>${u}</li>`).join("")}</ul>`,
      images: photos.map((ph, j) => ({ url: playImg(ph, 1100, 1100), alt: j === 0 ? p.title : `${p.title} view ${j + 1}` })),
      options: [{ name: "Colour", values: p.colours.map((c) => c[0]) }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
      extra: { origin: "India", site: { banners: [{ image: playImg("photo-1515488042361-ee00e0ddd4e4", 1600, 760), mobile: playImg("photo-1515488042361-ee00e0ddd4e4", 800, 1000), alt: "Made for happy, safe play" }, { image: playImg(p.extra[0] ?? p.colours[0][1], 1600, 760), alt: p.title }], badge: p.badge, subtitle: p.subtitle, feature: p.feature, chips: p.chips, usp: p.usp, specs: p.specs.map(([label, value]) => ({ label, value })), faqs: PLAY_FAQS, rating: p.rating, ratingCount: p.count } },
    } as unknown as CatalogItem;
    const variants = p.colours.map(([colour, ph], j) => ({ id: id * 10 - j - 1, itemId: id, storeId: ctx.store.id, title: colour, optionValues: [colour], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: playImg(ph, 1100, 1100), position: j })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [p.category as string] };
  });
  if (ctx.demoPreset === "stride") return SHOE_PRODUCTS.filter((p) => !category || category === "footwear" || p.category === category).map((p, i) => {
    const now = new Date();
    const item = {
      id: -(i + 301), storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: "Footwear", vendor: "Stride Studio", tags: ["sample", "footwear"], source: "manual", sourceId: null,
      descriptionHtml: "<p>Made for your everyday rotation: cushioned underfoot feel, a breathable upper and a versatile profile that moves easily from commute to weekend.</p><h3>Details</h3><ul><li>Lightweight cushioned sole</li><li>Comfort lining for all-day wear</li><li>Designed for city miles</li></ul><p>Sample product shown for theme preview only.</p>",
      images: [{ url: p.image, alt: p.title }, { url: p.altImage, alt: `${p.title} alternate view` }],
      options: [{ name: "Size", values: ["UK 6", "UK 7", "UK 8", "UK 9", "UK 10"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["UK 6", "UK 7", "UK 8", "UK 9", "UK 10"].map((size, j) => ({
      id: -((i + 301) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: size, optionValues: [size], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [p.category as string] };
  });
  if (ctx.demoPreset === "thread") return THREAD_CLOTHES.filter((p) => !category || category === "apparel" || p.category === category).map((p, i) => {
    const now = new Date();
    const item = {
      id: -(i + 201), storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: "Clothing", vendor: "Thread Studio", tags: ["sample", "apparel"], source: "manual", sourceId: null,
      descriptionHtml: `<p>${p.subtitle.toLowerCase()} with a relaxed, easy-to-layer shape. Cut for everyday movement and finished with clean details that work across your weekly rotation.</p><h3>Details</h3><ul><li>Soft-touch midweight fabric</li><li>Relaxed everyday fit</li><li>Made for repeat wear</li></ul><p>Sample product shown for theme preview only.</p>`,
      images: [{ url: REAL_PHOTOS.clothing[i % REAL_PHOTOS.clothing.length], alt: p.title }, { url: REAL_PHOTOS.clothing[(i + 1) % REAL_PHOTOS.clothing.length], alt: `${p.title} detail` }],
      options: [{ name: "Size", values: ["XS", "S", "M", "L", "XL"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["XS", "S", "M", "L", "XL"].map((size, j) => ({
      id: -((i + 201) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: size, optionValues: [size], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [p.category as string] };
  });
  if (ctx.demoPreset === "luma") return LUMA_BEAUTY.filter((p) => !category || category === "skincare" || p.category === category).map((p, i) => {
    const now = new Date();
    const item = {
      id: -(i + 101), storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: "Skincare", vendor: "Luma Studio", tags: ["sample", "skincare"], source: "manual", sourceId: null,
      descriptionHtml: `<p>${p.subtitle[0] + p.subtitle.slice(1).toLowerCase()} made for an easy everyday routine. A lightweight sample formula with a comfortable finish.</p><p>Sample product shown for theme preview only.</p>`,
      images: [{ url: REAL_PHOTOS.beauty[i % REAL_PHOTOS.beauty.length], alt: p.title }, { url: REAL_PHOTOS.beauty[(i + 1) % REAL_PHOTOS.beauty.length], alt: `${p.title} detail` }],
      options: [{ name: "Size", values: ["50 ml", "Travel size"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["50 ml", "Travel size"].map((size, j) => ({
      id: -((i + 101) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: size, optionValues: [size], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [p.category as string] };
  });
  return MIRA_BAGS.filter((b) => !category || b.category === category).map((b, i) => {
    const now = new Date();
    const item = {
      id: -(i + 1), storeId: ctx.store.id, title: b.title, handle: b.handle, status: "active", productType: "Handbag", vendor: "Mira Studio", tags: ["sample", "handbag"], source: "manual", sourceId: null,
      descriptionHtml: "<p>A thoughtfully designed everyday bag with a considered shape, a comfortable carry and room for your daily essentials.</p><p>Sample product shown for theme preview only.</p>",
      images: [{ url: REAL_PHOTOS.bags[i % REAL_PHOTOS.bags.length], alt: b.title }, { url: REAL_PHOTOS.bags[(i + 1) % REAL_PHOTOS.bags.length], alt: `${b.title} detail` }],
      options: [{ name: "Colour", values: ["Classic", "Soft neutral"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["Classic", "Soft neutral"].map((colour, j) => ({
      id: -((i + 1) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: colour, optionValues: [colour], pricePaise: b.price, compareAtPaise: b.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true, categories: [b.category as string] };
  });
}

async function variantsFor(itemIds: number[]) {
  if (!itemIds.length) return new Map<number, CatalogVariant[]>();
  const rows = await db.select().from(catalogVariants).where(inArray(catalogVariants.itemId, itemIds));
  const map = new Map<number, CatalogVariant[]>();
  for (const r of rows) (map.get(r.itemId) ?? map.set(r.itemId, []).get(r.itemId)!).push(r);
  return map;
}

export async function loadProducts(ctx: ShopContext, opts: { category?: string; limit?: number; exclude?: number } = {}) {
  const where = [eq(catalogItems.storeId, ctx.store.id), eq(catalogItems.status, "active")];
  let items: CatalogItem[];
  if (opts.category) {
    const [cat] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(and(eq(catalogCategories.storeId, ctx.store.id), eq(catalogCategories.handle, opts.category))).limit(1);
    if (!cat) return [];
    items = (await db.select({ i: catalogItems }).from(catalogCategoryItems).innerJoin(catalogItems, eq(catalogItems.id, catalogCategoryItems.itemId))
      .where(and(eq(catalogCategoryItems.categoryId, cat.id), ...where)).orderBy(asc(catalogCategoryItems.position), asc(catalogItems.id)).limit(opts.limit ?? 200)).map((r) => r.i);
  } else {
    items = await db.select().from(catalogItems).where(and(...where)).orderBy(asc(catalogItems.id)).limit((opts.limit ?? 200) + 1);
  }
  if (opts.exclude) items = items.filter((i) => i.id !== opts.exclude);
  items = items.slice(0, opts.limit ?? 200);
  const [vmap, rmap] = await Promise.all([variantsFor(items.map((i) => i.id)), ratingsFor(items.map((i) => i.id))]);
  return items.map((i) => productDrop(ctx, i, vmap.get(i.id) ?? [], rmap.get(i.id)));
}

/** Category handles of each product, for the category filter. */
export async function withCategories<T extends { id: number; categories: string[] }>(ctx: ShopContext, products: T[]) {
  const ids = products.map((p) => p.id).filter((id) => id > 0);
  if (!ids.length) return products;
  const rows = await db.select({ item: catalogCategoryItems.itemId, handle: catalogCategories.handle }).from(catalogCategoryItems)
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogCategoryItems.categoryId))
    .where(and(eq(catalogCategories.storeId, ctx.store.id), inArray(catalogCategoryItems.itemId, ids)));
  const map = new Map<number, string[]>();
  for (const r of rows) (map.get(r.item) ?? map.set(r.item, []).get(r.item)!).push(r.handle);
  return products.map((p) => (p.id > 0 ? { ...p, categories: map.get(p.id) ?? [] } : p));
}

export async function loadProduct(ctx: ShopContext, handle: string) {
  let [item] = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, ctx.store.id), eq(catalogItems.handle, handle), eq(catalogItems.status, "active"))).limit(1);
  // Imported handles were cut to 80 characters; old Shopify/ad links still carry the full handle. Match the longest stored handle the link starts with.
  if (!item && handle.length > 40) {
    [item] = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, ctx.store.id), eq(catalogItems.status, "active"),
      sql`length(${catalogItems.handle}) >= 40`, sql`${handle} like replace(replace(${catalogItems.handle}, '_', '\\_'), '%', '\\%') || '%'`))
      .orderBy(sql`length(${catalogItems.handle}) desc`).limit(1);
  }
  if (!item) return null;
  const [vmap, rmap] = await Promise.all([variantsFor([item.id]), ratingsFor([item.id])]);
  return productDrop(ctx, item, vmap.get(item.id) ?? [], rmap.get(item.id));
}

export async function loadCategories(ctx: ShopContext) {
  if (ctx.demoPreset === "pulse") return PULSE_CATEGORIES.map((c, i) => ({ id: -(61 + i), title: c.title, handle: c.handle, description: c.text, image: pulseImg(c.image, 400, 400), url: categoryPath(ctx.root, c.handle) }));
  if (ctx.demoPreset === "scentelier") return [
    { id: -51, title: "Floral", handle: "floral", description: "Petals, softly layered.", image: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=900&q=82", url: categoryPath(ctx.root, "floral") },
    { id: -52, title: "Warm woods", handle: "warm-woods", description: "Amber, woods and depth.", image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=900&q=82", url: categoryPath(ctx.root, "warm-woods") },
    { id: -53, title: "Soft scents", handle: "soft-scents", description: "A quiet signature, close to you.", image: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=900&q=82", url: categoryPath(ctx.root, "soft-scents") },
    { id: -54, title: "Discovery sets", handle: "discovery-sets", description: "Meet your next favourite.", image: "https://images.unsplash.com/photo-1590736969955-71cc94901144?auto=format&fit=crop&w=900&q=82", url: categoryPath(ctx.root, "discovery-sets") },
  ];
  if (ctx.demoPreset === "playday") return PLAY_CATEGORIES.map((c, i) => ({ id: -(41 + i), title: c.title, handle: c.handle, description: c.text, image: playImg(c.image, 600, 760), url: categoryPath(ctx.root, c.handle) }));
  if (ctx.demoPreset === "stride") return [
    { id: -31, title: "Shop all footwear", handle: "footwear", description: "Find your next everyday pair.", url: categoryPath(ctx.root, "footwear") },
    { id: -32, title: "Sneakers", handle: "sneakers", description: "Clean lines. All-day comfort.", url: categoryPath(ctx.root, "sneakers") },
    { id: -33, title: "Running", handle: "running", description: "Made for the miles ahead.", url: categoryPath(ctx.root, "running") },
    { id: -34, title: "Everyday", handle: "everyday", description: "Easy pairs, every day.", url: categoryPath(ctx.root, "everyday") },
    { id: -35, title: "Walking", handle: "walking", description: "A softer step from morning on.", url: categoryPath(ctx.root, "walking") },
  ];
  if (ctx.demoPreset === "thread") return [
    { id: -21, title: "Shop all apparel", handle: "apparel", description: "The everyday uniform.", url: categoryPath(ctx.root, "apparel") },
    { id: -22, title: "Tees", handle: "tees", description: "Reliable fits, repeat wear.", url: categoryPath(ctx.root, "tees") },
    { id: -23, title: "Shirts", handle: "shirts", description: "Easy layers for every day.", url: categoryPath(ctx.root, "shirts") },
    { id: -24, title: "Outerwear", handle: "outerwear", description: "A little more structure.", url: categoryPath(ctx.root, "outerwear") },
    { id: -25, title: "Bottoms", handle: "bottoms", description: "Relaxed shape, all-day comfort.", url: categoryPath(ctx.root, "bottoms") },
  ];
  if (ctx.demoPreset === "luma") return [
    { id: -11, title: "All skincare", handle: "skincare", description: "Build a simple daily ritual.", url: categoryPath(ctx.root, "skincare") },
    { id: -12, title: "Cleansers", handle: "cleansers", description: "A fresh start for your skin.", url: categoryPath(ctx.root, "cleansers") },
    { id: -13, title: "Serums", handle: "serums", description: "Lightweight layers, considered ingredients.", url: categoryPath(ctx.root, "serums") },
    { id: -14, title: "Moisturisers", handle: "moisturisers", description: "Comfort and hydration, every day.", url: categoryPath(ctx.root, "moisturisers") },
    { id: -15, title: "Sun care", handle: "sun-care", description: "A little care for brighter days.", url: categoryPath(ctx.root, "sun-care") },
  ];
  if (ctx.demoPreset === "mira") return [
    { id: -1, title: "Shoulder bags", handle: "shoulder-bags", description: "Roomy favourites for every day.", url: categoryPath(ctx.root, "shoulder-bags") },
    { id: -2, title: "Totes", handle: "totes", description: "Easy carry, all-day style.", url: categoryPath(ctx.root, "totes") },
    { id: -3, title: "Crossbody bags", handle: "crossbody", description: "Hands-free pieces for on the go.", url: categoryPath(ctx.root, "crossbody") },
  ];
  const rows = await db.select().from(catalogCategories).where(eq(catalogCategories.storeId, ctx.store.id)).orderBy(asc(catalogCategories.position), asc(catalogCategories.title));
  // A category without its own picture shows the photo of one of its products
  const bare = rows.filter((c) => !c.imageUrl).map((c) => c.id);
  const fallback = new Map<number, string>();
  if (bare.length) {
    const items = await db.select({ cat: catalogCategoryItems.categoryId, images: catalogItems.images }).from(catalogCategoryItems)
      .innerJoin(catalogItems, eq(catalogItems.id, catalogCategoryItems.itemId))
      .where(and(inArray(catalogCategoryItems.categoryId, bare), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.id));
    for (const it of items) {
      const img = (it.images as { url?: string; type?: string }[] | null)?.find((m) => m?.url && m.type !== "video")?.url;
      if (img && !fallback.has(it.cat)) fallback.set(it.cat, img);
    }
  }
  return rows.map((c) => ({ id: c.id, title: c.title, handle: c.handle, description: c.description, image: c.imageUrl ?? fallback.get(c.id) ?? null, url: categoryPath(ctx.root, c.handle) }));
}

/** Everything every page gets: shop, routes, menu categories. */
export async function baseScope(ctx: ShopContext) {
  const [collections, pageRows, nav] = await Promise.all([loadCategories(ctx), footerPages(ctx.store.id), menusForTheme(ctx.store.id, ctx.root)]);
  const pages = isDemo(ctx)
    ? [{ title: "About us", url: `${ctx.root}/pages/about-us` }, { title: "Contact us", url: `${ctx.root}/pages/contact-us` }, { title: "Shipping & returns", url: `${ctx.root}/pages/shipping-returns` }]
    : pageRows.map((p) => ({ title: p.title, url: `${ctx.root}/pages/${p.handle}` }));
  return {
    shop: { name: ctx.store.name, slug: ctx.store.slug, favicon: storeIcon(ctx.store, (ctx.look?.data?.settings ?? null) as Record<string, unknown> | null), meta_pixel: /^\d{5,20}$/.test(ctx.store.metaPixelId ?? "") ? ctx.store.metaPixelId : null, logo: ctx.store.logoUrl, phone: ctx.store.supportPhone, brand_color: ctx.store.primaryColor || "#111827", currency: ctx.store.currency },
    routes: { root: ctx.root || "/", base: ctx.root, all: allProductsPath(ctx.root), cart: `${ctx.root}/cart`, search: `${ctx.root}/search`, account: accountsOn(ctx.store) ? `${ctx.root}/account` : null },
    collections, pages, preview: ctx.preview,
    ...nav, // menus (by handle), header_menu, footer_menu
    widgets: (() => { const r = widgetSettings(ctx.store.widgetSettings).reviews; return { reviews: { enabled: r.enabled, starLight: r.starLight, starDark: r.starDark, textLight: r.textLight, textDark: r.textDark, allow_photos: r.allowPhotos, allow_videos: r.allowVideos, max_video: r.maxVideoSeconds, max_media: r.maxMedia, show_verified: r.showVerified, show_date: r.showDate, show_breakdown: r.showBreakdown } }; })(),
    demo_theme: ctx.owner ? ctx.demoPreset ?? "" : "",
    preview_draft: Boolean(ctx.demoPreset || ctx.ownerPreview),
  };
}

/** Section data loader shared by every page: product grids get their products. */
export function sectionData(ctx: ShopContext, opts: { exclude?: number } = {}): SectionData {
  return async (type, settings) => {
    if (type === "custom-liquid") {
      // Custom code can loop over products from a chosen category
      const category = String(settings.collection ?? "");
      if (!category) return { products: [] };
      return { products: await loadProducts(ctx, { category: category === "all" ? undefined : category, limit: Math.min(24, Number(settings.limit) || 8) }) };
    }
    // Products picked by handle inside list items (reels, shoppable videos, fresh finds): { handle: product }
    const handles: string[] = [];
    for (const it of Array.isArray(settings.items) ? (settings.items as Record<string, unknown>[]) : []) {
      if (typeof it?.product === "string") handles.push(it.product);
      if (Array.isArray(it?.products)) handles.push(...(it.products as unknown[]).map(String));
    }
    const picked = Array.isArray(settings.products) ? (settings.products as unknown[]).map(String).filter(Boolean) : [];
    const byHandle = handles.length ? Object.fromEntries((await loadProductsByHandles(ctx, handles)).map((p) => [p.handle, p])) : {};
    if (type === "product-carousel" || type === "product-tabs") {
      const limit = Math.min(24, Number(settings.limit) || 12);
      const category = String(settings.collection ?? "") || undefined;
      const products = picked.length ? (await loadProductsByHandles(ctx, picked)).filter((p) => p.id !== opts.exclude)
        : isDemo(ctx) ? demoProducts(ctx, category).filter((p) => p.id !== opts.exclude).slice(0, limit)
        : await loadProducts(ctx, { category, limit, exclude: opts.exclude });
      return { products, products_by_handle: byHandle, collection_url: category ? categoryPath(ctx.root, category) : allProductsPath(ctx.root) };
    }
    if (type !== "product-grid") return handles.length ? { products_by_handle: byHandle } : {};
    const category = String(settings.collection ?? "") || undefined;
    const products = isDemo(ctx)
      ? demoProducts(ctx, category).slice(0, Number(settings.limit) || 8)
      : await loadProducts(ctx, { category, limit: Number(settings.limit) || 8, exclude: opts.exclude });
    return { products, collection_url: category ? categoryPath(ctx.root, category) : allProductsPath(ctx.root) };
  };
}

export function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Store from the URL's slug. Pilot: open to Growpefy's team, and to stores with the storefront switched on. */
export async function previewContext(request: Request, slug: string | undefined): Promise<ShopContext> {
  const store = slug ? await storeBySlug(slug) : null;
  if (!store || !store.active) throw new Response("Not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const preset = sp.get("gp_preset");
  const libraryId = Number(sp.get("gp_library"));
  const mode = sp.get("gp_editor") === "1" ? "editor" : sp.get("gp_draft") === "1" || preset || (Number.isSafeInteger(libraryId) && libraryId > 0) ? "draft" : "live";
  // Owners (and their team) see their own store's preview and its unpublished draft; shoppers only a switched-on store.
  if (mode !== "live" || !store.storefrontEnabled) {
    const { getViewer, requireStore } = await import("./auth.server");
    const viewer = await getViewer(request);
    const canEdit = viewer ? await requireStore(viewer, store.id).then(() => true, () => false) : false;
    if (!canEdit && !store.storefrontEnabled) throw new Response("Not found", { status: 404 });
    if (canEdit && Number.isSafeInteger(libraryId) && libraryId > 0) {
      const { getThemeCopy } = await import("./themes.server");
      const copy = await getThemeCopy(store.id, libraryId);
      if (copy) {
        const savedPreset = String(copy.data.settings.preset ?? "");
        const demoPreset = DEMO_PRESETS.includes(savedPreset) ? savedPreset : undefined;
        return { store, root: `/s/${store.slug}`, preview: true, owner: true, ownerPreview: true, demoPreset, look: { data: copy.data, editor: false } };
      }
    }
    if (canEdit && preset) {
      const { presetById, applyPreset } = await import("./theme-presets");
      const p = presetById(preset);
      const base = (await themeLook(store.id, "draft")).data ?? defaultThemeData(BASE_THEME);
      if (p) return { store, root: `/s/${store.slug}`, preview: true, owner: true, demoPreset: p.id, look: { data: applyPreset(base, p, defaultThemeData(p.theme ?? BASE_THEME)), editor: false } };
    }
    if (canEdit && mode !== "live") return { store, root: `/s/${store.slug}`, preview: true, owner: true, look: await themeLook(store.id, mode) };
  }
  return { store, root: `/s/${store.slug}`, preview: true, look: await themeLook(store.id) };
}

/** Products by id, in the order given (search results). */
export async function loadProductsByIds(ctx: ShopContext, ids: number[]) {
  if (!ids.length) return [];
  const items = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, ctx.store.id), inArray(catalogItems.id, ids)));
  const byId = new Map(items.map((i) => [i.id, i]));
  const [vmap, rmap] = await Promise.all([variantsFor(items.map((i) => i.id)), ratingsFor(items.map((i) => i.id))]);
  return ids.flatMap((id) => { const i = byId.get(id); return i ? [productDrop(ctx, i, vmap.get(id) ?? [], rmap.get(id))] : []; });
}

/** Products picked by handle in a section (carousels, reels, shoppable videos), in the order picked. */
export async function loadProductsByHandles(ctx: ShopContext, handles: string[]) {
  const list = [...new Set(handles.filter(Boolean))].slice(0, 60);
  if (!list.length) return [];
  if (isDemo(ctx)) { const all = demoProducts(ctx); return list.flatMap((h) => all.filter((p) => p.handle === h)); }
  const items = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, ctx.store.id), eq(catalogItems.status, "active"), inArray(catalogItems.handle, list)));
  const byHandle = new Map(items.map((i) => [i.handle, i]));
  const [vmap, rmap] = await Promise.all([variantsFor(items.map((i) => i.id)), ratingsFor(items.map((i) => i.id))]);
  return list.flatMap((h) => { const i = byHandle.get(h); return i ? [productDrop(ctx, i, vmap.get(i.id) ?? [], rmap.get(i.id))] : []; });
}

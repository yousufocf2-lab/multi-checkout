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

const accountsOn = (s: Store) => accountSettings(s.accountSettings).enabled;
import { catalogCategories, catalogCategoryItems, catalogItems, catalogVariants, db, stores, storeThemes, type CatalogItem, type CatalogVariant, type Store, type ThemeData, type ThemeTemplate } from "~/db.server";

// ---------- theme files ----------

const RAW = import.meta.glob("../themes/*/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** theme name -> { "sections/hero.liquid": "...", ... } */
const THEMES: Record<string, Record<string, string>> = {};
for (const [path, text] of Object.entries(RAW)) {
  const m = path.match(/^\.\.\/themes\/([^/]+)\/(.+)$/);
  if (m) (THEMES[m[1]] ??= {})[m[2]] = text;
}

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
type SchemaSetting = { id: string; default?: unknown };
function schemaOf(src: string): { name?: string; settings?: SchemaSetting[] } {
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
  liquid.registerFilter("safe_url", (url: unknown) => safeUrl(String(url ?? "")));

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
export type SectionKind = { type: string; name: string; settings: SettingDef[]; where: "template" | "header" | "footer" | "fixed" };

/** Everything the theme editor needs to know about a theme: global settings, the sections it can add, and its defaults. */
export function themeManifest(theme: string) {
  const files = THEMES[theme];
  if (!files) throw new Error(`Theme not found: ${theme}`);
  const settingsSchema = parseJson<SettingGroup[]>(files["config/settings_schema.json"], []);
  const sections: SectionKind[] = Object.keys(files).filter((f) => /^sections\/[^/]+\.liquid$/.test(f)).map((f) => {
    const type = f.slice(9, -7);
    const sc = schemaOf(files[f]);
    const where = type.startsWith("main-") ? "fixed" : type === "header" || type === "announcement" ? "header" : type === "footer" ? "footer" : "template";
    return { type, name: sc.name ?? type, settings: (sc.settings ?? []) as SettingDef[], where };
  });
  return { settingsSchema, sections, defaults: defaultThemeData(theme) };
}

export function defaultThemeData(theme: string): ThemeData {
  const files = THEMES[theme];
  const settings: Record<string, unknown> = {};
  for (const g of parseJson<SettingGroup[]>(files["config/settings_schema.json"], [])) for (const s of g.settings) if (s.default !== undefined) settings[s.id] = s.default;
  const templates = Object.fromEntries(TEMPLATES.map((t) => [t, parseJson<ThemeTemplate>(files[`templates/${t}.json`], EMPTY)]));
  return {
    settings, templates,
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
  const saved = look.data ?? null;
  const tpl = saved?.templates?.[template] ?? base.templates[template] ?? EMPTY;
  const groups = { header: saved?.groups?.header ?? base.groups.header, footer: saved?.groups?.footer ?? base.groups.footer };
  const editor = Boolean(look.editor);
  const full = { ...scope, settings: { ...base.settings, ...(saved?.settings ?? {}) }, editor };
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

function productDrop(ctx: ShopContext, item: CatalogItem, variants: CatalogVariant[]) {
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
  };
  // For the product page script (safe inside <script>)
  const json = JSON.stringify({ id: drop.id, title: drop.title, url, image: cover ? imgUrl(cover, 300) : null, options: drop.options, variants: variantDrops }).replace(/</g, "\\u003c");
  return { ...drop, json };
}

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
  if (ctx.demoPreset === "thread") return THREAD_CLOTHES.filter((p) => !category || category === "apparel" || p.category === category).map((p, i) => {
    const now = new Date();
    const item = {
      id: -(i + 201), storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: "Clothing", vendor: "Thread Studio", tags: ["sample", "apparel"], source: "manual", sourceId: null,
      descriptionHtml: `<p>${p.subtitle.toLowerCase()} with a relaxed, easy-to-layer shape. Cut for everyday movement and finished with clean details that work across your weekly rotation.</p><h3>Details</h3><ul><li>Soft-touch midweight fabric</li><li>Relaxed everyday fit</li><li>Made for repeat wear</li></ul><p>Sample product shown for theme preview only.</p>`,
      images: [{ url: threadClothesImage(p), alt: p.title }, { url: threadClothesImage(p, true), alt: `${p.title} detail` }],
      options: [{ name: "Size", values: ["XS", "S", "M", "L", "XL"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["XS", "S", "M", "L", "XL"].map((size, j) => ({
      id: -((i + 201) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: size, optionValues: [size], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true };
  });
  if (ctx.demoPreset === "luma") return LUMA_BEAUTY.filter((p) => !category || category === "skincare" || p.category === category).map((p, i) => {
    const now = new Date();
    const item = {
      id: -(i + 101), storeId: ctx.store.id, title: p.title, handle: p.handle, status: "active", productType: "Skincare", vendor: "Luma Studio", tags: ["sample", "skincare"], source: "manual", sourceId: null,
      descriptionHtml: `<p>${p.subtitle[0] + p.subtitle.slice(1).toLowerCase()} made for an easy everyday routine. A lightweight sample formula with a comfortable finish.</p><p>Sample product shown for theme preview only.</p>`,
      images: [{ url: lumaBeautyImage(p), alt: p.title }, { url: lumaBeautyImage(p, true), alt: `${p.title} detail` }],
      options: [{ name: "Size", values: ["50 ml", "Travel size"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["50 ml", "Travel size"].map((size, j) => ({
      id: -((i + 101) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: size, optionValues: [size], pricePaise: p.price, compareAtPaise: p.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true };
  });
  return MIRA_BAGS.filter((b) => !category || b.category === category).map((b, i) => {
    const now = new Date();
    const item = {
      id: -(i + 1), storeId: ctx.store.id, title: b.title, handle: b.handle, status: "active", productType: "Handbag", vendor: "Mira Studio", tags: ["sample", "handbag"], source: "manual", sourceId: null,
      descriptionHtml: "<p>A thoughtfully designed everyday bag with a considered shape, a comfortable carry and room for your daily essentials.</p><p>Sample product shown for theme preview only.</p>",
      images: [{ url: miraBagImage(b), alt: b.title }, { url: miraBagImage(b, true), alt: `${b.title} detail` }],
      options: [{ name: "Colour", values: ["Classic", "Soft neutral"] }], seoTitle: null, seoDescription: null, createdAt: now, updatedAt: now,
    } as unknown as CatalogItem;
    const variants = ["Classic", "Soft neutral"].map((colour, j) => ({
      id: -((i + 1) * 10 + j + 1), itemId: item.id, storeId: ctx.store.id, title: colour, optionValues: [colour], pricePaise: b.price, compareAtPaise: b.compare, stock: null, sku: null, imageUrl: null, position: j,
    })) as unknown as CatalogVariant[];
    return { ...productDrop(ctx, item, variants), demo: true };
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
  const vmap = await variantsFor(items.map((i) => i.id));
  return items.map((i) => productDrop(ctx, i, vmap.get(i.id) ?? []));
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
  const vmap = await variantsFor([item.id]);
  return productDrop(ctx, item, vmap.get(item.id) ?? []);
}

export async function loadCategories(ctx: ShopContext) {
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
  return rows.map((c) => ({ id: c.id, title: c.title, handle: c.handle, description: c.description, url: categoryPath(ctx.root, c.handle) }));
}

/** Everything every page gets: shop, routes, menu categories. */
export async function baseScope(ctx: ShopContext) {
  const [collections, pageRows, nav] = await Promise.all([loadCategories(ctx), footerPages(ctx.store.id), menusForTheme(ctx.store.id, ctx.root)]);
  const pages = ctx.demoPreset === "mira" || ctx.demoPreset === "luma" || ctx.demoPreset === "thread"
    ? [{ title: "About us", url: `${ctx.root}/pages/about-us` }, { title: "Contact us", url: `${ctx.root}/pages/contact-us` }, { title: "Shipping & returns", url: `${ctx.root}/pages/shipping-returns` }]
    : pageRows.map((p) => ({ title: p.title, url: `${ctx.root}/pages/${p.handle}` }));
  return {
    shop: { name: ctx.store.name, slug: ctx.store.slug, favicon: storeIcon(ctx.store, (ctx.look?.data?.settings ?? null) as Record<string, unknown> | null), meta_pixel: /^\d{5,20}$/.test(ctx.store.metaPixelId ?? "") ? ctx.store.metaPixelId : null, logo: ctx.store.logoUrl, phone: ctx.store.supportPhone, brand_color: ctx.store.primaryColor || "#111827", currency: ctx.store.currency },
    routes: { root: ctx.root || "/", base: ctx.root, all: allProductsPath(ctx.root), cart: `${ctx.root}/cart`, search: `${ctx.root}/search`, account: accountsOn(ctx.store) ? `${ctx.root}/account` : null },
    collections, pages, preview: ctx.preview,
    ...nav, // menus (by handle), header_menu, footer_menu
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
    if (type !== "product-grid") return {};
    const category = String(settings.collection ?? "") || undefined;
    const products = ctx.demoPreset === "mira" || ctx.demoPreset === "luma" || ctx.demoPreset === "thread"
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
        const demoPreset = ["mira", "luma", "thread"].includes(savedPreset) ? savedPreset : undefined;
        return { store, root: `/s/${store.slug}`, preview: true, owner: true, ownerPreview: true, demoPreset, look: { data: copy.data, editor: false } };
      }
    }
    if (canEdit && preset) {
      const { presetById, applyPreset } = await import("./theme-presets");
      const p = presetById(preset);
      const base = (await themeLook(store.id, "draft")).data ?? defaultThemeData("swift");
      if (p) return { store, root: `/s/${store.slug}`, preview: true, owner: true, demoPreset: p.id, look: { data: applyPreset(base, p), editor: false } };
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
  const vmap = await variantsFor(items.map((i) => i.id));
  return ids.flatMap((id) => { const i = byId.get(id); return i ? [productDrop(ctx, i, vmap.get(id) ?? [])] : []; });
}

// Growpefy Store storefront: renders a store's website from a Liquid theme (Shopify OS 2.0 style:
// layout + JSON templates listing sections, each section a Liquid file with a {% schema %} of settings).
// Themes ship in app/themes/<name>; later a store's own copy (edited in "Edit code") will live in the database.
import { Liquid, Tag, type Context, type Emitter, type TagToken, type TopLevelToken } from "liquidjs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { coverOf } from "./catalog.server";
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
export type ShopContext = { store: Store; root: string; preview: boolean; look?: Look; owner?: boolean };

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
  const rows = await db.select().from(catalogCategories).where(eq(catalogCategories.storeId, ctx.store.id)).orderBy(asc(catalogCategories.position), asc(catalogCategories.title));
  return rows.map((c) => ({ id: c.id, title: c.title, handle: c.handle, description: c.description, url: categoryPath(ctx.root, c.handle) }));
}

/** Everything every page gets: shop, routes, menu categories. */
export async function baseScope(ctx: ShopContext) {
  const [collections, pageRows] = await Promise.all([loadCategories(ctx), footerPages(ctx.store.id)]);
  return {
    shop: { name: ctx.store.name, slug: ctx.store.slug, favicon: storeIcon(ctx.store, (ctx.look?.data?.settings ?? null) as Record<string, unknown> | null), meta_pixel: /^\d{5,20}$/.test(ctx.store.metaPixelId ?? "") ? ctx.store.metaPixelId : null, logo: ctx.store.logoUrl, phone: ctx.store.supportPhone, brand_color: ctx.store.primaryColor || "#111827", currency: ctx.store.currency },
    routes: { root: ctx.root || "/", base: ctx.root, all: allProductsPath(ctx.root), cart: `${ctx.root}/cart`, account: accountsOn(ctx.store) ? `${ctx.root}/account` : null },
    collections, pages: pageRows.map((p) => ({ title: p.title, url: `${ctx.root}/pages/${p.handle}` })), preview: ctx.preview,
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
    const products = await loadProducts(ctx, { category, limit: Number(settings.limit) || 8, exclude: opts.exclude });
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
  const mode = sp.get("gp_editor") === "1" ? "editor" : sp.get("gp_draft") === "1" || preset ? "draft" : "live";
  // Owners (and their team) see their own store's preview and its unpublished draft; shoppers only a switched-on store.
  if (mode !== "live" || !store.storefrontEnabled) {
    const { getViewer, requireStore } = await import("./auth.server");
    const viewer = await getViewer(request);
    const canEdit = viewer ? await requireStore(viewer, store.id).then(() => true, () => false) : false;
    if (!canEdit && !store.storefrontEnabled) throw new Response("Not found", { status: 404 });
    if (canEdit && preset) {
      const { presetById, applyPreset } = await import("./theme-presets");
      const p = presetById(preset);
      const base = (await themeLook(store.id, "draft")).data ?? defaultThemeData("swift");
      if (p) return { store, root: `/s/${store.slug}`, preview: true, owner: true, look: { data: applyPreset(base, p), editor: false } };
    }
    if (canEdit && mode !== "live") return { store, root: `/s/${store.slug}`, preview: true, owner: true, look: await themeLook(store.id, mode) };
  }
  return { store, root: `/s/${store.slug}`, preview: true, look: await themeLook(store.id) };
}

// Growpefy Store storefront: renders a store's website from a Liquid theme (Shopify OS 2.0 style:
// layout + JSON templates listing sections, each section a Liquid file with a {% schema %} of settings).
// Themes ship in app/themes/<name>; later a store's own copy (edited in "Edit code") will live in the database.
import { Liquid, Tag, type Context, type Emitter, type TagToken, type TopLevelToken } from "liquidjs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { catalogCategories, catalogCategoryItems, catalogItems, catalogVariants, db, stores, type CatalogItem, type CatalogVariant, type Store } from "~/db.server";

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

async function renderSection(theme: string, type: string, id: string, settings: Record<string, unknown>, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const files = THEMES[theme];
  const src = files[`sections/${type}.liquid`];
  if (src == null) return `<!-- missing section ${type} -->`;
  const defaults = Object.fromEntries((schemaOf(src).settings ?? []).map((s) => [s.id, s.default ?? ""]));
  const liquid = engineFor(theme);
  return liquid.renderFile(`sections/${type}`, { ...scope, section: { id, type, settings: { ...defaults, ...settings }, ...extra } });
}

type TemplateJson = { sections: Record<string, { type: string; settings?: Record<string, unknown> }>; order: string[] };

/** Extra data a section needs before it renders (product grids load their products). */
type SectionData = (type: string, settings: Record<string, unknown>) => Promise<Record<string, unknown>>;

export async function renderPage(theme: string, template: string, scope: Record<string, unknown>, data: SectionData) {
  const files = THEMES[theme];
  const tpl = JSON.parse(files[`templates/${template}.json`] ?? '{"sections":{},"order":[]}') as TemplateJson;
  const parts: string[] = [];
  for (const id of tpl.order) {
    const s = tpl.sections[id];
    if (!s) continue;
    const settings = s.settings ?? {};
    const extra = await data(s.type, settings);
    parts.push(await renderSection(theme, s.type, id, settings, scope, extra));
  }
  return engineFor(theme).renderFile("layout/theme", { ...scope, content_for_layout: parts.join("\n") });
}

// ---------- data (Liquid "drops") ----------

export type ShopContext = { store: Store; root: string; preview: boolean };

export async function storeBySlug(slug: string) {
  const [s] = await db.select().from(stores).where(eq(stores.slug, slug)).limit(1);
  return s ?? null;
}

function productDrop(ctx: ShopContext, item: CatalogItem, variants: CatalogVariant[]) {
  const vs = variants.slice().sort((a, b) => a.position - b.position);
  const images = item.images.map((i) => ({ src: i.url, alt: i.alt ?? item.title }));
  const variantDrops = vs.map((v) => ({
    id: v.id, title: v.title, option_values: v.optionValues, price: v.pricePaise, compare_at_price: v.compareAtPaise ?? 0,
    available: v.stock == null || v.stock > 0, image: v.imageUrl ? imgUrl(v.imageUrl, 1100) : null, sku: v.sku,
  }));
  const cheapest = variantDrops.filter((v) => v.available).sort((a, b) => a.price - b.price)[0] ?? variantDrops[0];
  const price = cheapest?.price ?? 0;
  const compare = cheapest?.compare_at_price ?? 0;
  const url = `${ctx.root}/products/${item.handle}`;
  const drop = {
    id: item.id, title: item.title, handle: item.handle, url, description: item.descriptionHtml, images, featured_image: images[0]?.src ?? null,
    options: item.options, variants: variantDrops, price, compare_at_price: compare, available: variantDrops.some((v) => v.available),
    discount_pct: compare > price ? Math.round((1 - price / compare) * 100) : 0,
    seo_title: item.seoTitle, seo_description: item.seoDescription,
  };
  // For the product page script (safe inside <script>)
  const json = JSON.stringify({ id: drop.id, title: drop.title, url, image: images[0] ? imgUrl(images[0].src, 300) : null, options: drop.options, variants: variantDrops }).replace(/</g, "\\u003c");
  return { ...drop, json };
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
  const [item] = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, ctx.store.id), eq(catalogItems.handle, handle), eq(catalogItems.status, "active"))).limit(1);
  if (!item) return null;
  const vmap = await variantsFor([item.id]);
  return productDrop(ctx, item, vmap.get(item.id) ?? []);
}

export async function loadCategories(ctx: ShopContext) {
  const rows = await db.select().from(catalogCategories).where(eq(catalogCategories.storeId, ctx.store.id)).orderBy(asc(catalogCategories.position), asc(catalogCategories.title));
  return rows.map((c) => ({ id: c.id, title: c.title, handle: c.handle, description: c.description, url: `${ctx.root}/collections/${c.handle}` }));
}

/** Everything every page gets: shop, routes, menu categories. */
export async function baseScope(ctx: ShopContext) {
  const collections = await loadCategories(ctx);
  return {
    shop: { name: ctx.store.name, slug: ctx.store.slug, logo: ctx.store.logoUrl, phone: ctx.store.supportPhone, brand_color: ctx.store.primaryColor || "#111827", currency: ctx.store.currency },
    routes: { root: ctx.root || "/", all: `${ctx.root}/collections/all`, cart: `${ctx.root}/cart` },
    collections, pages: [] as { title: string; url: string }[], preview: ctx.preview,
  };
}

/** Section data loader shared by every page: product grids get their products. */
export function sectionData(ctx: ShopContext, opts: { exclude?: number } = {}): SectionData {
  return async (type, settings) => {
    if (type !== "product-grid") return {};
    const category = String(settings.collection ?? "") || undefined;
    const products = await loadProducts(ctx, { category, limit: Number(settings.limit) || 8, exclude: opts.exclude });
    return { products, collection_url: category ? `${ctx.root}/collections/${category}` : `${ctx.root}/collections/all` };
  };
}

export function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Store from the URL's slug. Pilot: open to Growpefy's team, and to stores with the storefront switched on. */
export async function previewContext(request: Request, slug: string | undefined): Promise<ShopContext> {
  const store = slug ? await storeBySlug(slug) : null;
  if (!store || !store.active) throw new Response("Not found", { status: 404 });
  if (!store.storefrontEnabled) {
    const { getViewer } = await import("./auth.server");
    const viewer = await getViewer(request);
    if (viewer?.role !== "admin") throw new Response("Not found", { status: 404 });
  }
  return { store, root: `/s/${store.slug}`, preview: true };
}

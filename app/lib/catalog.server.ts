// Growpefy Store catalog: items (products / dishes / courses ...), their variants and categories.
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { nudgeCatalog } from "./meta-catalog.server";
import { catalogCategories, catalogCategoryItems, catalogItems, catalogVariants, db, stores, type ItemImage, type ItemOption, type Store } from "~/db.server";
import type { Viewer } from "./auth.server";
import { toHandle } from "./business-types";
import { rupeesToPaise, type PricedLine } from "./pricing";
import { fetchCatalogPage } from "./shopify.server";
import { orderName } from "./store-profile";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, mediaReady, uploadMedia } from "./media.server";

export type ItemStatus = "active" | "draft" | "archived";

/** First photo of an item (a video's poster when it only has videos). */
export function coverOf(media: ItemImage[]) {
  return media.find((m) => m.type !== "video")?.url ?? media.find((m) => m.poster)?.poster ?? null;
}

/** Pilot: the own-store catalog is open to Growpefy's team, and to stores that have it switched on. */
export function catalogAllowed(viewer: Viewer, store: Store) {
  return viewer.role === "admin" || store.storefrontEnabled;
}

export type StockFilter = "in" | "low" | "out" | "untracked";
export type ItemSort = "newest" | "oldest" | "updated" | "title" | "price_asc" | "price_desc" | "stock_asc";
export type ListOpts = { q?: string; status?: ItemStatus | "all"; category?: number | null; type?: string | null; vendor?: string | null; stock?: StockFilter | null; sort?: ItemSort };
const LOW_STOCK = 5;

/** List for the Products page: one row per item with its price range, stock and first photo; newest first by default. */
export async function listItems(storeId: number, opts: ListOpts = {}) {
  const where = [eq(catalogItems.storeId, storeId)];
  if (opts.status && opts.status !== "all") where.push(eq(catalogItems.status, opts.status));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    where.push(sql`(${catalogItems.title} ilike ${q} or ${catalogItems.tags}::text ilike ${q} or ${catalogItems.vendor} ilike ${q}
      or exists (select 1 from ${catalogVariants} v where v.item_id = ${catalogItems.id} and v.sku ilike ${q}))`);
  }
  if (opts.type) where.push(eq(catalogItems.productType, opts.type));
  if (opts.vendor) where.push(eq(catalogItems.vendor, opts.vendor));
  if (opts.category) where.push(sql`exists (select 1 from ${catalogCategoryItems} ci where ci.item_id = ${catalogItems.id} and ci.category_id = ${opts.category})`);
  const stock = sql<number | null>`sum(${catalogVariants.stock})::int`;
  const tracked = sql<boolean>`bool_or(${catalogVariants.stock} is not null)`;
  const having = opts.stock === "out" ? sql`bool_or(${catalogVariants.stock} is not null) and coalesce(sum(${catalogVariants.stock}),0) <= 0`
    : opts.stock === "low" ? sql`bool_or(${catalogVariants.stock} is not null) and sum(${catalogVariants.stock}) between 1 and ${LOW_STOCK}`
    : opts.stock === "in" ? sql`(not bool_or(${catalogVariants.stock} is not null)) or sum(${catalogVariants.stock}) > 0`
    : opts.stock === "untracked" ? sql`not coalesce(bool_or(${catalogVariants.stock} is not null), false)` : undefined;
  const order = {
    newest: [desc(catalogItems.createdAt), desc(catalogItems.id)], oldest: [asc(catalogItems.createdAt)], updated: [desc(catalogItems.updatedAt)],
    title: [asc(sql`lower(${catalogItems.title})`)], price_asc: [asc(sql`min(${catalogVariants.pricePaise})`)], price_desc: [desc(sql`max(${catalogVariants.pricePaise})`)],
    stock_asc: [asc(sql`coalesce(sum(${catalogVariants.stock}), 999999999)`)],
  }[opts.sort ?? "newest"];
  const q = db
    .select({
      id: catalogItems.id, title: catalogItems.title, handle: catalogItems.handle, status: catalogItems.status, images: catalogItems.images,
      productType: catalogItems.productType, vendor: catalogItems.vendor, source: catalogItems.source, createdAt: catalogItems.createdAt, updatedAt: catalogItems.updatedAt,
      variants: sql<number>`count(${catalogVariants.id})::int`,
      minPrice: sql<number | null>`min(${catalogVariants.pricePaise})`,
      maxPrice: sql<number | null>`max(${catalogVariants.pricePaise})`,
      stock, tracked,
      categories: sql<string[]>`coalesce((select array_agg(c.title order by c.title) from ${catalogCategoryItems} ci join ${catalogCategories} c on c.id = ci.category_id where ci.item_id = ${catalogItems.id}), '{}')`,
    })
    .from(catalogItems)
    .leftJoin(catalogVariants, eq(catalogVariants.itemId, catalogItems.id))
    .where(and(...where))
    .groupBy(catalogItems.id);
  const rows = await (having ? q.having(having) : q).orderBy(...order).limit(500);
  return rows.map((r) => ({ ...r, image: coverOf(r.images) }));
}

/** Small numbers above the Products list. */
export async function catalogStats(storeId: number) {
  const [r] = await db.select({
    active: sql<number>`count(distinct ${catalogItems.id}) filter (where ${catalogItems.status} = 'active')::int`,
    out: sql<number>`count(distinct ${catalogItems.id}) filter (where ${catalogVariants.stock} is not null and ${catalogVariants.stock} <= 0)::int`,
    low: sql<number>`count(distinct ${catalogItems.id}) filter (where ${catalogVariants.stock} between 1 and ${LOW_STOCK})::int`,
    value: sql<number>`coalesce(sum(greatest(${catalogVariants.stock}, 0)::bigint * ${catalogVariants.pricePaise}), 0)::float8`,
  }).from(catalogItems).leftJoin(catalogVariants, eq(catalogVariants.itemId, catalogItems.id)).where(eq(catalogItems.storeId, storeId));
  return r ?? { active: 0, out: 0, low: 0, value: 0 };
}

/** Types and brands already used, for filters and suggestions. */
export async function catalogFacets(storeId: number) {
  const rows = await db.selectDistinct({ type: catalogItems.productType, vendor: catalogItems.vendor }).from(catalogItems).where(eq(catalogItems.storeId, storeId));
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))].sort((a, b) => a.localeCompare(b));
  return { types: uniq(rows.map((r) => r.type)), vendors: uniq(rows.map((r) => r.vendor)) };
}

export async function deleteItems(storeId: number, ids: number[]) {
  if (!ids.length) return;
  await db.delete(catalogItems).where(and(eq(catalogItems.storeId, storeId), inArray(catalogItems.id, ids)));
  nudgeCatalog(storeId);
}

/** Every variant with its stock, for the Inventory page. */
export async function listInventory(storeId: number, q?: string) {
  const where = [eq(catalogVariants.storeId, storeId)];
  if (q?.trim()) where.push(sql`(${catalogItems.title} ilike ${`%${q.trim()}%`} or ${catalogVariants.sku} ilike ${`%${q.trim()}%`})`);
  return db.select({
    id: catalogVariants.id, itemId: catalogItems.id, title: catalogItems.title, variant: catalogVariants.title, sku: catalogVariants.sku,
    stock: catalogVariants.stock, pricePaise: catalogVariants.pricePaise, images: catalogItems.images, imageUrl: catalogVariants.imageUrl,
  }).from(catalogVariants).innerJoin(catalogItems, eq(catalogItems.id, catalogVariants.itemId)).where(and(...where))
    .orderBy(asc(sql`lower(${catalogItems.title})`), asc(catalogVariants.position)).limit(1000)
    .then((rows) => rows.map((r) => ({ ...r, image: r.imageUrl ?? coverOf(r.images) })));
}

/** Set or adjust stock of one variant (null = stop tracking). */
export async function setStock(storeId: number, variantId: number, stock: number | null) {
  await db.update(catalogVariants).set({ stock: stock == null ? null : Math.max(0, Math.round(stock)) }).where(and(eq(catalogVariants.storeId, storeId), eq(catalogVariants.id, variantId)));
  nudgeCatalog(storeId);
}

export async function renameCategory(storeId: number, id: number, title: string) {
  if (!title.trim()) throw new Error("Give the category a name.");
  await db.update(catalogCategories).set({ title: title.trim() }).where(and(eq(catalogCategories.storeId, storeId), eq(catalogCategories.id, id)));
}

export async function countByStatus(storeId: number) {
  const rows = await db.select({ status: catalogItems.status, n: sql<number>`count(*)::int` }).from(catalogItems).where(eq(catalogItems.storeId, storeId)).groupBy(catalogItems.status);
  const out = { all: 0, active: 0, draft: 0, archived: 0 };
  for (const r of rows) { out[r.status] = r.n; out.all += r.n; }
  return out;
}

export async function getItem(storeId: number, id: number) {
  const [item] = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, storeId), eq(catalogItems.id, id))).limit(1);
  if (!item) return null;
  const variants = await db.select().from(catalogVariants).where(eq(catalogVariants.itemId, id)).orderBy(asc(catalogVariants.position));
  const cats = await db.select({ id: catalogCategories.id }).from(catalogCategoryItems)
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogCategoryItems.categoryId)).where(eq(catalogCategoryItems.itemId, id));
  return { item, variants, categoryIds: cats.map((c) => c.id) };
}

export async function listCategories(storeId: number) {
  return db
    .select({ id: catalogCategories.id, title: catalogCategories.title, handle: catalogCategories.handle, items: sql<number>`count(${catalogCategoryItems.itemId})::int` })
    .from(catalogCategories)
    .leftJoin(catalogCategoryItems, eq(catalogCategoryItems.categoryId, catalogCategories.id))
    .where(eq(catalogCategories.storeId, storeId))
    .groupBy(catalogCategories.id)
    .orderBy(asc(catalogCategories.position), asc(catalogCategories.title));
}

/** A handle not yet used in this store ("watch", "watch-2", ...). */
async function freeHandle(storeId: number, wanted: string, exceptId?: number) {
  const base = toHandle(wanted);
  const taken = await db.select({ id: catalogItems.id, handle: catalogItems.handle }).from(catalogItems)
    .where(and(eq(catalogItems.storeId, storeId), ilike(catalogItems.handle, `${base}%`)));
  const used = new Set(taken.filter((t) => t.id !== exceptId).map((t) => t.handle));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export type VariantInput = { title: string; optionValues: string[]; sku: string | null; pricePaise: number; compareAtPaise: number | null; stock: number | null; weightGrams?: number | null; imageUrl?: string | null; sourceId?: string | null };
export type ItemInput = {
  title: string; handle?: string; descriptionHtml: string; status: ItemStatus; vendor?: string | null; productType?: string | null;
  tags: string[]; images: ItemImage[]; options: ItemOption[]; variants: VariantInput[]; categoryIds: number[];
  seoTitle?: string | null; seoDescription?: string | null; kind?: Store["businessType"]; extra?: Record<string, unknown>;
  source?: "manual" | "shopify"; sourceId?: string | null;
};

/** Create (no id) or update an item; its variants and categories are replaced by the ones given. */
export async function saveItem(store: Store, input: ItemInput, id?: number) {
  if (!input.title.trim()) throw new Error("Give it a name.");
  if (input.variants.length === 0) throw new Error("Add a price.");
  if (input.variants.some((v) => v.pricePaise < 0)) throw new Error("Price can't be negative.");
  const handle = await freeHandle(store.id, input.handle?.trim() || input.title, id);
  const savedId = await db.transaction(async (tx) => {
    const values = {
      title: input.title.trim(), handle, descriptionHtml: input.descriptionHtml, status: input.status,
      vendor: input.vendor ?? null, productType: input.productType ?? null, tags: input.tags, images: input.images, options: input.options,
      seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null, updatedAt: new Date(),
      ...(input.source ? { source: input.source } : {}), ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
      ...(input.extra ? { extra: input.extra } : {}),
    };
    let itemId = id;
    if (itemId) {
      const r = await tx.update(catalogItems).set(values).where(and(eq(catalogItems.id, itemId), eq(catalogItems.storeId, store.id))).returning({ id: catalogItems.id });
      if (!r.length) throw new Error("This item no longer exists.");
      await tx.delete(catalogCategoryItems).where(eq(catalogCategoryItems.itemId, itemId));
    } else {
      const [r] = await tx.insert(catalogItems).values({ ...values, storeId: store.id, kind: input.kind ?? store.businessType }).returning({ id: catalogItems.id });
      itemId = r.id;
    }
    // Keep each variant's id when its option values stay the same, so carts and order links don't break after an edit
    const before = id ? await tx.select({ id: catalogVariants.id, optionValues: catalogVariants.optionValues }).from(catalogVariants).where(eq(catalogVariants.itemId, itemId)) : [];
    const byKey = new Map(before.map((v) => [v.optionValues.join("\u0001"), v.id]));
    const kept = new Set<number>();
    for (const [i, v] of input.variants.entries()) {
      const row = {
        itemId: itemId!, storeId: store.id, title: v.title || "Default", optionValues: v.optionValues, sku: v.sku || null,
        pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise, stock: v.stock, weightGrams: v.weightGrams ?? null, imageUrl: v.imageUrl ?? null, position: i, sourceId: v.sourceId ?? null,
      };
      const existing = byKey.get(v.optionValues.join("\u0001"));
      if (existing && !kept.has(existing)) { kept.add(existing); await tx.update(catalogVariants).set(row).where(eq(catalogVariants.id, existing)); }
      else await tx.insert(catalogVariants).values(row);
    }
    const gone = before.filter((v) => !kept.has(v.id)).map((v) => v.id);
    if (gone.length) await tx.delete(catalogVariants).where(inArray(catalogVariants.id, gone));
    if (input.categoryIds.length) {
      const own = await tx.select({ id: catalogCategories.id }).from(catalogCategories).where(and(eq(catalogCategories.storeId, store.id), inArray(catalogCategories.id, input.categoryIds)));
      if (own.length) await tx.insert(catalogCategoryItems).values(own.map((c) => ({ categoryId: c.id, itemId: itemId! }))).onConflictDoNothing();
    }
    return itemId!;
  });
  nudgeCatalog(store.id);
  return savedId;
}

export async function setItemsStatus(storeId: number, ids: number[], status: ItemStatus) {
  if (!ids.length) return;
  await db.update(catalogItems).set({ status, updatedAt: new Date() }).where(and(eq(catalogItems.storeId, storeId), inArray(catalogItems.id, ids)));
  nudgeCatalog(storeId);
}

export async function deleteItem(storeId: number, id: number) {
  await db.delete(catalogItems).where(and(eq(catalogItems.storeId, storeId), eq(catalogItems.id, id)));
  nudgeCatalog(storeId);
}

export async function createCategory(storeId: number, title: string) {
  const t = title.trim();
  if (!t) throw new Error("Give the category a name.");
  const base = toHandle(t);
  const taken = new Set((await db.select({ h: catalogCategories.handle }).from(catalogCategories).where(and(eq(catalogCategories.storeId, storeId), ilike(catalogCategories.handle, `${base}%`)))).map((r) => r.h));
  let handle = base;
  for (let i = 2; taken.has(handle); i++) handle = `${base}-${i}`;
  await db.insert(catalogCategories).values({ storeId, title: t, handle });
}

export async function deleteCategory(storeId: number, id: number) {
  await db.delete(catalogCategories).where(and(eq(catalogCategories.storeId, storeId), eq(catalogCategories.id, id)));
}

/**
 * Copies a photo from Shopify's CDN into Growpefy's media storage, so the website keeps working after the Shopify
 * store closes. Keeps the Shopify URL if storage isn't set up or the copy fails. `known` avoids copying twice.
 */
async function copyShopifyImage(storeId: number, url: string | null | undefined, known: Map<string, string>): Promise<string | null> {
  if (!url) return null;
  if (known.has(url)) return known.get(url)!;
  if (!mediaReady() || !/^https:\/\/cdn\.shopify\.com\//i.test(url)) return url;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const size = Number(r.headers.get("content-length")) || 0;
    if (!r.ok || !r.body || !(type in IMAGE_TYPES) || size > MAX_IMAGE_BYTES) return url;
    const up = await uploadMedia(storeId, type, r.body, size);
    known.set(url, up.url);
    return up.url;
  } catch (e) {
    console.warn(`[catalog-import] image copy failed store=${storeId}: ${e instanceof Error ? e.message : e}`);
    return url;
  }
}

/**
 * Copies the store's Shopify products, variants, photos and collections into the Growpefy catalog.
 * Safe to run again: items already imported are updated (matched by their Shopify id), nothing is duplicated.
 */
export async function importFromShopify(store: Store) {
  const started = Date.now();
  let after: string | null = null;
  let items = 0, variants = 0, categories = 0;
  const catIds = new Map<string, number>();

  for (let page = 0; page < 200; page++) {
    const res = await fetchCatalogPage(store, after);
    for (const p of res.nodes) {
      // Categories this product is in
      const myCats: number[] = [];
      for (const c of p.collections.nodes) {
        let cid = catIds.get(c.id);
        if (!cid) {
          const [row] = await db.insert(catalogCategories)
            .values({ storeId: store.id, title: c.title, handle: c.handle, source: "shopify", sourceId: c.id })
            .onConflictDoUpdate({ target: [catalogCategories.storeId, catalogCategories.sourceId], set: { title: c.title } })
            .returning({ id: catalogCategories.id })
            .catch(async () => db.select({ id: catalogCategories.id }).from(catalogCategories).where(and(eq(catalogCategories.storeId, store.id), eq(catalogCategories.handle, c.handle))));
          if (!row) continue;
          cid = row.id;
          catIds.set(c.id, cid);
          categories++;
        }
        myCats.push(cid);
      }

      const status: ItemStatus = p.status === "ACTIVE" ? "active" : p.status === "ARCHIVED" ? "archived" : "draft";
      const [existing] = await db.select({ id: catalogItems.id, images: catalogItems.images }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.sourceId, p.id))).limit(1);
      // Photos already copied on an earlier import are reused
      const known = new Map<string, string>();
      for (const im of existing?.images ?? []) if (im.src) known.set(im.src, im.url);
      const images = (await Promise.all(p.media.nodes.map(async (m): Promise<ItemImage[]> => {
        if (m.image) {
          const url = (await copyShopifyImage(store.id, m.image.url, known)) ?? m.image.url;
          return [{ url, alt: m.image.altText ?? undefined, type: "image", ...(url !== m.image.url ? { src: m.image.url } : {}) }];
        }
        const mp4 = m.sources?.find((s) => s.mimeType === "video/mp4") ?? m.sources?.[0];
        const poster = m.preview?.image?.url ? (await copyShopifyImage(store.id, m.preview.image.url, known)) ?? undefined : undefined;
        return mp4 ? [{ url: mp4.url, type: "video", poster }] : [];
      }))).flat();
      const options = p.options.filter((o) => !(o.name === "Title" && o.optionValues.length === 1 && o.optionValues[0].name === "Default Title"))
        .map((o) => ({ name: o.name, values: o.optionValues.map((v) => v.name) }));
      const vs: VariantInput[] = await Promise.all(p.variants.nodes.map(async (v) => ({
        title: v.title === "Default Title" ? "Default" : v.title,
        optionValues: options.length ? v.selectedOptions.map((s) => s.value) : [],
        sku: v.sku || null,
        pricePaise: rupeesToPaise(v.price) ?? 0,
        compareAtPaise: rupeesToPaise(v.compareAtPrice),
        stock: v.inventoryItem?.tracked ? v.inventoryQuantity ?? 0 : null,
        imageUrl: v.image?.url ? await copyShopifyImage(store.id, v.image.url, known) : null,
        sourceId: v.id,
      })));
      const id = await saveItem(store, {
        title: p.title, handle: existing ? undefined : p.handle, descriptionHtml: p.descriptionHtml ?? "", status,
        vendor: p.vendor, productType: p.productType || null, tags: p.tags, images, options, variants: vs.length ? vs : [{ title: "Default", optionValues: [], sku: null, pricePaise: 0, compareAtPaise: null, stock: null }],
        categoryIds: myCats, seoTitle: p.seo.title, seoDescription: p.seo.description, kind: "store",
      }, existing?.id);
      if (!existing) await db.update(catalogItems).set({ source: "shopify", sourceId: p.id }).where(eq(catalogItems.id, id));
      items++;
      variants += vs.length;
    }
    if (!res.pageInfo.hasNextPage || !res.pageInfo.endCursor) break;
    after = res.pageInfo.endCursor;
  }
  console.log(`[catalog-import] store=${store.id} items=${items} variants=${variants} categories=${categories} in ${Math.round((Date.now() - started) / 1000)}s`);
  return { items, variants, categories };
}

// ---------- checkout (Growpefy Store orders) ----------
// Checkout lines from a Growpefy Store carry variant ids like "gp:123" (catalog_variants.id), so the same checkout
// can price them from our own catalog and keep the order in Growpefy instead of creating it on Shopify.

export const GP_PREFIX = "gp:";
export const isCatalogVariant = (id: string) => id.startsWith(GP_PREFIX);
const gpNum = (id: string) => Number(id.slice(GP_PREFIX.length)) || 0;

/** Live prices from the catalog (never from the browser). Sold-out or hidden items are left out. */
export async function catalogLines(store: Store, items: { variantId: string; quantity: number }[]): Promise<PricedLine[]> {
  const ids = items.map((i) => gpNum(i.variantId)).filter(Boolean);
  if (!ids.length) return [];
  const rows = await db.select({ v: catalogVariants, i: catalogItems }).from(catalogVariants)
    .innerJoin(catalogItems, eq(catalogItems.id, catalogVariants.itemId))
    .where(and(eq(catalogVariants.storeId, store.id), inArray(catalogVariants.id, ids), eq(catalogItems.status, "active")));
  const by = new Map(rows.map((r) => [r.v.id, r]));
  const out: PricedLine[] = [];
  for (const it of items) {
    const r = by.get(gpNum(it.variantId));
    if (!r) continue;
    const keepSelling = Boolean((r.i.extra as { continueSelling?: boolean } | null)?.continueSelling);
    const qty = r.v.stock == null || keepSelling ? it.quantity : Math.min(it.quantity, Math.max(0, r.v.stock));
    if (qty <= 0) continue;
    out.push({
      variantId: it.variantId, productId: `${GP_PREFIX}${r.i.id}`, title: r.i.title,
      variantTitle: r.v.title === "Default" ? null : r.v.title,
      image: r.v.imageUrl ?? coverOf(r.i.images), quantity: qty,
      pricePaise: r.v.pricePaise, comparePaise: r.v.compareAtPaise && r.v.compareAtPaise > r.v.pricePaise ? r.v.compareAtPaise : null,
    });
  }
  return out;
}

export async function catalogSkus(store: Store, variantIds: string[]) {
  const ids = variantIds.filter(isCatalogVariant).map(gpNum).filter(Boolean);
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await db.select({ id: catalogVariants.id, sku: catalogVariants.sku }).from(catalogVariants).where(and(eq(catalogVariants.storeId, store.id), inArray(catalogVariants.id, ids)));
  for (const r of rows) out.set(`${GP_PREFIX}${r.id}`, r.sku ?? "");
  return out;
}

/** "Creates" a Growpefy Store order: it already lives in Growpefy, so this only takes the stock and names it. */
export async function placeCatalogOrder(store: Store, order: { id: string; items: { variantId: string; quantity: number }[] }) {
  for (const l of order.items) {
    if (!isCatalogVariant(l.variantId)) continue;
    await db.update(catalogVariants)
      .set({ stock: sql`greatest(0, ${catalogVariants.stock} - ${l.quantity})` })
      .where(and(eq(catalogVariants.id, gpNum(l.variantId)), eq(catalogVariants.storeId, store.id), sql`${catalogVariants.stock} is not null`));
  }
  // Next order number for this store: prefix + number + suffix, numbers from the store's start (1001 by default)
  const [seq] = await db.update(stores)
    .set({ orderSeq: sql`greatest(coalesce(${stores.orderSeq}, ${stores.orderStart} - 1) + 1, ${stores.orderStart})` })
    .where(eq(stores.id, store.id))
    .returning({ n: stores.orderSeq, prefix: stores.orderPrefix, suffix: stores.orderSuffix });
  const name = seq?.n ? orderName(seq.prefix, seq.n, seq.suffix) : `#GP${order.id.slice(0, 6).toUpperCase()}`;
  nudgeCatalog(store.id); // stock may have dropped
  return { id: `${GP_PREFIX}${order.id}`, name };
}

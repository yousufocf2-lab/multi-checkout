// Growpefy Store catalog: items (products / dishes / courses ...), their variants and categories.
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { catalogCategories, catalogCategoryItems, catalogItems, catalogVariants, db, type ItemImage, type ItemOption, type Store } from "~/db.server";
import type { Viewer } from "./auth.server";
import { toHandle } from "./business-types";
import { rupeesToPaise, type PricedLine } from "./pricing";
import { fetchCatalogPage } from "./shopify.server";

export type ItemStatus = "active" | "draft" | "archived";

/** First photo of an item (a video's poster when it only has videos). */
export function coverOf(media: ItemImage[]) {
  return media.find((m) => m.type !== "video")?.url ?? media.find((m) => m.poster)?.poster ?? null;
}

/** Pilot: the own-store catalog is open to Growpefy's team, and to stores that have it switched on. */
export function catalogAllowed(viewer: Viewer, store: Store) {
  return viewer.role === "admin" || store.storefrontEnabled;
}

/** List for the Products page: one row per item with its price range, stock and first photo. */
export async function listItems(storeId: number, opts: { q?: string; status?: ItemStatus | "all" } = {}) {
  const where = [eq(catalogItems.storeId, storeId)];
  if (opts.status && opts.status !== "all") where.push(eq(catalogItems.status, opts.status));
  if (opts.q?.trim()) where.push(ilike(catalogItems.title, `%${opts.q.trim()}%`));
  const rows = await db
    .select({
      id: catalogItems.id, title: catalogItems.title, status: catalogItems.status, images: catalogItems.images,
      productType: catalogItems.productType, source: catalogItems.source, updatedAt: catalogItems.updatedAt,
      variants: sql<number>`count(${catalogVariants.id})::int`,
      minPrice: sql<number | null>`min(${catalogVariants.pricePaise})`,
      maxPrice: sql<number | null>`max(${catalogVariants.pricePaise})`,
      stock: sql<number | null>`sum(${catalogVariants.stock})::int`,
      tracked: sql<boolean>`bool_or(${catalogVariants.stock} is not null)`,
    })
    .from(catalogItems)
    .leftJoin(catalogVariants, eq(catalogVariants.itemId, catalogItems.id))
    .where(and(...where))
    .groupBy(catalogItems.id)
    .orderBy(desc(catalogItems.updatedAt))
    .limit(500);
  return rows.map((r) => ({ ...r, image: coverOf(r.images) }));
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

export type VariantInput = { title: string; optionValues: string[]; sku: string | null; pricePaise: number; compareAtPaise: number | null; stock: number | null; imageUrl?: string | null; sourceId?: string | null };
export type ItemInput = {
  title: string; handle?: string; descriptionHtml: string; status: ItemStatus; vendor?: string | null; productType?: string | null;
  tags: string[]; images: ItemImage[]; options: ItemOption[]; variants: VariantInput[]; categoryIds: number[];
  seoTitle?: string | null; seoDescription?: string | null; kind?: Store["businessType"];
};

/** Create (no id) or update an item; its variants and categories are replaced by the ones given. */
export async function saveItem(store: Store, input: ItemInput, id?: number) {
  if (!input.title.trim()) throw new Error("Give it a name.");
  if (input.variants.length === 0) throw new Error("Add a price.");
  if (input.variants.some((v) => v.pricePaise < 0)) throw new Error("Price can't be negative.");
  const handle = await freeHandle(store.id, input.handle?.trim() || input.title, id);
  return db.transaction(async (tx) => {
    const values = {
      title: input.title.trim(), handle, descriptionHtml: input.descriptionHtml, status: input.status,
      vendor: input.vendor ?? null, productType: input.productType ?? null, tags: input.tags, images: input.images, options: input.options,
      seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null, updatedAt: new Date(),
    };
    let itemId = id;
    if (itemId) {
      const r = await tx.update(catalogItems).set(values).where(and(eq(catalogItems.id, itemId), eq(catalogItems.storeId, store.id))).returning({ id: catalogItems.id });
      if (!r.length) throw new Error("This item no longer exists.");
      await tx.delete(catalogVariants).where(eq(catalogVariants.itemId, itemId));
      await tx.delete(catalogCategoryItems).where(eq(catalogCategoryItems.itemId, itemId));
    } else {
      const [r] = await tx.insert(catalogItems).values({ ...values, storeId: store.id, kind: input.kind ?? store.businessType }).returning({ id: catalogItems.id });
      itemId = r.id;
    }
    await tx.insert(catalogVariants).values(input.variants.map((v, i) => ({
      itemId: itemId!, storeId: store.id, title: v.title || "Default", optionValues: v.optionValues, sku: v.sku || null,
      pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise, stock: v.stock, imageUrl: v.imageUrl ?? null, position: i, sourceId: v.sourceId ?? null,
    })));
    if (input.categoryIds.length) {
      const own = await tx.select({ id: catalogCategories.id }).from(catalogCategories).where(and(eq(catalogCategories.storeId, store.id), inArray(catalogCategories.id, input.categoryIds)));
      if (own.length) await tx.insert(catalogCategoryItems).values(own.map((c) => ({ categoryId: c.id, itemId: itemId! }))).onConflictDoNothing();
    }
    return itemId!;
  });
}

export async function setItemsStatus(storeId: number, ids: number[], status: ItemStatus) {
  if (!ids.length) return;
  await db.update(catalogItems).set({ status, updatedAt: new Date() }).where(and(eq(catalogItems.storeId, storeId), inArray(catalogItems.id, ids)));
}

export async function deleteItem(storeId: number, id: number) {
  await db.delete(catalogItems).where(and(eq(catalogItems.storeId, storeId), eq(catalogItems.id, id)));
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
      const images = p.media.nodes.flatMap((m): ItemImage[] => {
        if (m.image) return [{ url: m.image.url, alt: m.image.altText ?? undefined, type: "image" }];
        const mp4 = m.sources?.find((s) => s.mimeType === "video/mp4") ?? m.sources?.[0];
        return mp4 ? [{ url: mp4.url, type: "video", poster: m.preview?.image?.url }] : [];
      });
      const options = p.options.filter((o) => !(o.name === "Title" && o.optionValues.length === 1 && o.optionValues[0].name === "Default Title"))
        .map((o) => ({ name: o.name, values: o.optionValues.map((v) => v.name) }));
      const vs: VariantInput[] = p.variants.nodes.map((v) => ({
        title: v.title === "Default Title" ? "Default" : v.title,
        optionValues: options.length ? v.selectedOptions.map((s) => s.value) : [],
        sku: v.sku || null,
        pricePaise: rupeesToPaise(v.price) ?? 0,
        compareAtPaise: rupeesToPaise(v.compareAtPrice),
        stock: v.inventoryItem?.tracked ? v.inventoryQuantity ?? 0 : null,
        imageUrl: v.image?.url ?? null,
        sourceId: v.id,
      }));
      const [existing] = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.sourceId, p.id))).limit(1);
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
    const qty = r.v.stock == null ? it.quantity : Math.min(it.quantity, Math.max(0, r.v.stock));
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
  return { id: `${GP_PREFIX}${order.id}`, name: `#GP${order.id.slice(0, 6).toUpperCase()}` };
}

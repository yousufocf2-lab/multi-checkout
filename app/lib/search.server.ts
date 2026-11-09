// Website search that forgives: spelling slips (smartwach), missing spaces or dashes (hw512 → HW-512),
// partial words (ear → earbuds) and words from the category, type or tags. When nothing matches well, it still
// shows the closest products and the bestsellers, never an empty "no results".
import { and, eq, inArray } from "drizzle-orm";
import { catalogCategories, catalogCategoryItems, catalogItems, catalogVariants, db } from "~/db.server";
import { coverOf } from "./catalog.server";
import { imgUrl } from "./storefront.server";
import { categoryPath, productPath } from "./storefront-paths";
import { compact, rank, tokens, type Doc } from "./search-rank";

const cache = new Map<number, { at: number; docs: Doc[]; cats: { title: string; handle: string; t: string[] }[] }>();
const TTL = 60_000;

async function index(storeId: number) {
  const hit = cache.get(storeId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const [items, links, cats] = await Promise.all([
    db.select({ id: catalogItems.id, title: catalogItems.title, handle: catalogItems.handle, tags: catalogItems.tags, type: catalogItems.productType, vendor: catalogItems.vendor, images: catalogItems.images })
      .from(catalogItems).where(and(eq(catalogItems.storeId, storeId), eq(catalogItems.status, "active"))).limit(3000),
    db.select({ itemId: catalogCategoryItems.itemId, title: catalogCategories.title }).from(catalogCategoryItems)
      .innerJoin(catalogCategories, eq(catalogCategories.id, catalogCategoryItems.categoryId)).where(eq(catalogCategories.storeId, storeId)),
    db.select({ title: catalogCategories.title, handle: catalogCategories.handle }).from(catalogCategories).where(eq(catalogCategories.storeId, storeId)),
  ]);
  const prices = items.length ? await db.select({ itemId: catalogVariants.itemId, p: catalogVariants.pricePaise, c: catalogVariants.compareAtPaise }).from(catalogVariants).where(inArray(catalogVariants.itemId, items.map((i) => i.id))) : [];
  const priceOf = new Map<number, { p: number; c: number }>();
  for (const v of prices) { const cur = priceOf.get(v.itemId); if (!cur || v.p < cur.p) priceOf.set(v.itemId, { p: v.p, c: v.c ?? 0 }); }
  const catOf = new Map<number, string[]>();
  for (const l of links) (catOf.get(l.itemId) ?? catOf.set(l.itemId, []).get(l.itemId)!).push(l.title);
  const docs: Doc[] = items.map((i) => {
    const cover = coverOf(i.images);
    return {
      id: i.id, title: i.title, handle: i.handle, title_t: tokens(i.title),
      other_t: tokens([i.type ?? "", i.vendor ?? "", ...(i.tags ?? []), ...(catOf.get(i.id) ?? []), i.handle.replace(/-/g, " ")].join(" ")),
      compact: compact(i.title), image: cover ? imgUrl(cover, 200) : null, price: priceOf.get(i.id)?.p ?? 0, compare: priceOf.get(i.id)?.c ?? 0,
    };
  });
  const row = { at: Date.now(), docs, cats: cats.map((c) => ({ ...c, t: tokens(c.title) })) };
  cache.set(storeId, row);
  return row;
}

/** Ranked product ids for a query, plus whether these are only "closest" matches. */
export async function searchProducts(storeId: number, q: string, limit = 48) {
  const { docs, cats } = await index(storeId);
  return rank(docs, cats, q, limit);
}

/** Small JSON for the header's live search box. */
export async function suggest(storeId: number, root: string, q: string) {
  const r = await searchProducts(storeId, q, 6);
  const { docs } = await index(storeId);
  const byId = new Map(docs.map((d) => [d.id, d]));
  return {
    exact: r.exact,
    products: r.ids.flatMap((id) => { const d = byId.get(id); return d ? [{ title: d.title, url: productPath(root, d.handle), image: d.image, price: d.price, compare: d.compare }] : []; }),
    categories: r.categories.map((c) => ({ title: c.title, url: categoryPath(root, c.handle) })),
    all: `${root}/search?q=${encodeURIComponent(q)}`,
  };
}

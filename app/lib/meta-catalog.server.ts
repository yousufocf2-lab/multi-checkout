// Facebook & Instagram catalog for Growpefy Store products.
// Growpefy keeps what it last sent per variant (meta_catalog_items) and sends Meta only what changed:
// new or edited products, price / stock / photo changes, and removals. Product edits nudge a sync within
// seconds; a light check every few minutes catches anything else (orders lowering stock, imports).
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { catalogItems, catalogVariants, db, metaCatalogItems, stores, type Store } from "~/db.server";
import { env } from "./env.server";
import { productPath } from "./storefront-paths";

const GRAPH = (s: Store) => `https://graph.facebook.com/${s.metaApiVersion || "v23.0"}`;
const BATCH = 500;
const WATCH_MS = 5 * 60_000;

export class CatalogError extends Error {}

type MetaItem = Record<string, unknown> & { id: string };

const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const money = (paise: number) => `${(paise / 100).toFixed(2)} INR`;

/** Public address of the store's website (own domain when it's live). */
export function siteBase(store: Pick<Store, "slug" | "storefrontDomain" | "storefrontDomainStatus">) {
  return store.storefrontDomain && store.storefrontDomainStatus === "live" ? `https://${store.storefrontDomain}` : `${env.appUrl.replace(/\/+$/, "")}/s/${store.slug}`;
}
const absolute = (url: string) => (url.startsWith("//") ? `https:${url}` : url.startsWith("/") ? `${env.appUrl.replace(/\/+$/, "")}${url}` : url);

/** Every variant of every active product, in Meta's catalog format (retailer id = the checkout's variant id, gp:<id>). */
export async function catalogFeedItems(store: Store): Promise<MetaItem[]> {
  const items = await db.select().from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.status, "active"))).orderBy(asc(catalogItems.id));
  if (!items.length) return [];
  const variants = await db.select().from(catalogVariants).where(inArray(catalogVariants.itemId, items.map((i) => i.id))).orderBy(asc(catalogVariants.position));
  const base = siteBase(store);
  const out: MetaItem[] = [];
  for (const item of items) {
    const photos = item.images.filter((i) => (i.type ?? "image") === "image").map((i) => absolute(i.url));
    const cover = photos[0];
    if (!cover) continue; // Meta needs a photo
    const desc = strip(item.descriptionHtml ?? "").slice(0, 4900) || item.title;
    const own = variants.filter((v) => v.itemId === item.id);
    const continueSelling = Boolean((item.extra as { continueSelling?: boolean } | null)?.continueSelling);
    for (const v of own) {
      const sale = v.compareAtPaise != null && v.compareAtPaise > v.pricePaise;
      const inStock = v.stock == null || v.stock > 0 || continueSelling;
      const opts: Record<string, string> = {};
      item.options.forEach((o, i) => {
        const val = v.optionValues[i]; if (!val || val === "Default") return;
        const n = o.name.toLowerCase();
        if (/colou?r/.test(n)) opts.color = val; else if (/size/.test(n)) opts.size = val; else if (/material/.test(n)) opts.material = val; else if (/pattern|style/.test(n)) opts.pattern = val;
      });
      out.push({
        id: `gp:${v.id}`,
        item_group_id: `gp-item-${item.id}`,
        title: (own.length > 1 && v.title !== "Default" ? `${item.title} - ${v.title}` : item.title).slice(0, 200),
        description: desc,
        availability: inStock ? "in stock" : "out of stock",
        ...(v.stock != null ? { inventory: Math.max(0, v.stock) } : {}),
        condition: "new",
        price: money(sale ? v.compareAtPaise! : v.pricePaise),
        ...(sale ? { sale_price: money(v.pricePaise) } : {}),
        link: `${base}${productPath("", item.handle)}`,
        image_link: v.imageUrl ? absolute(v.imageUrl) : cover,
        ...(photos.length > 1 ? { additional_image_link: photos.slice(1, 10) } : {}),
        brand: (item.vendor || store.name).slice(0, 100),
        ...(item.productType ? { product_type: item.productType.slice(0, 750) } : {}),
        ...(v.sku ? { mpn: v.sku } : {}),
        ...opts,
      });
    }
  }
  return out;
}

const hashOf = (i: MetaItem) => createHash("sha1").update(JSON.stringify(i)).digest("hex");

async function graphPost(store: Store, path: string, body: Record<string, unknown>) {
  if (!store.metaAccessToken) throw new CatalogError("Add your Meta access token first (Settings → Meta ads).");
  const form = new URLSearchParams({ access_token: store.metaAccessToken });
  for (const [k, v] of Object.entries(body)) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  let res: Response;
  try { res = await fetch(`${GRAPH(store)}/${path}`, { method: "POST", body: form }); }
  catch { throw new CatalogError("Couldn't reach Meta. Try again in a minute."); }
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || json.error) throw new CatalogError(friendly(json.error?.message ?? `Meta error ${res.status}`));
  return json;
}

async function graphGet(store: Store, path: string, params: Record<string, string> = {}) {
  if (!store.metaAccessToken) throw new CatalogError("Add your Meta access token first (Settings → Meta ads).");
  const qs = new URLSearchParams({ ...params, access_token: store.metaAccessToken });
  let res: Response;
  try { res = await fetch(`${GRAPH(store)}/${path}?${qs}`); }
  catch { throw new CatalogError("Couldn't reach Meta. Try again in a minute."); }
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || json.error) throw new CatalogError(friendly(json.error?.message ?? `Meta error ${res.status}`));
  return json;
}

function friendly(msg: string) {
  const m = msg.replace(/access_token=[^&\s]+/g, "access_token=…");
  if (/catalog_management|permission|not authorized|\(#200\)|\(#10\)/i.test(m)) return `Your Meta token doesn't have permission for catalogs. Give the system user "catalog_management" and access to this business, then try again. (${m.slice(0, 140)})`;
  if (/session has expired|Error validating access token|OAuthException/i.test(m)) return "Your Meta access token has expired or is wrong. Paste a new one in Settings → Meta ads.";
  return m.slice(0, 300);
}

/**
 * One-click setup: finds the business behind the ad account, creates a catalog (unless one is given),
 * connects the pixel to it and sends every product.
 */
export async function connectCatalog(store: Store, opts: { catalogId?: string } = {}) {
  let catalogId = (opts.catalogId ?? "").replace(/\D/g, "");
  if (!catalogId) {
    const act = (store.metaAdAccountId ?? "").replace(/\D/g, "");
    if (!act) throw new CatalogError("Add your Meta ad account ID first (Settings → Meta ads), or paste an existing catalog ID.");
    const acc = await graphGet(store, `act_${act}`, { fields: "business{id,name}" });
    const business = acc.business?.id as string | undefined;
    if (!business) throw new CatalogError("This ad account isn't in a Meta Business portfolio, so a catalog can't be created for it. Create a catalog in Commerce Manager and paste its ID instead.");
    const made = await graphPost(store, `${business}/owned_product_catalogs`, { name: `${store.name} (Growpefy)`.slice(0, 100), vertical: "commerce" });
    catalogId = String(made.id);
  } else {
    await graphGet(store, catalogId, { fields: "id,name" }); // can we reach it?
  }
  let pixelNote: string | null = null;
  if (store.metaPixelId) {
    try { await graphPost(store, `${catalogId}/external_event_sources`, { external_event_sources: [store.metaPixelId] }); }
    catch (e) { pixelNote = `The catalog was created, but the pixel couldn't be linked automatically: ${(e as Error).message}`; }
  }
  await db.update(stores).set({ metaCatalogId: catalogId, metaCatalogOn: true, metaCatalogError: pixelNote }).where(eq(stores.id, store.id));
  await db.delete(metaCatalogItems).where(eq(metaCatalogItems.storeId, store.id)); // a new catalog gets everything
  const fresh = (await db.select().from(stores).where(eq(stores.id, store.id)).limit(1))[0];
  const r = await syncCatalog(fresh);
  return { catalogId, ...r, pixelNote };
}

export async function disconnectCatalog(storeId: number) {
  await db.update(stores).set({ metaCatalogOn: false }).where(eq(stores.id, storeId));
}

/** Sends Meta only what changed since the last sync. Returns how many were added/updated and removed. */
export async function syncCatalog(store: Store, opts: { full?: boolean } = {}) {
  if (!store.metaCatalogOn || !store.metaCatalogId) return { sent: 0, removed: 0, total: 0 };
  try {
    const want = await catalogFeedItems(store);
    const wantMap = new Map(want.map((i) => [i.id, { item: i, hash: hashOf(i) }]));
    const had = await db.select().from(metaCatalogItems).where(eq(metaCatalogItems.storeId, store.id));
    const hadMap = new Map(had.map((r) => [r.retailerId, r.hash]));
    const upserts = [...wantMap.values()].filter((w) => opts.full || hadMap.get(w.item.id) !== w.hash);
    const removes = had.filter((r) => !wantMap.has(r.retailerId)).map((r) => r.retailerId);

    for (let i = 0; i < upserts.length; i += BATCH) {
      const chunk = upserts.slice(i, i + BATCH);
      await graphPost(store, `${store.metaCatalogId}/items_batch`, {
        item_type: "PRODUCT_ITEM", allow_upsert: "true",
        requests: chunk.map((c) => ({ method: "UPDATE", data: c.item })),
      });
      const now = new Date();
      await db.insert(metaCatalogItems).values(chunk.map((c) => ({ storeId: store.id, retailerId: c.item.id, hash: c.hash, sentAt: now })))
        .onConflictDoUpdate({ target: [metaCatalogItems.storeId, metaCatalogItems.retailerId], set: { hash: sqlExcluded("hash"), sentAt: now } });
    }
    for (let i = 0; i < removes.length; i += BATCH) {
      const chunk = removes.slice(i, i + BATCH);
      await graphPost(store, `${store.metaCatalogId}/items_batch`, { item_type: "PRODUCT_ITEM", requests: chunk.map((id) => ({ method: "DELETE", data: { id } })) });
      await db.delete(metaCatalogItems).where(and(eq(metaCatalogItems.storeId, store.id), inArray(metaCatalogItems.retailerId, chunk)));
    }
    if (upserts.length || removes.length) console.log(`[meta-catalog] ${store.name}: ${upserts.length} sent, ${removes.length} removed`);
    await db.update(stores).set({ metaCatalogSyncedAt: new Date(), metaCatalogCount: want.length, ...(upserts.length || removes.length ? { metaCatalogError: null } : {}) }).where(eq(stores.id, store.id));
    return { sent: upserts.length, removed: removes.length, total: want.length };
  } catch (e) {
    const msg = e instanceof CatalogError ? e.message : "Couldn't update the catalog. We'll try again shortly.";
    if (!(e instanceof CatalogError)) console.error("[meta-catalog]", store.id, e);
    await db.update(stores).set({ metaCatalogError: msg }).where(eq(stores.id, store.id));
    throw e instanceof CatalogError ? e : new CatalogError(msg);
  }
}

const sqlExcluded = (col: string) => sql.raw(`excluded.${col}`);

// ---------- quick sync after edits ----------

declare global { var __metaCatalogTimers: Map<number, NodeJS.Timeout> | undefined; var __metaCatalogWatch: NodeJS.Timeout | undefined; }

/** A product changed: send it to Meta in a few seconds (several quick edits go out together). */
export function nudgeCatalog(storeId: number) {
  const timers = (globalThis.__metaCatalogTimers ??= new Map());
  clearTimeout(timers.get(storeId));
  const t = setTimeout(async () => {
    timers.delete(storeId);
    const [s] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (s?.metaCatalogOn && s.metaCatalogId) await syncCatalog(s).catch(() => {});
  }, 8000);
  t.unref?.();
  timers.set(storeId, t);
}

/** Light check every few minutes: catches stock dropping after orders, imports and anything else. */
export function startCatalogWatcher() {
  if (globalThis.__metaCatalogWatch || !process.env.DATABASE_URL) return;
  globalThis.__metaCatalogWatch = setInterval(async () => {
    const list = await db.select().from(stores).where(and(eq(stores.metaCatalogOn, true), eq(stores.active, true))).catch(() => []);
    for (const s of list) if (s.metaCatalogId && !(s.metaCatalogError ?? "").includes("token")) await syncCatalog(s).catch(() => {});
  }, WATCH_MS);
  globalThis.__metaCatalogWatch.unref?.();
}

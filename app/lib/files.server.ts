// Files library: lists, searches, renames and deletes a store's uploads (photos, videos, documents).
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { catalogCategories, catalogItems, catalogVariants, db, storeFiles, storePages, storeThemes, stores, type Store } from "~/db.server";
import { env } from "./env.server";
import { deleteMedia, listStoreMedia, mediaReady, mimeKind } from "./media.server";

export type FileKind = "image" | "video" | "document";
export type FileSort = "newest" | "oldest" | "name" | "size";
const PAGE = 50;

const cleanName = (n: string) => n.replace(/[\u0000-\u001f<>"\\/]/g, "").trim().slice(0, 160);

/** Adds an upload to the library (called by the upload endpoint, for every upload in the dashboard). */
export async function recordFile(input: { storeId: number; key: string; url: string; name?: string; mime: string; bytes: number; width?: number; height?: number; by?: string }) {
  const ext = input.key.split(".").pop() ?? "";
  const name = cleanName(input.name ?? "") || `file-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const dim = (n?: number) => (n && Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n) : null);
  const [row] = await db.insert(storeFiles).values({
    storeId: input.storeId, key: input.key, url: input.url, name, kind: mimeKind(input.mime), mime: input.mime,
    bytes: input.bytes, width: dim(input.width), height: dim(input.height), createdBy: input.by ?? null,
  }).onConflictDoNothing().returning();
  return row ?? null;
}

/** Once per store: uploads made before the library existed are added from the bucket. */
async function syncFromBucket(store: Pick<Store, "id" | "filesSyncedAt">) {
  if (store.filesSyncedAt || !mediaReady()) return;
  try {
    const objects = await listStoreMedia(store.id);
    for (let i = 0; i < objects.length; i += 200) {
      const chunk = objects.slice(i, i + 200);
      if (!chunk.length) break;
      await db.insert(storeFiles).values(chunk.map((o) => ({
        storeId: store.id, key: o.key, url: `${env.appUrl}/media/${o.key}`, kind: mimeKind(o.mime), mime: o.mime, bytes: o.bytes,
        name: o.key.split("/").pop() ?? o.key, createdAt: o.at,
      }))).onConflictDoNothing();
    }
    await db.update(stores).set({ filesSyncedAt: new Date() }).where(eq(stores.id, store.id));
  } catch (e) {
    console.error("[files] sync", store.id, e instanceof Error ? e.message : e);
  }
}

export async function listFiles(store: Pick<Store, "id" | "filesSyncedAt">, params: URLSearchParams) {
  await syncFromBucket(store);
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const kind = (["image", "video", "document"] as const).find((k) => k === params.get("type")) ?? null;
  const sort = (["newest", "oldest", "name", "size"] as const).find((k) => k === params.get("sort")) ?? "newest";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const where: SQL[] = [eq(storeFiles.storeId, store.id)];
  if (kind) where.push(eq(storeFiles.kind, kind));
  if (q) where.push(sql`(${ilike(storeFiles.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`)} or ${ilike(storeFiles.alt, `%${q.replace(/[%_\\]/g, "\\$&")}%`)})`);
  const order = sort === "oldest" ? asc(storeFiles.createdAt) : sort === "name" ? asc(sql`lower(${storeFiles.name})`) : sort === "size" ? desc(storeFiles.bytes) : desc(storeFiles.createdAt);
  const [rows, [totals], counts] = await Promise.all([
    db.select().from(storeFiles).where(and(...where)).orderBy(order, desc(storeFiles.id)).limit(PAGE + 1).offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(storeFiles).where(and(...where)),
    db.select({ kind: storeFiles.kind, n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${storeFiles.bytes}), 0)::bigint` }).from(storeFiles).where(eq(storeFiles.storeId, store.id)).groupBy(storeFiles.kind),
  ]);
  const by = Object.fromEntries(counts.map((c) => [c.kind, Number(c.n)])) as Partial<Record<FileKind, number>>;
  return {
    q, kind, sort, page, hasMore: rows.length > PAGE, total: Number(totals?.n ?? 0),
    counts: { all: counts.reduce((a, c) => a + Number(c.n), 0), image: by.image ?? 0, video: by.video ?? 0, document: by.document ?? 0 },
    storageBytes: counts.reduce((a, c) => a + Number(c.bytes), 0),
    files: rows.slice(0, PAGE).map((f) => ({
      id: f.id, url: f.url, name: f.name, kind: f.kind as FileKind, mime: f.mime, bytes: f.bytes,
      width: f.width, height: f.height, alt: f.alt, createdAt: f.createdAt.toISOString(), by: f.createdBy,
    })),
  };
}
export type FilesData = Awaited<ReturnType<typeof listFiles>>;

/** Where a file is used on the store (products, categories, pages, theme, logo). */
export async function fileUsage(storeId: number, url: string) {
  const key = url.slice(url.indexOf("/media/") + 7);
  if (!key || key === url) return [];
  const like = `%${key.replace(/[%_\\]/g, "\\$&")}%`;
  const [items, variants, cats, pages, theme, store] = await Promise.all([
    db.select({ title: catalogItems.title }).from(catalogItems).where(and(eq(catalogItems.storeId, storeId), sql`(${catalogItems.images}::text ilike ${like} or ${catalogItems.descriptionHtml} ilike ${like})`)).limit(5),
    db.select({ title: catalogItems.title }).from(catalogVariants).innerJoin(catalogItems, eq(catalogItems.id, catalogVariants.itemId)).where(and(eq(catalogItems.storeId, storeId), ilike(catalogVariants.imageUrl, like))).limit(5),
    db.select({ title: catalogCategories.title }).from(catalogCategories).where(and(eq(catalogCategories.storeId, storeId), ilike(catalogCategories.imageUrl, like))).limit(5),
    db.select({ title: storePages.title }).from(storePages).where(and(eq(storePages.storeId, storeId), ilike(storePages.bodyHtml, like))).limit(5),
    db.select({ id: storeThemes.id }).from(storeThemes).where(and(eq(storeThemes.storeId, storeId), sql`(${storeThemes.live}::text ilike ${like} or ${storeThemes.draft}::text ilike ${like})`)).limit(1),
    db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, storeId), ilike(stores.logoUrl, like))).limit(1),
  ]);
  const used: { kind: string; title: string }[] = [];
  for (const t of new Set([...items, ...variants].map((r) => r.title))) used.push({ kind: "Product", title: t });
  for (const r of cats) used.push({ kind: "Category", title: r.title });
  for (const r of pages) used.push({ kind: "Page", title: r.title });
  if (theme.length) used.push({ kind: "Website design", title: "Theme" });
  if (store.length) used.push({ kind: "Store", title: "Logo" });
  return used;
}

export async function updateFile(storeId: number, id: number, patch: { name?: string; alt?: string }) {
  const set: Partial<{ name: string; alt: string }> = {};
  if (patch.name != null) { const n = cleanName(patch.name); if (!n) throw new Error("Give the file a name."); set.name = n; }
  if (patch.alt != null) set.alt = patch.alt.replace(/[<>]/g, "").trim().slice(0, 300);
  if (!Object.keys(set).length) return;
  await db.update(storeFiles).set(set).where(and(eq(storeFiles.storeId, storeId), eq(storeFiles.id, id)));
}

export async function deleteFiles(storeId: number, ids: number[]) {
  if (!ids.length) return 0;
  const rows = await db.select({ id: storeFiles.id, key: storeFiles.key }).from(storeFiles).where(and(eq(storeFiles.storeId, storeId), inArray(storeFiles.id, ids.slice(0, 200))));
  let n = 0;
  for (const r of rows) {
    try { await deleteMedia(r.key); } catch (e) { console.error("[files] delete", r.key, e instanceof Error ? e.message : e); continue; }
    await db.delete(storeFiles).where(eq(storeFiles.id, r.id));
    n++;
  }
  return n;
}

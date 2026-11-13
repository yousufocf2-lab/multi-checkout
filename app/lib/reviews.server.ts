import { and, desc, eq, sql } from "drizzle-orm";
import { db, catalogItems, productReviews, stores } from "~/db.server";
import { env } from "./env.server";
import { needsApproval, widgetSettings, type ReviewSettings } from "./widgets";

export type ReviewMedia = { url: string; type: "image" | "video" };

export async function storeReviewSettings(storeId: number): Promise<ReviewSettings> {
  const [s] = await db.select({ w: stores.widgetSettings }).from(stores).where(eq(stores.id, storeId)).limit(1);
  return widgetSettings(s?.w).reviews;
}

/** Approved reviews of one product (the store's chosen order), with the average, the count and stars 5→1. */
export async function reviewsForProduct(storeId: number, productId: number, sort: ReviewSettings["sort"] = "newest") {
  const where = and(eq(productReviews.storeId, storeId), eq(productReviews.productId, productId), eq(productReviews.status, "approved"));
  const order = sort === "highest" ? [desc(productReviews.rating), desc(productReviews.createdAt)]
    : sort === "media" ? [desc(sql`jsonb_array_length(${productReviews.media})`), desc(productReviews.createdAt)]
    : [desc(productReviews.createdAt)];
  const [rows, dist] = await Promise.all([
    db.select().from(productReviews).where(where).orderBy(...order).limit(60),
    db.select({ rating: productReviews.rating, n: sql<number>`count(*)::int` }).from(productReviews).where(where).groupBy(productReviews.rating),
  ]);
  const count = dist.reduce((s, d) => s + Number(d.n), 0);
  const sum = dist.reduce((s, d) => s + d.rating * Number(d.n), 0);
  const breakdown = [5, 4, 3, 2, 1].map((r) => { const n = Number(dist.find((d) => d.rating === r)?.n ?? 0); return { stars: r, count: n, pct: count ? Math.round((n / count) * 100) : 0 }; });
  return { rows, count, average: count ? Math.round((sum / count) * 10) / 10 : 0, breakdown };
}

/** Only files this store uploaded through Growpefy (no outside links). */
export function cleanMedia(storeId: number, raw: unknown, max: number, allow: { photos: boolean; videos: boolean }): ReviewMedia[] {
  let list: unknown = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw || "[]"); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  const prefix = `${env.appUrl}/media/stores/${storeId}/`;
  return list.flatMap((m): ReviewMedia[] => {
    const url = typeof m?.url === "string" ? m.url : "";
    if (!url.startsWith(prefix)) return [];
    const type = m?.type === "video" ? "video" : "image";
    if (type === "video" ? !allow.videos : !allow.photos) return [];
    return [{ url, type }];
  }).slice(0, max);
}

/** A shopper's review from the product page. Returns whether it is live now or waiting for approval. */
export async function submitReview(storeId: number, handle: string, form: FormData): Promise<"approved" | "pending" | "ignored"> {
  // Honeypot field helps filter basic automated submissions.
  if (String(form.get("website") ?? "").trim()) return "ignored";
  const settings = await storeReviewSettings(storeId);
  if (!settings.enabled) throw new Response("Reviews are switched off for this store.", { status: 403 });
  const [product] = await db.select({ id: catalogItems.id }).from(catalogItems)
    .where(and(eq(catalogItems.storeId, storeId), eq(catalogItems.handle, handle), eq(catalogItems.status, "active"))).limit(1);
  if (!product) throw new Response("Product not found", { status: 404 });
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const email = String(form.get("email") ?? "").trim().slice(0, 254);
  const body = String(form.get("body") ?? "").trim().slice(0, 2000);
  const rating = Number(form.get("rating"));
  if (!name || name.length > 80 || body.length < 10 || !Number.isInteger(rating) || rating < 1 || rating > 5 || (email && !/^\S+@\S+\.\S+$/.test(email))) {
    throw new Response("Please enter your name, a valid rating, and a review of at least 10 characters.", { status: 400 });
  }
  const media = cleanMedia(storeId, form.get("media"), settings.maxMedia, { photos: settings.allowPhotos, videos: settings.allowVideos });
  const status = needsApproval(settings, rating, media.length > 0) ? "pending" : "approved";
  await db.insert(productReviews).values({ storeId, productId: product.id, authorName: name, email: email || null, rating, body, media, status });
  return status;
}

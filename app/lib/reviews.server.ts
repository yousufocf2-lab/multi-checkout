import { and, desc, eq, sql } from "drizzle-orm";
import { db, catalogItems, productReviews } from "~/db.server";

export async function reviewsForProduct(storeId: number, productId: number) {
  const rows = await db.select().from(productReviews)
    .where(and(eq(productReviews.storeId, storeId), eq(productReviews.productId, productId), eq(productReviews.status, "approved")))
    .orderBy(desc(productReviews.createdAt)).limit(50);
  const [summary] = await db.select({ count: sql<number>`count(*)::int`, average: sql<number>`coalesce(avg(${productReviews.rating}), 0)::float` })
    .from(productReviews).where(and(eq(productReviews.storeId, storeId), eq(productReviews.productId, productId), eq(productReviews.status, "approved")));
  return { rows, count: summary?.count ?? 0, average: Math.round((summary?.average ?? 0) * 10) / 10 };
}

export async function submitReview(storeId: number, handle: string, form: FormData) {
  // Honeypot field helps filter basic automated submissions.
  if (String(form.get("website") ?? "").trim()) return;
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
  await db.insert(productReviews).values({ storeId, productId: product.id, authorName: name, email: email || null, rating, body });
}

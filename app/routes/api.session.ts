import type { ActionFunctionArgs } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { checkoutSessions, db, stores } from "~/db.server";
import { env } from "~/lib/env.server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const loader = () => reply({ error: "POST only" }, 405);

/** Storefront -> creates a checkout session and returns its URL. */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  let body: { store?: string; items?: { variantId?: unknown; quantity?: unknown }[] };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return reply({ error: "bad json" }, 400);
  }

  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.slug, String(body.store ?? "")), eq(stores.active, true)))
    .limit(1);
  if (!store) return reply({ error: "store not found" }, 404);

  // Merge duplicates, validate shape
  const merged = new Map<string, number>();
  for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 100)) {
    const id = String(it.variantId ?? "").replace(/\D/g, "");
    const q = Math.floor(Number(it.quantity));
    if (!id || !Number.isFinite(q) || q < 1) continue;
    merged.set(id, Math.min(9999, (merged.get(id) ?? 0) + q));
  }
  if (!merged.size) return reply({ error: "cart is empty" }, 400);

  const id = crypto.randomBytes(12).toString("base64url");
  await db.insert(checkoutSessions).values({
    id,
    storeId: store.id,
    items: [...merged].map(([variantId, quantity]) => ({ variantId, quantity })),
  });
  return reply({ url: `${env.appUrl}/c/${id}` });
}

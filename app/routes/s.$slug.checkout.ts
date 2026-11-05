// Growpefy Store storefront: cart -> the Growpefy checkout. Items go in as "gp:<variant id>" so the checkout
// prices them from the store's own catalog and keeps the order in Growpefy (nothing is created on Shopify).
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "node:crypto";
import { checkoutSessions, db } from "~/db.server";
import { catalogLines, GP_PREFIX } from "~/lib/catalog.server";
import { clientIp } from "~/lib/orders.server";
import { previewContext } from "~/lib/storefront.server";
import { storeBaseUrl } from "~/lib/urls.server";

export const loader = () => json({ error: "POST only" }, { status: 405 });

export async function action({ request, params }: ActionFunctionArgs) {
  const ctx = await previewContext(request, params.slug);
  let body: { lines?: { variantId?: unknown; qty?: unknown }[] } = {};
  try { body = await request.json(); } catch { return json({ error: "Your cart couldn't be read. Please try again." }, { status: 400 }); }

  const merged = new Map<string, number>();
  for (const l of (Array.isArray(body.lines) ? body.lines : []).slice(0, 50)) {
    const id = Math.floor(Number(l.variantId));
    const q = Math.floor(Number(l.qty));
    if (!(id > 0) || !(q > 0)) continue;
    const key = `${GP_PREFIX}${id}`;
    merged.set(key, Math.min(20, (merged.get(key) ?? 0) + q));
  }
  const items = [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
  if (!items.length) return json({ error: "Your cart is empty." }, { status: 400 });

  // Only what is still on sale (and in stock) goes to checkout
  const lines = await catalogLines(ctx.store, items);
  if (!lines.length) return json({ error: "These items are sold out or no longer available." }, { status: 409 });

  const id = crypto.randomBytes(12).toString("base64url");
  await db.insert(checkoutSessions).values({
    id, storeId: ctx.store.id,
    items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    tracking: { ip: clientIp(request), ua: request.headers.get("user-agent")?.slice(0, 500) ?? undefined, sourceUrl: request.headers.get("referer")?.slice(0, 500) ?? undefined },
  });
  const sum = (xs: { quantity: number }[]) => xs.reduce((n, x) => n + x.quantity, 0);
  const dropped = sum(lines) < sum(items);
  return json({ url: `${storeBaseUrl(ctx.store)}/c/${id}`, note: dropped ? "Some items were sold out and were left out." : null });
}

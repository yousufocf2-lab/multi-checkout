import type { ActionFunctionArgs } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { checkoutSessions, db, stores } from "~/db.server";
import { storeBaseUrl } from "~/lib/urls.server";
import { clientIp } from "~/lib/orders.server";
import { wooVerify } from "~/lib/woo.server";
import { startWelcomeWatcher } from "~/lib/welcome.server";
import { PROXY_PATH, proxyCheckoutReady } from "~/lib/proxy-checkout.server";

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
  startWelcomeWatcher(); // keeps lead welcomes going even when nobody has the dashboard open

  let body: { store?: string; items?: { variantId?: unknown; quantity?: unknown }[]; fbp?: unknown; fbc?: unknown; url?: unknown; gclid?: unknown; gbraid?: unknown; wbraid?: unknown; ip?: unknown; ua?: unknown };
  const raw = await request.text();
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "bad json" }, 400);
  }

  const [store] = await db
    .select({
      id: stores.id, slug: stores.slug, checkoutDomain: stores.checkoutDomain, platform: stores.platform, wooSecret: stores.wooSecret,
      shopDomain: stores.shopDomain, proxyCheckout: stores.proxyCheckout, clientSecret: stores.clientSecret,
    })
    .from(stores)
    .where(and(eq(stores.slug, String(body.store ?? "")), eq(stores.active, true)))
    .limit(1);
  if (!store) return reply({ error: "store not found" }, 404);
  // WooCommerce: the plugin calls us from the server and signs the request, so we can trust the shopper's IP / browser it sends
  const signed = store.platform === "woocommerce" && wooVerify(store.wooSecret, request.headers.get("x-growpefy-time"), request.headers.get("x-growpefy-signature"), raw);
  const ip = signed && typeof body.ip === "string" && /^[\d.:a-fA-F]{3,45}$/.test(body.ip) ? body.ip : clientIp(request);
  const ua = signed ? clip(body.ua, 500) : request.headers.get("user-agent")?.slice(0, 500) ?? undefined;

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
    tracking: {
      fbp: clip(body.fbp),
      fbc: clip(body.fbc),
      gclid: clickId(body.gclid),
      gbraid: clickId(body.gbraid),
      wbraid: clickId(body.wbraid),
      sourceUrl: clip(body.url, 500),
      ip,
      ua,
    },
  });
  // proxy: the store script opens <store domain>/apps/growpefy/c/<id> (same checkout, on the store's own domain)
  const proxy = proxyCheckoutReady(store);
  return reply({ url: `${storeBaseUrl(store)}/c/${id}`, id, proxy: proxy ? `${PROXY_PATH}/c/${id}` : null });
}

/** Google click IDs are URL-safe tokens; anything else is ignored. */
function clickId(v: unknown) {
  return typeof v === "string" && /^[\w-]{10,200}$/.test(v) ? v : undefined;
}

function clip(v: unknown, max = 200) {
  return typeof v === "string" && v ? v.slice(0, max) : undefined;
}

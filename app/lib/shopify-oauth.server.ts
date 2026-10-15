import { createCookie, redirect } from "@remix-run/node";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, stores, type Store } from "~/db.server";
import { env } from "./env.server";
import { clearTokenCache } from "./shopify.server";

import { SHOPIFY_SCOPES } from "./scopes";
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

let cookie: ReturnType<typeof createCookie> | null = null;
function stateCookie() {
  cookie ??= createCookie("__cx_oauth", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/shopify",
    maxAge: 600,
    secrets: [env.sessionSecret],
  });
  return cookie;
}

export function cleanShop(v: string | null) {
  const s = (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return SHOP_RE.test(s) ? s : null;
}

export async function storeByShop(shop: string) {
  const [s] = await db.select().from(stores).where(eq(stores.shopDomain, shop)).limit(1);
  return s ?? null;
}

/** Verifies the `hmac` Shopify adds to install/callback URLs. */
export function verifyShopifyHmac(url: URL, secret: string) {
  const hmac = url.searchParams.get("hmac");
  if (!hmac) return false;
  const msg = [...url.searchParams.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = crypto.createHmac("sha256", secret).update(msg).digest("hex");
  return hmac.length === expected.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
}

/** Redirects the browser to Shopify's permission screen (offline token). */
export async function beginOAuth(store: Store) {
  if (!store.clientId || !store.clientSecret) {
    throw new Response("Save the Shopify Client ID and Client secret for this store first", { status: 400 });
  }
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: store.clientId,
    scope: SHOPIFY_SCOPES,
    redirect_uri: `${env.appUrl}/shopify/callback`,
    state,
  });
  return redirect(`https://${store.shopDomain}/admin/oauth/authorize?${params}`, {
    headers: { "Set-Cookie": await stateCookie().serialize({ state, shop: store.shopDomain }) },
  });
}

/** Handles Shopify's redirect back: checks hmac + state, swaps code for a permanent token. */
export async function finishOAuth(request: Request) {
  const url = new URL(request.url);
  const shop = cleanShop(url.searchParams.get("shop"));
  const code = url.searchParams.get("code");
  if (!shop || !code) throw new Response("Invalid callback", { status: 400 });

  const store = await storeByShop(shop);
  if (!store?.clientId || !store.clientSecret) throw new Response("This store is not added to the checkout dashboard", { status: 404 });
  if (!verifyShopifyHmac(url, store.clientSecret)) throw new Response("Shopify signature check failed", { status: 401 });

  const saved = (await stateCookie().parse(request.headers.get("Cookie"))) as { state?: string; shop?: string } | null;
  if (!saved?.state || saved.state !== url.searchParams.get("state") || saved.shop !== shop) {
    throw new Response("Security check failed. Open the dashboard and click Connect with Shopify again.", { status: 401 });
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: store.clientId, client_secret: store.clientSecret, code }),
  });
  if (!res.ok) throw new Response(`Shopify token exchange failed: ${await res.text()}`, { status: 502 });
  const data = (await res.json()) as { access_token: string; scope?: string };

  await db.update(stores).set({ adminToken: data.access_token }).where(eq(stores.id, store.id));
  clearTokenCache(store.id);
  return redirect(`/dashboard/stores/${store.id}/install?connected=1`, {
    headers: { "Set-Cookie": await stateCookie().serialize("", { maxAge: 0 }) },
  });
}

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

/** The store for a Shopify domain. If the same shop was added more than once, `id` picks the right one. */
export async function storeByShop(shop: string, id?: number | null) {
  const rows = await db.select().from(stores).where(eq(stores.shopDomain, shop));
  return rows.find((s) => s.id === id) ?? rows.find((s) => s.clientId && s.clientSecret) ?? rows[0] ?? null;
}

/** Simple page for OAuth problems, with a way back to the store's settings. */
function oauthError(title: string, text: string, storeId?: number) {
  const back = storeId ? `/dashboard/stores/${storeId}/settings` : "/dashboard";
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#f4f5f2;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px">
<div style="background:#fff;border:1px solid #e2e5e0;border-radius:14px;max-width:520px;padding:28px">
<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#4a5361;line-height:1.55;margin:0 0 18px">${text}</p>
<a href="${back}" style="display:inline-block;background:#0b5d4b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open store settings</a></div></body>`;
  return new Response(html, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Verifies the `hmac` Shopify adds to install/callback URLs. */
export function verifyShopifyHmac(url: URL, secret: string) {
  const hmac = (url.searchParams.get("hmac") ?? "").toLowerCase();
  if (!hmac || !secret) return false;
  const entries = [...url.searchParams.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Shopify signs the URL-encoded query (e.g. "host=...%3D"). Older stores without such characters
  // match either way, so check the encoded form and the plain form.
  const encoded = new URLSearchParams(entries).toString();
  const plain = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const key = secret.trim();
  return [encoded, plain].some((msg) => {
    const expected = crypto.createHmac("sha256", key).update(msg).digest("hex");
    return hmac.length === expected.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  });
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
    headers: { "Set-Cookie": await stateCookie().serialize({ state, shop: store.shopDomain, id: store.id }) },
  });
}

/** Handles Shopify's redirect back: checks hmac + state, swaps code for a permanent token. */
export async function finishOAuth(request: Request) {
  const url = new URL(request.url);
  const shop = cleanShop(url.searchParams.get("shop"));
  const code = url.searchParams.get("code");
  if (!shop || !code) throw new Response("Invalid callback", { status: 400 });

  const saved = (await stateCookie().parse(request.headers.get("Cookie"))) as { state?: string; shop?: string; id?: number } | null;
  const store = await storeByShop(shop, saved?.shop === shop ? saved.id : null);
  if (!store?.clientId || !store.clientSecret) throw oauthError("Store not set up", `${shop} isn't added to Growpefy with a Shopify Client ID and Client secret yet.`, store?.id);
  if (!saved?.state || saved.state !== url.searchParams.get("state") || saved.shop !== shop) {
    throw oauthError("Please try again", "This connect link has expired or was opened in another browser. Go back to the store's Setup page and click Connect with Shopify again (in the same browser, within 10 minutes).", store.id);
  }
  const signed = verifyShopifyHmac(url, store.clientSecret);
  if (!signed) console.warn(`[shopify-oauth] hmac mismatch for ${shop} (store ${store.id}); checking with Shopify's token exchange`);

  // The code can only be swapped for a token with the right Client ID + secret, so this also proves the secret
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: store.clientId.trim(), client_secret: store.clientSecret.trim(), code }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[shopify-oauth] token exchange failed for ${shop}:`, res.status, body.slice(0, 300));
    throw oauthError(
      signed ? "Shopify didn't accept the connection" : "Client secret doesn't match",
      signed
        ? `Shopify returned an error (${res.status}). Click Connect with Shopify again. If it keeps failing, check the app has these permissions and is installed on ${shop}.`
        : `The Client secret saved in Growpefy isn't the secret of the Shopify app with Client ID ${store.clientId.slice(0, 8)}…. In Shopify (Dev Dashboard → your app → Settings), copy the <b>Client secret</b> again, paste it in Store settings (no spaces), save, and connect again. If the same shop was added twice in Growpefy, delete the extra one.`,
      store.id,
    );
  }
  const data = (await res.json()) as { access_token: string; scope?: string };

  // Connected: a "Get credentials" request is done
  await db.update(stores).set({ adminToken: data.access_token, connectStatus: null }).where(eq(stores.id, store.id));
  clearTokenCache(store.id);
  return redirect(`/dashboard/stores/${store.id}/install?connected=1`, {
    headers: { "Set-Cookie": await stateCookie().serialize("", { maxAge: 0 }) },
  });
}

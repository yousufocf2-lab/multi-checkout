import type { LoaderFunctionArgs } from "@remix-run/node";
import { verifyProxySignature } from "~/lib/payu-flow.server";
import { storeByShop } from "~/lib/shopify-oauth.server";

/**
 * https://<store>/apps/growpefy/ping
 *  - "Test App Proxy" link in Store settings / Setup (a page for people)
 *  - ?probe=1: Growpefy's own check before opening checkouts on the store's domain (plain text)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const store = shop ? await storeByShop(shop) : null;
  const ok = Boolean(store && verifyProxySignature(url, store.clientSecret));
  if (url.searchParams.get("probe") === "1") {
    return new Response(ok ? `growpefy-proxy-ok:${store!.slug}` : "growpefy-proxy-bad", { status: ok ? 200 : 401, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const msg = !store ? "App Proxy reached Growpefy, but this shop isn't connected." : ok ? `✅ App Proxy works for ${store.name}. Checkout and payments open on your own website.` : "App Proxy reached Growpefy, but the signature didn't match. Check the Client secret in Store settings.";
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;font-size:16px">${msg}</body>`, { status: ok ? 200 : 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

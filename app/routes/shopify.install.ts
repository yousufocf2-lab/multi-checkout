import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { beginOAuth, cleanShop, storeByShop, verifyShopifyHmac } from "~/lib/shopify-oauth.server";

/**
 * App URL for the Shopify app. Two ways in:
 *  - Shopify sends the merchant here after they open the install link (signed with hmac)
 *  - Admin panel "Connect with Shopify" button (admin login required)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = cleanShop(url.searchParams.get("shop"));
  if (!shop) throw new Response("shop missing", { status: 400 });

  const store = await storeByShop(shop);
  if (!store) throw new Response(`Add ${shop} in the checkout dashboard first`, { status: 404 });

  const signed = store.clientSecret && url.searchParams.has("hmac") && verifyShopifyHmac(url, store.clientSecret);
  if (!signed) await requireStore(await requireViewer(request), store.id);
  return beginOAuth(store);
}

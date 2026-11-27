// Shopify App Proxy: the customer is on https://<store>/apps/growpefy/pay/<order>,
// so gateways that check the website see the store's own domain.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { getOrderWithStore } from "~/lib/orders.server";
import { PROXY_PATH, htmlResponse, orderPageUrl, payPage, payViaStore, proxyBase, startPayment } from "~/lib/gateways/index.server";
import { verifyProxySignature } from "~/lib/payu-flow.server";
import { storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  let { order } = row;
  const { store } = row;
  // The page can also be opened through another store's website that takes this store's payments
  // (Settings → Payments → "Take payments through"): then that store's App Proxy signs the request.
  const via = await payViaStore(store);
  const site = via && url.searchParams.get("shop") === via.shopDomain ? via : store;
  if (url.searchParams.get("shop") !== site.shopDomain || !verifyProxySignature(url, site.clientSecret)) {
    throw new Response("This payment link isn't valid. Go back to the checkout and try again.", { status: 401 });
  }
  const retry = url.searchParams.get("retry") === "1";
  if (order.status === "failed" && retry) {
    const [u] = await db.update(orders).set({ status: "pending_payment", error: null, updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, "failed"))).returning();
    if (u) order = u;
  }
  if (order.status !== "pending_payment") return redirect(orderPageUrl(store, order));
  // Checkout on the store's domain: the gateway returns there too, and "back" goes to that checkout
  const origin = site === store ? order.tracking?.proxyOrigin : undefined;
  const out = await startPayment(store, order, origin ? `${origin}${PROXY_PATH}` : proxyBase(site), { retry });
  const back = origin ? `${origin}${PROXY_PATH}/c/${order.sessionId ?? ""}` : `${storeBaseUrl(store)}/c/${order.sessionId ?? ""}`;
  // text/html (not application/liquid) so Shopify returns the page as it is, without the theme
  return htmlResponse(payPage(store, order, out, back));
}

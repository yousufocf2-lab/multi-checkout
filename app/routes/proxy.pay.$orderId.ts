// Shopify App Proxy: the customer is on https://<store>/apps/growpefy/pay/<order>,
// so gateways that check the website see the store's own domain.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { and, eq } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { getOrderWithStore } from "~/lib/orders.server";
import { htmlResponse, payPage, proxyBase, startPayment } from "~/lib/gateways/index.server";
import { verifyProxySignature } from "~/lib/payu-flow.server";
import { storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  let { order } = row;
  const { store } = row;
  if (url.searchParams.get("shop") !== store.shopDomain || !verifyProxySignature(url, store.clientSecret)) {
    throw new Response("This payment link isn't valid. Go back to the checkout and try again.", { status: 401 });
  }
  const retry = url.searchParams.get("retry") === "1";
  if (order.status === "failed" && retry) {
    const [u] = await db.update(orders).set({ status: "pending_payment", error: null, updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, "failed"))).returning();
    if (u) order = u;
  }
  if (order.status !== "pending_payment") return redirect(`${storeBaseUrl(store)}/order/${order.id}`);
  const out = await startPayment(store, order, proxyBase(store), { retry });
  // text/html (not application/liquid) so Shopify returns the page as it is, without the theme
  return htmlResponse(payPage(store, order, out, `${storeBaseUrl(store)}/c/${order.sessionId ?? ""}`));
}

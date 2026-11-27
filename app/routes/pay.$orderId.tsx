// Hands the customer to the store's payment gateway (primary first; backups if it can't start).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db, orders } from "~/db.server";
import { and, eq } from "drizzle-orm";
import { getOrderWithStore } from "~/lib/orders.server";
import { PROXY_PATH, htmlResponse, ownSiteHost, payPage, payUrl, payUrlFor, payViaStore, startPayment } from "~/lib/gateways/index.server";
import { isProxied } from "~/lib/proxy-checkout.server";
import { checkoutBaseUrl, ensureStoreHost, requestHost, storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  let { order } = row;
  const { store } = row;
  const own = ownSiteHost(store);
  const host = requestHost(request);
  // Payments taken through another store's website (same owner, its gateway account), e.g. zavli.in/pay/…
  const via = isProxied(request) ? null : await payViaStore(store);
  const viaOwn = via ? ownSiteHost(via) : null;
  if (!own && !via) ensureStoreHost(request, store);
  const retry = new URL(request.url).searchParams.get("retry") === "1";
  // "Try again" after a failed payment opens the next gateway
  if (order.status === "failed" && retry) {
    const [u] = await db.update(orders).set({ status: "pending_payment", error: null, updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, "failed"))).returning();
    if (u) order = u;
  }
  // Opened on the store's own domain at /apps/growpefy/pay (checkout from before the move off Shopify)
  const legacy = isProxied(request);
  if (order.status !== "pending_payment") return redirect(legacy ? `${PROXY_PATH}/order/${order.id}` : `/order/${order.id}`);
  if (via) {
    // Already on the lending store's own domain: start the payment here, so the gateway returns here too
    if (viaOwn && (host === viaOwn || host === `www.${viaOwn}` || `www.${host}` === viaOwn)) {
      const out = await startPayment(store, order, `https://${viaOwn}`, { retry });
      return htmlResponse(payPage(store, order, out, `${checkoutBaseUrl(store)}/c/${order.sessionId ?? ""}`));
    }
    return redirect(await payUrlFor(store, order.id, retry));
  }
  // Payments start from the store's own website (gateways that check the website)
  if (own ? host !== own : store.payuViaStorefront) return redirect(payUrl(store, order.id, retry));
  const base = own ? `https://${own}` : storeBaseUrl(store);
  const out = await startPayment(store, order, legacy ? `${base}${PROXY_PATH}` : base, { retry });
  return htmlResponse(payPage(store, order, out, `${legacy ? `${base}${PROXY_PATH}` : base}/c/${order.sessionId ?? ""}`));
}

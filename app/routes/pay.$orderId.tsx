// Hands the customer to the store's payment gateway (primary first; backups if it can't start).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db, orders } from "~/db.server";
import { and, eq } from "drizzle-orm";
import { getOrderWithStore } from "~/lib/orders.server";
import { htmlResponse, payPage, payUrl, startPayment } from "~/lib/gateways/index.server";
import { ensureStoreHost, storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  let { order } = row;
  const { store } = row;
  ensureStoreHost(request, store);
  const retry = new URL(request.url).searchParams.get("retry") === "1";
  // "Try again" after a failed payment opens the next gateway
  if (order.status === "failed" && retry) {
    const [u] = await db.update(orders).set({ status: "pending_payment", error: null, updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, "failed"))).returning();
    if (u) order = u;
  }
  if (order.status !== "pending_payment") return redirect(`/order/${order.id}`);
  // Payments started from the store's own website (gateways that check the website)
  if (store.payuViaStorefront) return redirect(payUrl(store, order.id, retry));
  const base = storeBaseUrl(store);
  const out = await startPayment(store, order, base, { retry });
  return htmlResponse(payPage(store, order, out, `${base}/c/${order.sessionId ?? ""}`));
}

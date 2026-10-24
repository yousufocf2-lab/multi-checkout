import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { orderValuePaise, toCollectPaise } from "~/lib/payment-methods";
import { json } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { Link, useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import { getOrderWithStore } from "~/lib/orders.server";
import { activeGateways, payUrl, syncOrderPayment } from "~/lib/gateways/index.server";
import { formatINR } from "~/lib/pricing";
import { ensureStoreHost } from "~/lib/urls.server";
import { MetaPixel } from "~/components/MetaPixel";
import { BrandLoader, PoweredBy } from "~/components/Brand";
import { purchaseValue, shouldTrackPurchase } from "~/lib/meta.server";

export const meta: MetaFunction = () => [{ title: "Your order" }, { name: "robots", content: "noindex" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  let { order } = row;
  const { store } = row;
  ensureStoreHost(request, store);
  // If the gateway redirect never arrived (closed browser, network), ask the gateway directly — at most every 20s.
  if (order.status === "pending_payment" && Date.now() - order.createdAt.getTime() > 45_000 && Date.now() - order.updatedAt.getTime() > 20_000) {
    try { order = await syncOrderPayment(store, order, "order-page"); } catch (e) { console.error("[order sync]", e instanceof Error ? e.message : e); }
    if (order.status === "pending_payment") await db.update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, order.id));
  }
  let continueUrl = store.storefrontUrl;
  try {
    const u = new URL(store.storefrontUrl);
    u.searchParams.set("cx_clear", "1");
    continueUrl = u.toString();
  } catch { /* keep plain url */ }
  return json({
    id: order.id,
    status: order.status,
    method: order.paymentMethod,
    name: order.customer.firstName,
    shopifyName: order.shopifyOrderName,
    total: orderValuePaise(order),
    paidNow: order.paymentMethod === "partial" ? order.amountPaid ?? order.advance ?? 0 : 0,
    toCollect: toCollectPaise(order),
    savings: Math.max(0, order.subtotal - orderValuePaise(order) + order.paymentFee),
    sessionId: order.sessionId,
    store: { name: store.name, logoUrl: store.logoUrl, supportPhone: store.supportPhone, color: store.primaryColor },
    items: order.items.map((l) => ({ title: l.title, variantTitle: l.variantTitle, image: l.image, quantity: l.quantity, free: Boolean(l.free) })),
    address: `${order.customer.address1}${order.customer.address2 ? ", " + order.customer.address2 : ""}, ${order.customer.city} ${order.customer.pincode}`,
    continueUrl,
    pixel: shouldTrackPurchase(store, order)
      ? { id: store.metaPixelId!, value: purchaseValue(order), items: order.items.map((l) => l.variantId), count: order.items.reduce((n, l) => n + l.quantity, 0) }
      : null,
    plainStoreUrl: store.storefrontUrl,
    // after a failed payment: pay again, on the next gateway when the store has backups
    retryUrl: order.status === "failed" && (order.paymentMethod === "prepaid" || order.paymentMethod === "partial") ? payUrl(store, order.id, true) : null,
    hasBackup: activeGateways(store).length > 1,
  });
}

function rgb(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "17 24 39";
}

export default function OrderStatus() {
  const d = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const ok = d.status === "paid" || d.status === "cod_placed";
  const pending = d.status === "pending_payment" || d.status === "cod_placing";

  // Payment confirmations can take a few seconds; check again automatically.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => revalidator.state === "idle" && revalidator.revalidate(), 3000);
    return () => clearInterval(t);
  }, [pending, revalidator]);

  return (
    <main style={{ ["--brand" as string]: rgb(d.store.color) }} className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex justify-center">
          {d.store.logoUrl ? <img src={d.store.logoUrl} alt={d.store.name} className="h-8 w-auto max-w-[150px] object-contain" /> : <p className="text-lg font-semibold">{d.store.name}</p>}
        </div>
        <div className="rounded-2xl border border-rule bg-white p-6">
          {ok && (
            <>
              {d.pixel && (
                <MetaPixel pixelId={d.pixel.id} event="Purchase" eventId={d.id} onceKey={`purchase_${d.id}`}
                  data={{ currency: "INR", value: d.pixel.value, content_ids: d.pixel.items, content_type: "product", num_items: d.pixel.count }} />
              )}
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-xl text-good" aria-hidden>✓</div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Thank you, {d.name}</h1>
              <p className="mt-1 text-ink-soft">Your order is confirmed{d.shopifyName ? ` as ${d.shopifyName}` : ""}. We'll send updates to your phone.</p>
              <dl className="mt-6 space-y-2 rounded-xl bg-paper p-4 text-sm">
                {d.method === "partial" ? (
                  <>
                    <div className="flex justify-between"><dt className="text-ink-soft">Paid now (advance)</dt><dd className="num font-semibold">{formatINR(d.paidNow)}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-soft">Pay on delivery</dt><dd className="num font-semibold">{formatINR(d.toCollect)}</dd></div>
                  </>
                ) : (
                  <div className="flex justify-between"><dt className="text-ink-soft">{d.method === "cod" ? "Pay on delivery" : "Paid"}</dt><dd className="num font-semibold">{formatINR(d.total)}</dd></div>
                )}
                {d.savings > 0 && <div className="flex justify-between"><dt className="text-ink-soft">You saved</dt><dd className="num font-medium text-good">{formatINR(d.savings)}</dd></div>}
                <div className="flex justify-between gap-4"><dt className="text-ink-soft">Delivering to</dt><dd className="text-right">{d.address}</dd></div>
              </dl>
              <ul className="mt-5 space-y-3">
                {d.items.map((l, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-rule bg-paper">{l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}</div>
                    <p className="min-w-0 flex-1 text-sm"><span className="line-clamp-1 font-medium">{l.title}</span>{l.variantTitle && <span className="text-xs text-ink-faint">{l.variantTitle}</span>}</p>
                    {l.free && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-good">FREE</span>}
                    <span className="num text-sm text-ink-soft">×{l.quantity}</span>
                  </li>
                ))}
              </ul>
              <a href={d.continueUrl} className="btn-primary mt-6 w-full py-3">Continue shopping</a>
            </>
          )}

          {d.status === "failed" && (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-xl font-semibold text-bad" aria-hidden>!</div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">Payment didn't go through</h1>
              <p className="mt-1 text-ink-soft">No order was placed. If money left your account, your bank will return it in 5 to 7 working days.</p>
              {d.retryUrl && <a href={d.retryUrl} className="btn-primary mt-6 w-full py-3">{d.hasBackup ? "Try another payment option" : "Pay again"}</a>}
              {d.sessionId && <Link to={`/c/${d.sessionId}`} className={`${d.retryUrl ? "btn-secondary mt-3" : "btn-primary mt-6"} w-full py-3`}>{d.retryUrl ? "Change payment method" : "Try again"}</Link>}
              <a href={d.plainStoreUrl} className="btn-secondary mt-3 w-full py-3">Back to store</a>
            </>
          )}

          {pending && (
            <div className="py-6 text-center" role="status" aria-live="polite">
              <BrandLoader className="mx-auto h-16 w-16" label="Confirming payment" />
              <h1 className="mt-4 text-lg font-semibold">Confirming your payment</h1>
              <p className="mt-1 text-sm text-ink-soft">This usually takes a few seconds. Please keep this page open.</p>
            </div>
          )}
        </div>
        {d.store.supportPhone && <p className="mt-5 text-center text-xs text-ink-faint">Questions about your order? Call <a className="underline" href={`tel:${d.store.supportPhone}`}>{d.store.supportPhone}</a></p>}
        <div className="mt-4 flex justify-center"><PoweredBy /></div>
      </div>
    </main>
  );
}

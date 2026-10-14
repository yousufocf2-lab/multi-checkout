import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { getOrderWithStore } from "~/lib/orders.server";
import { formatINR } from "~/lib/pricing";
import { MetaPixel } from "~/components/MetaPixel";
import { purchaseValue, shouldTrackPurchase } from "~/lib/meta.server";

export const meta: MetaFunction = () => [{ title: "Order status" }, { name: "robots", content: "noindex" }];

export async function loader({ params }: LoaderFunctionArgs) {
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  const { order, store } = row;
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
    total: order.amountPaid ?? order.total,
    savings: order.subtotal - (order.amountPaid ?? order.total),
    sessionId: order.sessionId,
    store: { name: store.name, logoUrl: store.logoUrl, supportPhone: store.supportPhone },
    continueUrl,
    pixel: shouldTrackPurchase(store, order)
      ? { id: store.metaPixelId!, value: purchaseValue(order), items: order.items.map((l) => l.variantId), count: order.items.reduce((n, l) => n + l.quantity, 0) }
      : null,
    plainStoreUrl: store.storefrontUrl,
  });
}

export default function OrderStatus() {
  const d = useLoaderData<typeof loader>();
  const ok = d.status === "paid" || d.status === "cod_placed";
  const pending = d.status === "pending_payment" || d.status === "cod_placing";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="card text-center">
        {d.store.logoUrl ? <img src={d.store.logoUrl} alt={d.store.name} className="mx-auto mb-4 h-8" /> : <p className="mb-4 font-bold">{d.store.name}</p>}

        {ok && (
          <>
            {d.pixel && (
              <MetaPixel
                pixelId={d.pixel.id}
                event="Purchase"
                eventId={d.id}
                onceKey={`purchase_${d.id}`}
                data={{ currency: "INR", value: d.pixel.value, content_ids: d.pixel.items, content_type: "product", num_items: d.pixel.count }}
              />
            )}
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
            <h1 className="mt-4 text-xl font-bold">Order confirmed!</h1>
            <p className="mt-1 text-gray-600">Shukriya {d.name}, aapka order place ho gaya hai.</p>
            <div className="mt-5 space-y-1 rounded-xl bg-gray-50 p-4 text-sm">
              <p>Order: <b>{d.shopifyName ?? d.id}</b></p>
              <p>{d.method === "cod" ? "Delivery pe pay karein" : "Paid"}: <b>{formatINR(d.total)}</b></p>
              {d.savings > 0 && <p className="font-medium text-emerald-700">Aapne {formatINR(d.savings)} bachaye 🎉</p>}
            </div>
            <a href={d.continueUrl} className="btn-primary mt-6 w-full py-3">Continue shopping</a>
          </>
        )}

        {d.status === "failed" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-2xl">!</div>
            <h1 className="mt-4 text-xl font-bold">Payment fail ho gaya</h1>
            <p className="mt-1 text-gray-600">Paisa kata hai toh 5–7 din mein wapas aa jayega. Dobara try karein.</p>
            {d.sessionId && <Link to={`/c/${d.sessionId}`} className="btn-primary mt-6 w-full py-3">Try again</Link>}
            <a href={d.plainStoreUrl} className="btn-ghost mt-3 w-full py-3">Back to store</a>
          </>
        )}

        {pending && (
          <>
            <h1 className="text-xl font-bold">Order process ho raha hai…</h1>
            <p className="mt-1 text-gray-600">Kuch second baad page refresh karein.</p>
          </>
        )}

        {d.store.supportPhone && (
          <p className="mt-6 text-xs text-gray-500">Help: <a className="underline" href={`tel:${d.store.supportPhone}`}>{d.store.supportPhone}</a></p>
        )}
      </div>
    </main>
  );
}

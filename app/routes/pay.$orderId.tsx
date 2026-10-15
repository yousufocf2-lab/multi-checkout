import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { and, eq, isNotNull } from "drizzle-orm";
import { useEffect, useRef } from "react";
import { bankOffers, db } from "~/db.server";
import { ensureStoreHost, storeBaseUrl } from "~/lib/urls.server";
import { getOrderWithStore } from "~/lib/orders.server";
import { buildPayuParams, payuEndpoint } from "~/lib/payu.server";

export const meta: MetaFunction = () => [{ title: "Redirecting to payment…" }, { name: "robots", content: "noindex" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const row = await getOrderWithStore(params.orderId!);
  if (!row) throw new Response("Order not found", { status: 404 });
  const { order, store } = row;
  ensureStoreHost(request, store);
  if (order.status !== "pending_payment") return redirect(`/order/${order.id}`);

  const offers = await db
    .select({ key: bankOffers.payuOfferKey })
    .from(bankOffers)
    .where(and(eq(bankOffers.storeId, store.id), eq(bankOffers.active, true), isNotNull(bankOffers.payuOfferKey)));

  const fields = buildPayuParams(store, order, {
    callbackUrl: `${storeBaseUrl(store)}/payu/callback`,
    offerKeys: offers.map((o) => o.key!).filter(Boolean),
  });
  return json({ action: payuEndpoint(store), fields });
}

export default function Pay() {
  const { action, fields } = useLoaderData<typeof loader>();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.submit(); }, []);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-800" />
      <p className="mt-4 font-medium">Secure payment page khul raha hai…</p>
      <form ref={ref} method="post" action={action} className="mt-6">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <noscript><button className="btn-primary">Continue to payment</button></noscript>
      </form>
    </main>
  );
}

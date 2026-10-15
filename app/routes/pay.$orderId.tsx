import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { and, eq, isNotNull } from "drizzle-orm";
import { useEffect, useRef } from "react";
import { bankOffers, db } from "~/db.server";
import { ensureStoreHost, storeBaseUrl } from "~/lib/urls.server";
import { getOrderWithStore } from "~/lib/orders.server";
import { buildPayuParams, payuEndpoint } from "~/lib/payu.server";
import { formatINR } from "~/lib/pricing";

export const meta: MetaFunction = () => [{ title: "Opening secure payment" }, { name: "robots", content: "noindex" }];

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
  return json({ action: payuEndpoint(store), fields, store: { name: store.name, logoUrl: store.logoUrl, color: store.primaryColor }, amount: order.total });
}

function rgb(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "17 24 39";
}

export default function Pay() {
  const { action, fields, store, amount } = useLoaderData<typeof loader>();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.submit(); }, []);
  return (
    <main style={{ ["--brand" as string]: rgb(store.color) }} className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center" role="status" aria-live="polite">
      {store.logoUrl ? <img src={store.logoUrl} alt={store.name} className="mb-8 h-9 w-auto max-w-[160px] object-contain" /> : <p className="mb-8 text-lg font-semibold">{store.name}</p>}
      <div className="h-1 w-48 overflow-hidden rounded-full bg-paper-sunk"><div className="h-full w-1/2 animate-bar rounded-full bg-brand" /></div>
      <p className="mt-6 font-medium">Opening secure payment for {formatINR(amount)}</p>
      <p className="mt-1 text-sm text-ink-soft">Don't close this page or press back.</p>
      <form ref={ref} method="post" action={action} className="mt-8">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <noscript><button className="btn-primary">Continue to payment</button></noscript>
      </form>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        Processed securely by PayU
      </p>
    </main>
  );
}

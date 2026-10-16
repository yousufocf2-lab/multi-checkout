import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { StatusBadge } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const s = await requireStore(viewer, params.id);
  return json({ store: { id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl, checkout: storeBaseUrl(s), connected: Boolean(s.adminToken) } });
}

const TITLES: Record<string, { title: string; description: string }> = {
  ads: { title: "Ads", description: "Meta ad spend, cost per order, ROAS and recharges." },
  discounts: { title: "Discounts", description: "Online and COD discounts, for the whole store or chosen products." },
  coupons: { title: "Coupons", description: "Codes customers can apply at checkout." },
  offers: { title: "Bank offers", description: "Card and bank offers applied on the PayU page." },
  shipping: { title: "Shipping", description: "Delivery charges by location, order value and payment method." },
  settings: { title: "Store settings", description: "Shopify, PayU, COD rules and Meta ads for this store." },
  design: { title: "Checkout design", description: "Colors, fonts, logo and layout of your checkout." },
  install: { title: "Setup", description: "Connect Shopify, payments, webhooks and your theme." },
};

/** Store pages share a slim header; the section menu lives in the sidebar. */
export default function StoreLayout() {
  const { store } = useLoaderData<typeof loader>();
  const section = useLocation().pathname.split("/")[4] ?? "";
  const t = TITLES[section];
  return (
    <>
      {t && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rule bg-surface text-lg font-semibold">
            {store.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-contain p-1.5" /> : store.name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{t.title}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
              <span className="font-medium text-ink">{store.name}</span>
              <StatusBadge status={store.active ? "live" : "off"} />
              {!store.connected && <StatusBadge status="pending_payment" label="Shopify not connected" />}
              <span className="hidden truncate text-ink-faint sm:inline">{t.description}</span>
            </p>
          </div>
        </div>
      )}
      <Outlet />
    </>
  );
}

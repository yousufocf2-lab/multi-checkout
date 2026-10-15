import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { NavLink, Outlet, useLoaderData } from "@remix-run/react";
import { StatusBadge } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { storeBaseUrl } from "~/lib/urls.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const s = await requireStore(viewer, params.id);
  return json({ store: { id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl, checkout: storeBaseUrl(s), connected: Boolean(s.adminToken) } });
}

const TABS = [
  { to: "", label: "Overview", end: true },
  { to: "orders", label: "Orders" },
  { to: "discounts", label: "Discounts" },
  { to: "coupons", label: "Coupons" },
  { to: "offers", label: "Bank offers" },
  { to: "ads", label: "Ads" },
  { to: "settings", label: "Settings" },
  { to: "install", label: "Setup" },
];

export default function StoreLayout() {
  const { store } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-rule bg-white text-lg font-semibold">
          {store.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-contain p-1.5" /> : store.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight">{store.name}</h1>
            <StatusBadge status={store.active ? "live" : "off"} />
            {!store.connected && <StatusBadge status="pending_payment" label="Shopify not connected" />}
          </div>
          <p className="truncate text-sm text-ink-faint">{store.checkout.replace(/^https:\/\//, "")}</p>
        </div>
      </div>
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-rule px-4 sm:mx-0 sm:px-0" aria-label="Store sections">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} preventScrollReset
            className={({ isActive }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${isActive ? "border-ink font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

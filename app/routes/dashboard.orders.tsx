import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { NavLink, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { StoreFilter } from "~/components/StoreFilter";
import { PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { dashboardScope } from "~/lib/selection.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope, picked, locked } = await dashboardScope(request, all);
  return json({ stores: all.map((s) => ({ id: s.id, name: s.name })), picked, locked, scopeName: scope.length === 1 ? scope[0].name : null });
}

export default function OrdersLayout() {
  const { stores, picked, locked, scopeName } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const keepStores = new URLSearchParams([...new URLSearchParams(search).entries()].filter(([k]) => k === "s")).toString();
  const q = keepStores ? `?${keepStores}` : "";
  return (
    <>
      <PageHeader title="Orders" description={scopeName ? `Orders and abandoned checkouts for ${scopeName}.` : "Every order and abandoned checkout across your stores."}
        actions={stores.length > 1 && !locked && <StoreFilter stores={stores} selected={picked} />} />
      <nav className="mb-5 flex gap-1 border-b border-rule" aria-label="Order views">
        {[{ to: `/dashboard/orders${q}`, label: "Orders", end: true }, { to: `/dashboard/orders/abandoned${q}`, label: "Abandoned checkouts" }].map((t) => (
          <NavLink key={t.label} to={t.to} end={t.end} className={({ isActive }) => `-mb-px border-b-2 px-3 py-2.5 text-sm ${isActive ? "border-ink font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { NavLink, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { StoreFilter, selectedStoreIds } from "~/components/StoreFilter";
import { PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const picked = selectedStoreIds(new URL(request.url).searchParams).filter((id) => all.some((s) => s.id === id));
  return json({ stores: all.map((s) => ({ id: s.id, name: s.name })), picked });
}

export default function OrdersLayout() {
  const { stores, picked } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const keepStores = new URLSearchParams([...new URLSearchParams(search).entries()].filter(([k]) => k === "s")).toString();
  const q = keepStores ? `?${keepStores}` : "";
  return (
    <>
      <PageHeader title="Orders" description="Every order and abandoned checkout across your stores." actions={stores.length > 1 && <StoreFilter stores={stores} selected={picked} />} />
      <nav className="mb-5 flex gap-1 border-b border-rule" aria-label="Order views">
        {[{ to: `/dashboard/orders${q}`, label: "All orders", end: true }, { to: `/dashboard/orders/abandoned${q}`, label: "Abandoned checkouts" }].map((t) => (
          <NavLink key={t.label} to={t.to} end={t.end} className={({ isActive }) => `-mb-px border-b-2 px-3 py-2.5 text-sm ${isActive ? "border-ink font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

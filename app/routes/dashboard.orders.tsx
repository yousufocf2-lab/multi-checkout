import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useRouteLoaderData } from "@remix-run/react";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { dashboardScope } from "~/lib/selection.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope, picked, locked } = await dashboardScope(request, all);
  return json({ stores: all.map((s) => ({ id: s.id, name: s.name })), picked, locked, scopeName: scope.length === 1 ? scope[0].name : null });
}

/** Store list for the store filter on the Orders and Abandoned checkouts pages. */
export const useOrdersScope = () => useRouteLoaderData<typeof loader>("routes/dashboard.orders");

export default function OrdersLayout() {
  return <Outlet />;
}

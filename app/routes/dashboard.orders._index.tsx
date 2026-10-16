import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useLocation } from "@remix-run/react";
import { OrdersView } from "~/components/OrdersViews";
import { Notice } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { handleOrderAction, loadOrders } from "~/lib/orders-list.server";
import { dashboardScope } from "~/lib/selection.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope } = await dashboardScope(request, all);
  return json({ ...(await loadOrders(scope, new URL(request.url).searchParams)), showStore: all.length > 1 && scope.length !== 1 });
}

export async function action({ request }: ActionFunctionArgs) {
  return handleOrderAction(await requireViewer(request), await request.formData());
}

export default function AllOrders() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const { search } = useLocation();
  return (
    <div className="space-y-4">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      <OrdersView orders={d.orders} hasMore={d.hasMore} page={d.page} showStore={d.showStore}
        filters={d.filters} summary={d.summary} products={d.products} exportHref={`/dashboard/orders/export.csv${search}`} />
    </div>
  );
}

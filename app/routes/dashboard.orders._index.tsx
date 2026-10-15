import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { OrdersView } from "~/components/OrdersViews";
import { selectedStoreIds } from "~/components/StoreFilter";
import { Notice } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { handleOrderAction, loadOrders } from "~/lib/orders-list.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  const params = new URL(request.url).searchParams;
  const picked = selectedStoreIds(params);
  const scope = picked.length ? all.filter((s) => picked.includes(s.id)) : all;
  return json({ ...(await loadOrders(scope, params)), showStore: all.length > 1 && scope.length !== 1 });
}

export async function action({ request }: ActionFunctionArgs) {
  return handleOrderAction(await requireViewer(request), await request.formData());
}

export default function AllOrders() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  return (
    <div className="space-y-4">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      <OrdersView orders={d.orders} hasMore={d.hasMore} page={d.page} showStore={d.showStore} />
    </div>
  );
}

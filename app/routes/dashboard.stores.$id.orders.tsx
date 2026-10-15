import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useActionData, useLoaderData } from "@remix-run/react";
import { OrdersView } from "~/components/OrdersViews";
import { Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { handleOrderAction, loadOrders } from "~/lib/orders-list.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  return json({ ...(await loadOrders([store], new URL(request.url).searchParams)), storeId: store.id });
}

export async function action({ request }: ActionFunctionArgs) {
  return handleOrderAction(await requireViewer(request), await request.formData());
}

export default function StoreOrders() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  return (
    <div className="space-y-4">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      <OrdersView orders={d.orders} hasMore={d.hasMore} page={d.page} showStore={false} />
      <p className="text-sm"><Link to={`/dashboard/orders/abandoned?s=${d.storeId}`} className="underline underline-offset-2">See abandoned checkouts for this store</Link></p>
    </div>
  );
}

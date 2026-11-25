// One order on its own page (like Shopify's order page): items and shipment, payment, timeline with comments,
// customer and address, notes, tags, and what Shopify doesn't show — where the order came from (ad or direct),
// the customer's IP address with its city, and the device they ordered on.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useLocation } from "@remix-run/react";
import { OrderPage } from "~/components/OrderPage";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { handleOrderAction } from "~/lib/orders-list.server";
import { loadOrderPage } from "~/lib/order-page.server";
import { dashboardScope } from "~/lib/selection.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: data ? `Order ${data.order.shopifyOrderName ?? `#${data.order.id.slice(-6).toUpperCase()}`}` : "Order" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  const { scope } = await dashboardScope(request, all);
  return json(await loadOrderPage(viewer, String(params.orderId ?? ""), scope, new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  return handleOrderAction(await requireViewer(request), await request.formData());
}

export default function OrderRoute() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const { search } = useLocation();
  return <OrderPage data={d} result={res ?? null} search={search} />;
}

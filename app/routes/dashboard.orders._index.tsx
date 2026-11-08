import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useLocation } from "@remix-run/react";
import { OrdersView } from "~/components/OrdersViews";
import { DownloadLink } from "~/components/DownloadLink";
import { StoreFilter } from "~/components/StoreFilter";
import { Notice, PageHeader } from "~/components/ui";
import { useOrdersScope } from "./dashboard.orders";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { handleOrderAction, loadOrders } from "~/lib/orders-list.server";
import { dashboardScope } from "~/lib/selection.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope } = await dashboardScope(request, all);
  return json({ ...(await loadOrders(scope, new URL(request.url).searchParams)), showStore: all.length > 1 && scope.length !== 1, availableStores: all.map((s) => ({ id: s.id, name: s.name })) });
}

export async function action({ request }: ActionFunctionArgs) {
  return handleOrderAction(await requireViewer(request), await request.formData());
}

export default function AllOrders() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const { search } = useLocation();
  const scope = useOrdersScope();
  return (
    <div className="space-y-3">
      <PageHeader icon="bag" title="Orders" actions={<>
        {scope && scope.stores.length > 1 && !scope.locked && <StoreFilter stores={scope.stores} selected={scope.picked} />}
        <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { if (!confirm("This adds Shopify orders as searchable history. It will not send messages or purchase events. Continue?")) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="import_shopify_history" />
          {d.availableStores.length === 1 ? <input type="hidden" name="storeId" value={d.availableStores[0].id} /> : <select name="storeId" required defaultValue={String(scope?.picked ?? "")} className="input w-auto py-1 text-[11px]" aria-label="Store for order import"><option value="" disabled>Choose store</option>{d.availableStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <input type="file" name="file" accept=".csv,text/csv" required className="max-w-[190px] text-[11px]" aria-label="Choose Shopify orders CSV" />
          <button type="submit" className="btn-secondary">Import Shopify history</button>
        </Form>
        <DownloadLink href={`/dashboard/orders/export.csv${search}`} title="Preparing your CSV" className="btn-secondary">Export</DownloadLink>
      </>} />
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      <OrdersView orders={d.orders} hasMore={d.hasMore} page={d.page} showStore={d.showStore}
        filters={d.filters} summary={d.summary} products={d.products} tagOptions={d.tagOptions} deliveryOptions={d.deliveryOptions} couriers={d.couriers} cancelReasons={d.cancelReasons} exportHref={`/dashboard/orders/export.csv${search}`} />
    </div>
  );
}

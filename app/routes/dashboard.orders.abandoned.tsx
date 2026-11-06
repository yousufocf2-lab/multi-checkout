import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AbandonedView } from "~/components/OrdersViews";
import { StoreFilter } from "~/components/StoreFilter";
import { PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { loadAbandoned } from "~/lib/orders-list.server";
import { dashboardScope } from "~/lib/selection.server";
import { useOrdersScope } from "./dashboard.orders";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope } = await dashboardScope(request, all);
  return json({ data: await loadAbandoned(scope, new URL(request.url).searchParams), showStore: all.length > 1 && scope.length !== 1 });
}

export default function Abandoned() {
  const { data, showStore } = useLoaderData<typeof loader>();
  const scope = useOrdersScope();
  return (
    <div className="space-y-3">
      <PageHeader icon="cart" title="Abandoned checkouts" guide="abandoned"
        actions={scope && scope.stores.length > 1 && !scope.locked && <StoreFilter stores={scope.stores} selected={scope.picked} />} />
      <AbandonedView data={data} showStore={showStore} />
    </div>
  );
}

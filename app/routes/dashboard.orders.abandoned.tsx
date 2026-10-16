import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AbandonedView } from "~/components/OrdersViews";
import { RangePicker } from "~/components/Overview";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { loadAbandoned } from "~/lib/orders-list.server";
import { dashboardScope } from "~/lib/selection.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope } = await dashboardScope(request, all);
  return json({ data: await loadAbandoned(scope, new URL(request.url).searchParams), showStore: all.length > 1 && scope.length !== 1 });
}

export default function Abandoned() {
  const { data, showStore } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-4">
      <RangePicker current={data.range} />
      <AbandonedView data={data} showStore={showStore} />
    </div>
  );
}

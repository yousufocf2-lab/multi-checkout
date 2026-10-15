import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { AbandonedView } from "~/components/OrdersViews";
import { RangePicker } from "~/components/Overview";
import { selectedStoreIds } from "~/components/StoreFilter";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { loadAbandoned } from "~/lib/orders-list.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const params = new URL(request.url).searchParams;
  const picked = selectedStoreIds(params);
  const scope = picked.length ? all.filter((s) => picked.includes(s.id)) : all;
  return json({ data: await loadAbandoned(scope, params), showStore: all.length > 1 && scope.length !== 1 });
}

export default function Abandoned() {
  const { data, showStore } = useLoaderData<typeof loader>();
  return (
    <div className="space-y-5">
      <RangePicker current={data.range} />
      <AbandonedView data={data} showStore={showStore} />
    </div>
  );
}

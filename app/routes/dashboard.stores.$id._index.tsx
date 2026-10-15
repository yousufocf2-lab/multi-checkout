import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { OverviewView, RangePicker } from "~/components/Overview";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { earliestDate, loadOverview } from "~/lib/stats.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate([store]));
  return json({ overview: await loadOverview([store], range), storeId: store.id });
}

export default function StoreOverview() {
  const { overview, storeId } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="mb-5"><RangePicker current={overview.range} /></div>
      <OverviewView data={overview} showStoreColumn={false} adsHref={`/dashboard/stores/${storeId}/settings#meta`} />
    </>
  );
}

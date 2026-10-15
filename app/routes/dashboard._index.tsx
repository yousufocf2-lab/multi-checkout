import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { OverviewView, RangePicker } from "~/components/Overview";
import { StoreFilter, selectedStoreIds } from "~/components/StoreFilter";
import { EmptyState, PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { earliestDate, loadOverview } from "~/lib/stats.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  const params = new URL(request.url).searchParams;
  const picked = selectedStoreIds(params).filter((id) => all.some((s) => s.id === id));
  const scope = picked.length ? all.filter((s) => picked.includes(s.id)) : all;
  const range = resolveRange(params, await earliestDate(scope));
  const overview = await loadOverview(scope, range);
  return json({ overview, stores: all.map((s) => ({ id: s.id, name: s.name })), picked, viewerName: viewer.name.split(" ")[0] });
}

export default function DashboardHome() {
  const { overview, stores, picked, viewerName } = useLoaderData<typeof loader>();

  if (stores.length === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${viewerName}`} description="Connect your first Shopify store to start using your own checkout." />
        <EmptyState title="No stores yet" action={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>}>
          You'll need your store's .myshopify.com domain and a Shopify app's Client ID and secret. It takes about 10 minutes.
        </EmptyState>
      </>
    );
  }

  const scopeName = picked.length === 0 || picked.length === stores.length
    ? stores.length === 1 ? stores[0].name : `All ${stores.length} stores`
    : picked.map((id) => stores.find((s) => s.id === id)?.name).filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        title="Overview"
        description={scopeName}
        actions={stores.length > 1 && (
          <>
            <StoreFilter stores={stores} selected={picked} />
            <Link to="/dashboard/compare" className="btn-secondary py-2">Compare stores</Link>
          </>
        )}
      />
      <div className="mb-5"><RangePicker current={overview.range} /></div>
      <OverviewView data={overview} showStoreColumn={stores.length > 1 && picked.length !== 1} />
    </>
  );
}

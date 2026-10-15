import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSubmit } from "@remix-run/react";
import { OverviewView, RangePicker } from "~/components/Overview";
import { EmptyState, PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { earliestDate, loadOverview } from "~/lib/stats.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  const params = new URL(request.url).searchParams;
  const storeFilter = params.get("store");
  const scope = storeFilter ? all.filter((s) => String(s.id) === storeFilter) : all;
  const range = resolveRange(params, await earliestDate(scope));
  const overview = await loadOverview(scope, range);
  return json({ overview, stores: all.map((s) => ({ id: s.id, name: s.name })), storeFilter, viewerName: viewer.name.split(" ")[0] });
}

export default function DashboardHome() {
  const { overview, stores, storeFilter, viewerName } = useLoaderData<typeof loader>();
  const submit = useSubmit();

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

  return (
    <>
      <PageHeader
        title="Overview"
        description={storeFilter ? stores.find((s) => String(s.id) === storeFilter)?.name : stores.length === 1 ? stores[0].name : `All ${stores.length} stores`}
        actions={stores.length > 1 && (
          <Form method="get" onChange={(e) => submit(e.currentTarget, { preventScrollReset: true })}>
            <input type="hidden" name="range" value={overview.range.preset} />
            {overview.range.preset === "custom" && (<><input type="hidden" name="from" value={overview.range.since} /><input type="hidden" name="to" value={overview.range.until} /></>)}
            <label className="sr-only" htmlFor="store-filter">Store</label>
            <select id="store-filter" name="store" defaultValue={storeFilter ?? ""} className="input py-2 pr-8">
              <option value="">All stores</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Form>
        )}
      />
      <div className="mb-5"><RangePicker current={overview.range} /></div>
      <OverviewView data={overview} showStoreColumn={!storeFilter && stores.length > 1} />
    </>
  );
}

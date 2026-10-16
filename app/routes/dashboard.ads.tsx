import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { RangePicker } from "~/components/Overview";
import { CostTag, EmptyState, PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { lastSnapshot, withGst } from "~/lib/recharges.server";
import { dashboardScope } from "~/lib/selection.server";
import { earliestDate, loadLeaderboard } from "~/lib/stats.server";

/** Ads across stores. With one store in focus, goes straight to that store's Ads page. */
export async function loader({ request }: LoaderFunctionArgs) {
  const all = await viewerStores(await requireViewer(request));
  const { scope } = await dashboardScope(request, all);
  if (scope.length === 1) return redirect(`/dashboard/stores/${scope[0].id}/ads${new URL(request.url).search}`);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate(scope));
  const rows = scope.length > 1 ? await loadLeaderboard(scope, range) : [];
  const withAds = new Set(scope.filter((s) => s.metaAdAccountId && s.metaAccessToken).map((s) => s.id));
  const snaps = await Promise.all(rows.map((r) => (withAds.has(r.id) ? lastSnapshot(r.id) : Promise.resolve(null))));
  return json({
    range,
    rows: rows.map((r, i) => ({
      ...r, connected: withAds.has(r.id),
      balance: snaps[i] ? snaps[i]!.availablePaise / 100 : null,
      invested: snaps[i] ? withGst((snaps[i]!.availablePaise + snaps[i]!.spentPaise) / 100) : null,
    })),
  });
}

const inr = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : "₹" + Math.round(v).toLocaleString("en-IN"));

export default function AdsAll() {
  const { range, rows } = useLoaderData<typeof loader>();
  const spend = rows.reduce((s, r) => s + (r.adSpend ?? 0), 0);
  const revenue = rows.filter((r) => r.connected).reduce((s, r) => s + r.revenue, 0);
  const ordersN = rows.filter((r) => r.connected).reduce((s, r) => s + r.orders, 0);
  const cpo = ordersN ? spend / ordersN : null;
  return (
    <>
      <PageHeader title="Ads" description="Meta ad performance for every store. Pick a store for campaigns and recharges." actions={<RangePicker current={range} align="right" />} />
      {rows.length === 0 ? (
        <EmptyState title="No stores yet" action={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Ad spend" value={inr(spend)} />
            <Kpi label="Revenue (stores with ads)" value={inr(revenue)} />
            <Kpi label="ROAS" value={spend ? `${(revenue / spend).toFixed(2)}x` : "—"} />
            <Kpi label="Cost per order" value={inr(cpo)} tag={<CostTag value={cpo} />} />
          </div>
          <div className="panel overflow-x-auto">
            <table className="table num min-w-[760px]">
              <thead><tr><th>Store</th><th className="text-right">Ad spend</th><th className="text-right">Orders</th><th className="text-right">Cost per order</th><th className="text-right">ROAS</th><th className="text-right">Balance</th><th className="text-right">Total invested</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/dashboard/stores/${r.id}/ads`} className="font-medium hover:underline">{r.name}</Link></td>
                    {r.connected ? (
                      <>
                        <td className="text-right">{inr(r.adSpend)}</td>
                        <td className="text-right">{r.orders}</td>
                        <td className="text-right"><span className="inline-flex items-center gap-1.5">{inr(r.costPerOrder)}<CostTag value={r.costPerOrder} /></span></td>
                        <td className="text-right">{r.roas != null ? `${r.roas.toFixed(2)}x` : "—"}</td>
                        <td className="text-right">{inr(r.balance)}</td>
                        <td className="text-right">{inr(r.invested)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="text-right text-xs text-ink-faint"><Link to={`/dashboard/stores/${r.id}/settings#meta`} className="underline">Connect Meta ads</Link></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-faint">Total invested = (lifetime spend + balance) + 18% GST, from the latest balance check. Cost tags: under ₹35 excellent, ₹35–59 good, ₹60–99 average, ₹100+ poor.</p>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, tag }: { label: string; value: string; tag?: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="num mt-1 flex flex-wrap items-center gap-1.5 text-xl font-semibold">{value}{tag}</p>
    </div>
  );
}

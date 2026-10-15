import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { CompareChart, STORE_COLORS } from "~/components/charts";
import { RangePicker } from "~/components/Overview";
import { StoreFilter, selectedStoreIds } from "~/components/StoreFilter";
import { EmptyState, PageHeader } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { earliestDate, loadOverview } from "~/lib/stats.server";

const MAX = 4;

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  const params = new URL(request.url).searchParams;
  let ids = selectedStoreIds(params).filter((id) => all.some((s) => s.id === id)).slice(0, MAX);
  if (!ids.length) ids = all.slice(0, MAX).map((s) => s.id);
  const picked = ids.map((id) => all.find((s) => s.id === id)!).filter(Boolean);
  const range = resolveRange(params, await earliestDate(picked));
  const overviews = await Promise.all(picked.map((s) => loadOverview([s], range)));
  return json({
    stores: all.map((s) => ({ id: s.id, name: s.name })),
    picked: picked.map((s) => s.id),
    range,
    rows: overviews.map((o, i) => ({ id: picked[i].id, name: picked[i].name, totals: o.totals, buckets: o.buckets.map((b) => ({ label: b.label, longLabel: b.longLabel, revenue: b.prepaid + b.cod })) })),
  });
}

type Row = ReturnType<typeof useLoaderData<typeof loader>>["rows"][number];
type T = Row["totals"];

const inr = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : "₹" + Math.round(v).toLocaleString("en-IN"));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

// better: "high" = bigger is better, "low" = smaller is better, null = no winner
const METRICS: { label: string; get: (t: T) => number | null; fmt: (v: number | null) => string; better: "high" | "low" | null; bar?: boolean }[] = [
  { label: "Revenue", get: (t) => t.revenue, fmt: inr, better: "high", bar: true },
  { label: "Orders", get: (t) => t.orders, fmt: (v) => (v ?? 0).toLocaleString("en-IN"), better: "high", bar: true },
  { label: "Prepaid orders", get: (t) => t.prepaidOrders, fmt: (v) => (v ?? 0).toLocaleString("en-IN"), better: "high" },
  { label: "COD orders", get: (t) => t.codOrders, fmt: (v) => (v ?? 0).toLocaleString("en-IN"), better: null },
  { label: "Prepaid share", get: (t) => (t.orders ? t.prepaidOrders / t.orders : null), fmt: pct, better: "high" },
  { label: "Average order value", get: (t) => (t.orders ? t.aov : null), fmt: inr, better: "high" },
  { label: "Ad spend", get: (t) => t.adSpend, fmt: inr, better: null, bar: true },
  { label: "ROAS", get: (t) => t.roas, fmt: (v) => (v == null ? "—" : `${v.toFixed(2)}x`), better: "high" },
  { label: "Cost per order", get: (t) => t.costPerOrder, fmt: inr, better: "low" },
  { label: "Checkout conversion", get: (t) => t.conversion, fmt: pct, better: "high" },
  { label: "Checkouts started", get: (t) => t.sessions, fmt: (v) => (v ?? 0).toLocaleString("en-IN"), better: null },
  { label: "Abandoned checkouts", get: (t) => t.abandoned, fmt: (v) => (v ?? 0).toLocaleString("en-IN"), better: "low" },
  { label: "Failed payments", get: (t) => t.failedPayments, fmt: (v) => (v ?? 0).toLocaleString("en-IN"), better: "low" },
  { label: "Discounts given", get: (t) => t.discounts, fmt: inr, better: null },
  { label: "Refunded", get: (t) => t.refunded, fmt: inr, better: "low" },
];

export default function Compare() {
  const { stores, picked, range, rows } = useLoaderData<typeof loader>();

  if (stores.length < 2) {
    return (
      <>
        <PageHeader title="Compare stores" />
        <EmptyState title="You need at least two stores to compare" action={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>} />
      </>
    );
  }

  const labels = rows[0]?.buckets.map((b) => b.label) ?? [];
  const longLabels = rows[0]?.buckets.map((b) => b.longLabel) ?? [];

  return (
    <>
      <PageHeader title="Compare stores" description="See side by side which store is doing better. Pick up to 4."
        actions={<StoreFilter stores={stores} selected={picked} max={MAX} label="Comparing" />} />
      <div className="mb-5"><RangePicker current={range} /></div>

      <section className="panel mb-5 p-5">
        <h2 className="mb-4 text-[15px] font-semibold">Revenue over time</h2>
        <CompareChart labels={labels} longLabels={longLabels} series={rows.map((r) => ({ name: r.name, values: r.buckets.map((b) => b.revenue) }))} />
      </section>

      <div className="panel overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr>
              <th className="w-48">Metric</th>
              {rows.map((r, i) => (
                <th key={r.id}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: STORE_COLORS[i] }} />
                    <Link to={`/dashboard/stores/${r.id}`} className="hover:underline">{r.name}</Link></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const vals = rows.map((r) => m.get(r.totals));
              // "Lower is better" only counts for stores that actually had orders
              const eligible = vals.filter((v, i) => m.better !== "low" || rows[i].totals.orders > 0);
              const finite = eligible.filter((v): v is number => v != null && Number.isFinite(v));
              const best = m.better && finite.length > 1 && new Set(finite).size > 1
                ? (m.better === "high" ? Math.max(...finite) : Math.min(...finite)) : null;
              const top = Math.max(0, ...vals.filter((v): v is number => v != null && Number.isFinite(v)));
              return (
                <tr key={m.label}>
                  <td className="text-ink-soft">{m.label}</td>
                  {vals.map((v, i) => {
                    const isBest = best != null && v === best && (m.better !== "low" || rows[i].totals.orders > 0);
                    return (
                      <td key={rows[i].id} className="num">
                        <span className={isBest ? "font-semibold text-ink" : ""}>{m.fmt(v)}</span>
                        {isBest && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-good">Best</span>}
                        {m.bar && top > 0 && v != null && (
                          <span className="mt-1.5 block h-1.5 w-full max-w-[160px] rounded-full bg-paper-sunk" aria-hidden>
                            <span className="block h-full rounded-full" style={{ width: `${(v / top) * 100}%`, background: STORE_COLORS[i] }} />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-faint">“Best” marks the strongest value in each row. Ad spend needs a Meta ad account connected in each store's settings.</p>
    </>
  );
}

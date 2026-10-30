import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { PageHeader, Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { profitReport } from "~/lib/profit.server";
import { rupees } from "~/lib/wallet";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!store.profitEnabled && viewer.role !== "admin") throw new Response("Not found", { status: 404 });
  const raw = await profitReport(store);
  const report = viewer.role === "admin" ? raw : {
    ...raw,
    rows: raw.rows.map(({ growpefyShare: _hidden, ...row }) => ({ ...row, growpefyShare: null })),
    totals: raw.totals ? { ...raw.totals, growpefyShare: null } : null,
  };
  return json({ name: store.name, admin: viewer.role === "admin", dropship: store.dropshipEnabled, report });
}

const inr = (v: number) => rupees(Math.round(v * 100), 2);
const dateLabel = (v: string) => new Date(`${v}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default function ProfitShare() {
  const d = useLoaderData<typeof loader>();
  const { report } = d;
  const rows = report.rows;
  const r = report.totals;
  const share = d.admin ? r?.growpefyShare ?? 0 : r?.storeShare ?? 0;
  return (
    <>
      <PageHeader title="Sales and profit" description={`${d.name} · from ${dateLabel(report.since)} to ${dateLabel(report.until)} · cash profit follows PayU settlement dates`} />
      <div className="space-y-5">
        {!report.enabled && <Notice tone="info">This store's profit dashboard is off. Turn it on in the super admin's Dropshipping page.</Notice>}
        {report.warnings.map((w, i) => <Notice key={i} tone="warning">{w}</Notice>)}
        {report.enabled && <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Shopify orders" value={String(r?.orders ?? 0)} sub={inr(r?.revenue ?? 0) + " revenue by order date"} />
            <Stat label="PayU settled to bank" value={inr(r?.settlement ?? 0)} sub="Actual settlements received" />
            <Stat label="Ads incl. 18% GST" value={inr(r?.adCostWithGst ?? 0)} sub="Meta + Google daily spend" />
            <Stat label={d.admin ? "Growpefy share" : "Your store share"} value={inr(share)} sub={`Running profit: ${inr(r?.cumulative ?? 0)}${d.dropship ? " · Growpefy share fixed at 20%" : ""}`} />
          </div>
          <section className="panel">
            <div className="border-b border-rule px-5 py-4">
              <h2 className="text-[15px] font-semibold">Daily breakdown</h2>
              <p className="mt-0.5 text-xs text-ink-faint">Revenue is grouped by Shopify order date. Profit is grouped by the day PayU settles money to the bank. Ads GST is added at 18%.</p>
            </div>
            {rows.length ? <div className="overflow-x-auto"><table className="table min-w-[1080px]">
              <thead><tr><th>Date</th><th className="text-right">Orders</th><th className="text-right">Shopify revenue</th><th className="text-right">Bank settlement</th><th className="text-right">Ads + GST</th>{d.dropship && <th className="text-right">Dropship costs</th>}<th className="text-right">Day profit</th><th className="text-right">Running profit</th>{d.admin && <th className="text-right">Growpefy share</th>}<th className="text-right">Store share</th></tr></thead>
              <tbody>{rows.slice().reverse().map((x) => <tr key={x.day}>
                <td>{dateLabel(x.day)}</td><td className="num text-right">{x.orders.toLocaleString("en-IN")}</td><td className="num text-right">{inr(x.revenue)}</td>
                <td className="num text-right">{inr(x.settlement)}</td><td className="num text-right">{inr(x.adCostWithGst)}</td>{d.dropship && <td className="num text-right">{inr(-x.dropship)}</td>}
                <td className={`num text-right ${x.net < 0 ? "text-bad" : ""}`}>{inr(x.net)}</td><td className={`num text-right font-semibold ${x.cumulative < 0 ? "text-bad" : ""}`}>{inr(x.cumulative)}</td>
                {d.admin && <td className="num text-right">{inr(x.growpefyShare ?? 0)}</td>}<td className="num text-right">{inr(x.storeShare)}</td>
              </tr>)}</tbody>
            </table></div> : <p className="px-5 py-8 text-center text-sm text-ink-faint">No orders or settlements in this period yet.</p>}
          </section>
          <p className="text-xs text-ink-faint">{d.dropship ? "Dropship costs include product, shipping, ₹4 packing per unit, RTO charges and wallet refunds. These amounts are already GST-inclusive and are not taxed again." : "Profit share is calculated after carrying forward earlier losses. The share is set by the super admin."}</p>
        </>}
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="panel min-w-0 p-4"><p className="truncate text-xs font-medium text-ink-soft">{label}</p><p className="num mt-2 text-xl font-semibold">{value}</p><p className="mt-1 truncate text-xs text-ink-faint">{sub}</p></div>;
}

// Shipping → Remittance: money from delivered orders. COD = cash the courier collected and owes you;
// prepaid = paid online. Only delivered orders count, dated by delivery (IST).
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import { RevenueChart } from "~/components/charts";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { PageHeader } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { rangeLabel, resolveRange } from "~/lib/dates";
import { PAY_FILTERS, type PayFilter } from "~/lib/remittance";
import { remittance } from "~/lib/remittance.server";

const COD = "#eb6834", PREPAID = "#0B5D4B";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  if (!url.searchParams.get("range")) url.searchParams.set("range", "30d");
  const range = resolveRange(url.searchParams, store.createdAt.toISOString().slice(0, 10));
  const p = url.searchParams.get("pay");
  const pay: PayFilter = p === "cod" || p === "prepaid" ? p : "all";
  return json({ range, pay, label: rangeLabel(range), ...(await remittance(store.id, range, pay)) });
}

const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default function Remittance() {
  const d = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const [showAll, setShowAll] = useState(false);
  const t = d.totals;
  const payHref = (id: string) => { const q = new URLSearchParams(params); id === "all" ? q.delete("pay") : q.set("pay", id); return `?${q}`; };
  const rows = showAll ? d.list : d.list.slice(0, 25);

  return (
    <div className="space-y-5">
      <PageHeader title="Remittance" description="Money from delivered orders. COD is the cash your courier collected and pays out to you; prepaid was paid online." icon="rupee"
        actions={<RangePicker current={d.range} align="right" />} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5 shadow-sm" role="tablist" aria-label="Payment method">
          {PAY_FILTERS.map((f) => (
            <Link key={f.id} to={payHref(f.id)} preventScrollReset role="tab" aria-selected={d.pay === f.id}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${d.pay === f.id ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>{f.label}</Link>
          ))}
        </div>
        <span className="text-xs text-ink-faint">Delivered {d.label.toLowerCase()} · by delivery date</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Total delivered value" value={inr(t.total)} sub={`${t.orders.toLocaleString("en-IN")} delivered orders`} accent="#1f2a37" />
        <Card label="COD to be remitted" value={inr(t.cod)} sub={`${t.codOrders.toLocaleString("en-IN")} COD orders${t.advance > 0 ? ` · ${inr(t.advance)} advance paid online` : ""}`} accent={COD} muted={d.pay === "prepaid"} />
        <Card label="Prepaid (paid online)" value={inr(t.prepaid)} sub={`${t.prepaidOrders.toLocaleString("en-IN")} prepaid orders`} accent={PREPAID} muted={d.pay === "cod"} />
        <Card label="Average delivered order" value={t.orders ? inr(t.total / t.orders) : "—"} sub={t.orders ? `COD share ${Math.round((t.cod / (t.total || 1)) * 100)}%` : "No delivered orders"} accent="#2a78d6" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Delivered value over time</h2>
          {t.orders ? <RevenueChart buckets={d.buckets} showAds={false} /> : <Empty />}
        </section>

        <section className="panel p-5">
          <h2 className="mb-3 text-[15px] font-semibold">COD vs prepaid</h2>
          {t.orders ? <Donut cod={t.cod} prepaid={t.prepaid} codOrders={t.codOrders} prepaidOrders={t.prepaidOrders} /> : <Empty />}
        </section>
      </div>

      {d.couriers.length > 0 && (
        <section className="panel overflow-hidden">
          <h2 className="border-b border-rule px-5 py-3 text-[15px] font-semibold">By courier</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-ink-soft"><tr className="border-b border-rule">
                <th className="px-5 py-2.5 font-medium">Courier</th><th className="px-3 py-2.5 text-right font-medium">COD orders</th><th className="px-3 py-2.5 text-right font-medium">COD to remit</th>
                <th className="px-3 py-2.5 text-right font-medium">Prepaid orders</th><th className="px-3 py-2.5 text-right font-medium">Prepaid value</th><th className="px-5 py-2.5 font-medium">Share</th>
              </tr></thead>
              <tbody className="divide-y divide-rule">
                {d.couriers.map((c) => {
                  const share = t.total ? ((c.cod + c.prepaid) / t.total) * 100 : 0;
                  return (
                    <tr key={c.name}>
                      <td className="px-5 py-2.5 font-medium">{c.name}</td>
                      <td className="num px-3 py-2.5 text-right">{c.codOrders.toLocaleString("en-IN")}</td>
                      <td className="num px-3 py-2.5 text-right font-semibold">{inr(c.cod)}</td>
                      <td className="num px-3 py-2.5 text-right">{c.prepaidOrders.toLocaleString("en-IN")}</td>
                      <td className="num px-3 py-2.5 text-right">{inr(c.prepaid)}</td>
                      <td className="px-5 py-2.5"><div className="flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-sunk"><div className="h-full rounded-full bg-ink" style={{ width: `${share}%` }} /></div><span className="num text-xs text-ink-soft">{Math.round(share)}%</span></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.list.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2 className="text-[15px] font-semibold">Delivered orders <span className="font-normal text-ink-faint">{d.listTotal.toLocaleString("en-IN")}</span></h2>
            {d.listTotal > d.list.length && <span className="text-xs text-ink-faint">Showing the latest {d.list.length}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-ink-soft"><tr className="border-b border-rule">
                <th className="px-5 py-2.5 font-medium">Order</th><th className="px-3 py-2.5 font-medium">Delivered</th><th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Courier · AWB</th><th className="px-3 py-2.5 font-medium">Payment</th><th className="px-5 py-2.5 text-right font-medium">Amount</th>
              </tr></thead>
              <tbody className="divide-y divide-rule">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-paper">
                    <td className="num px-5 py-2.5 font-medium">{o.name}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{when(o.at)}</td>
                    <td className="px-3 py-2.5">{o.customer}<span className="block text-xs text-ink-faint">{o.city}</span></td>
                    <td className="px-3 py-2.5 text-ink-soft">{o.courier}{o.awb ? <span className="num block text-xs text-ink-faint">{o.awb}</span> : null}</td>
                    <td className="px-3 py-2.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: o.method === "COD" ? "#fdf0ea" : "#e6f2ee", color: o.method === "COD" ? "#b0461a" : PREPAID }}>{o.method}</span></td>
                    <td className="num px-5 py-2.5 text-right font-semibold">{inr(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.list.length > 25 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full border-t border-rule py-2.5 text-sm font-medium text-ink-soft hover:bg-paper hover:text-ink">
              {showAll ? "Show less" : `Show all ${d.list.length}`}
            </button>
          )}
        </section>
      )}

      <p className="flex items-start gap-1.5 text-xs text-ink-faint"><Icon name="help" className="mt-px h-3.5 w-3.5 shrink-0" />
        Worked out from your orders' delivery status. Your courier's payout can differ by its fees, COD charges and payout cycle.</p>
    </div>
  );
}

function Card({ label, value, sub, accent, muted }: { label: string; value: string; sub: string; accent: string; muted?: boolean }) {
  return (
    <div className={`panel relative overflow-hidden px-4 py-3.5 ${muted ? "opacity-50" : ""}`}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="num mt-1 text-[24px] font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-ink-faint">{sub}</p>
    </div>
  );
}

function Donut({ cod, prepaid, codOrders, prepaidOrders }: { cod: number; prepaid: number; codOrders: number; prepaidOrders: number }) {
  const total = cod + prepaid || 1;
  const R = 62, W = 18, C = 2 * Math.PI * R;
  const codLen = (cod / total) * C;
  const gap = cod > 0 && prepaid > 0 ? 3 : 0;
  return (
    <div>
      <div className="relative mx-auto h-[172px] w-[172px]">
        <svg viewBox="0 0 172 172" className="h-full w-full -rotate-90" role="img" aria-label={`COD ${Math.round((cod / total) * 100)} percent, prepaid ${Math.round((prepaid / total) * 100)} percent`}>
          <circle cx="86" cy="86" r={R} fill="none" stroke="#EEF0EC" strokeWidth={W} />
          {prepaid > 0 && <circle cx="86" cy="86" r={R} fill="none" stroke={PREPAID} strokeWidth={W} strokeDasharray={`${Math.max(0, C - codLen - gap)} ${C}`} strokeDashoffset={-(codLen + gap / 2)} />}
          {cod > 0 && <circle cx="86" cy="86" r={R} fill="none" stroke={COD} strokeWidth={W} strokeDasharray={`${Math.max(0, codLen - gap)} ${C}`} strokeDashoffset={-gap / 2} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] text-ink-soft">Delivered</span>
          <span className="num text-[18px] font-semibold">{inr(cod + prepaid)}</span>
          <span className="num text-[11px] text-ink-faint">{(codOrders + prepaidOrders).toLocaleString("en-IN")} orders</span>
        </div>
      </div>
      <dl className="mt-4 space-y-2.5">
        {[["Cash on Delivery", cod, codOrders, COD], ["Prepaid", prepaid, prepaidOrders, PREPAID]].map(([l, v, n, c]) => (
          <div key={l as string} className="flex items-center gap-2.5 text-sm">
            <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c as string }} />
            <dt className="flex-1 text-ink-soft">{l as string} <span className="text-xs text-ink-faint">· {(n as number).toLocaleString("en-IN")}</span></dt>
            <dd className="num font-semibold">{inr(v as number)}</dd>
            <dd className="num w-10 text-right text-xs text-ink-faint">{Math.round(((v as number) / total) * 100)}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Empty() {
  return <div className="flex h-[220px] flex-col items-center justify-center text-center text-sm text-ink-soft"><Icon name="chart" className="h-6 w-6 text-ink-faint" /><p className="mt-2">No delivered orders in this period.</p></div>;
}

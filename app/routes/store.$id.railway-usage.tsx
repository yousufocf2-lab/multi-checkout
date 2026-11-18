// Railway Usage: the store's hosting bill (server, database, storage, network), written by Growpefy super admin.
// Only stores the super admin switched on see it; draft bills stay hidden.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import { Icon } from "~/components/Icons";
import { PageHeader } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { formatINR } from "~/lib/pricing";
import { GROUP_LABEL, resourceOf, usageTotals, type UsageGroup } from "~/lib/usage-bill";
import { billsFor } from "~/lib/usage-bill.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!store.usageBilling) throw new Response("Not found", { status: 404 });
  const bills = (await billsFor(store.id, { published: true })).map((b) => ({
    id: b.id, start: b.periodStart, end: b.periodEnd, status: b.status as "due" | "paid", due: b.dueDate, paidAt: b.paidAt?.toISOString() ?? null,
    note: b.note, lines: b.lines, totals: usageTotals(b.lines),
  }));
  return json({ storeName: store.name, bills });
}

type Bill = ReturnType<typeof useLoaderData<typeof loader>>["bills"][number];
const fmt = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
const range = (b: Pick<Bill, "start" | "end">) => `${fmt(b.start)} – ${fmt(b.end, { day: "numeric", month: "short", year: "numeric" })}`;
const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const rateFmt = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const BRAND = "#0B5D4B";

export default function RailwayUsage() {
  const d = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const sel = d.bills.find((b) => b.id === Number(params.get("bill"))) ?? d.bills[0];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-8">
      <PageHeader title="Railway Usage" icon="layers"
        description="What your store's hosting used and costs: app server, database, media storage and network. Billed by Growpefy." />

      {!sel ? (
        <section className="panel flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eef4f1] text-pine"><Icon name="layers" className="h-5 w-5" /></span>
          <p className="mt-3 text-[15px] font-semibold">No usage bill yet</p>
          <p className="mt-1 max-w-sm text-[13px] text-ink-soft">Your first bill shows up here at the end of the billing period, with every resource and its price.</p>
        </section>
      ) : (
        <>
          {d.bills.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="period" className="text-[13px] font-medium text-ink-soft">Billing period</label>
              <select id="period" value={sel.id} onChange={(e) => { const p = new URLSearchParams(params); p.set("bill", e.target.value); setParams(p, { preventScrollReset: true }); }}
                className="input h-9 w-auto min-w-[220px] text-[13px]">
                {d.bills.map((b) => <option key={b.id} value={b.id}>{range(b)} · {b.status === "paid" ? "Paid" : "Due"}</option>)}
              </select>
            </div>
          )}

          <Summary b={sel} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <History bills={d.bills} selected={sel.id} />
            <Split b={sel} />
          </div>

          <Breakdown b={sel} />
          {d.bills.some((b) => b.totals.egressGb > 0) && <Egress bills={d.bills} selected={sel.id} />}
        </>
      )}
    </div>
  );
}

/** The headline: what this period costs and whether it's paid. */
function Summary({ b }: { b: Bill }) {
  const t = b.totals;
  const due = b.status === "due";
  const overdue = due && b.due != null && b.due < new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const cells: { label: string; value: string; sub: string }[] = [
    { label: "Usage", value: formatINR(Math.max(0, t.usage)), sub: "compute, storage and network" },
    { label: "Network egress", value: `${qtyFmt(t.egressGb)} GB`, sub: formatINR(Math.max(0, t.byGroup.network)) },
    { label: "Plan & credits", value: formatINR(t.byGroup.plan + t.byGroup.credit), sub: t.byGroup.credit ? `${formatINR(Math.abs(t.byGroup.credit))} included usage` : "fixed monthly fee" },
  ];
  return (
    <section className="panel overflow-hidden p-0">
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <div className="border-b border-rule px-5 py-5 lg:border-b-0 lg:border-r">
          <p className="text-[13px] font-medium text-ink-soft">{due ? "Amount due" : "Bill total"} · {range(b)}</p>
          <p className="num mt-2 text-[36px] font-semibold leading-none tracking-tight text-ink">{formatINR(t.total)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {due ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${overdue ? "bg-[#fdeceb] text-[#b42318]" : "bg-[#fff4e0] text-[#8a5a00]"}`}>
                <Icon name={overdue ? "alert" : "clock"} className="h-3.5 w-3.5" />{overdue ? "Overdue" : "Due"}{b.due ? ` · pay by ${fmt(b.due, { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e3f1ea] px-2.5 py-1 text-[12px] font-semibold text-[#1f6f4a]">
                <Icon name="check" className="h-3.5 w-3.5" />Paid{b.paidAt ? ` · ${new Date(b.paidAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` : ""}
              </span>
            )}
          </div>
          {b.note && <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-[13px] text-ink-soft">{b.note}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3">
          {cells.map((c, i) => (
            <div key={c.label} className={`px-5 py-5 ${i > 0 ? "border-t border-rule sm:border-l sm:border-t-0" : ""}`}>
              <p className="text-[12.5px] font-medium text-ink-soft">{c.label}</p>
              <p className="num mt-1.5 text-[22px] font-semibold leading-none text-ink">{c.value}</p>
              <p className="mt-1.5 text-[12px] text-ink-faint">{c.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** One bar per billing period (oldest left); hover shows the amount. */
function History({ bills, selected }: { bills: Bill[]; selected: number }) {
  const list = [...bills].reverse().slice(-12);
  const max = Math.max(1, ...list.map((b) => b.totals.total));
  const [hover, setHover] = useState<number | null>(null);
  const shown = list.find((b) => b.id === hover) ?? list.find((b) => b.id === selected);
  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Bill history</h2>
        {shown && <p className="text-[12.5px] text-ink-soft">{range(shown)} · <b className="num text-ink">{formatINR(shown.totals.total)}</b></p>}
      </div>
      <div className="mt-5 flex h-44 items-end gap-2 border-b border-rule" role="img" aria-label="Bill total per billing period">
        {list.map((b) => {
          const h = Math.max(2, (b.totals.total / max) * 100);
          const on = b.id === selected;
          return (
            <Link key={b.id} to={`?bill=${b.id}`} preventScrollReset onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(b.id)} onBlur={() => setHover(null)}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end" aria-label={`${range(b)}: ${formatINR(b.totals.total)}`}>
              <span className="w-full rounded-t-[4px] transition-opacity" style={{ height: `${h}%`, background: BRAND, opacity: on || hover === b.id ? 1 : 0.35 }} />
            </Link>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {list.map((b) => <span key={b.id} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-faint">{fmt(b.start, { month: "short" })}</span>)}
      </div>
    </section>
  );
}

/** Where this period's money goes, biggest first. */
function Split({ b }: { b: Bill }) {
  const rows = b.lines.filter((l) => l.amountPaise > 0).sort((x, y) => y.amountPaise - x.amountPaise);
  const sum = rows.reduce((s, l) => s + l.amountPaise, 0) || 1;
  return (
    <section className="panel p-5">
      <h2 className="text-[15px] font-semibold">Where it goes</h2>
      <p className="text-[12.5px] text-ink-soft">Share of this period's charges, before credits.</p>
      <ul className="mt-4 space-y-3">
        {rows.map((l, i) => (
          <li key={i} title={`${l.label}: ${formatINR(l.amountPaise)}`}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-medium text-ink">{l.label}</span>
              <span className="num shrink-0 text-ink-soft"><b className="font-semibold text-ink">{formatINR(l.amountPaise)}</b> · {Math.round((l.amountPaise / sum) * 100)}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-sunk"><div className="h-full rounded-full" style={{ width: `${(l.amountPaise / sum) * 100}%`, background: BRAND }} /></div>
          </li>
        ))}
        {!rows.length && <li className="text-[13px] text-ink-faint">No charges in this period.</li>}
      </ul>
    </section>
  );
}

const ORDER: UsageGroup[] = ["compute", "network", "storage", "other", "plan", "credit"];

/** Line by line: what was used, the price per unit and the amount. */
function Breakdown({ b }: { b: Bill }) {
  const lines = [...b.lines].sort((x, y) => ORDER.indexOf(resourceOf(x.key).group) - ORDER.indexOf(resourceOf(y.key).group));
  return (
    <section className="panel overflow-hidden p-0">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Usage details</h2>
        <p className="text-[12.5px] text-ink-soft">{range(b)}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13.5px]">
          <thead>
            <tr className="border-b border-rule bg-paper text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
              <th className="px-5 py-2.5 font-semibold">Resource</th>
              <th className="px-3 py-2.5 text-right font-semibold">Used</th>
              <th className="px-3 py-2.5 text-right font-semibold">Price</th>
              <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {lines.map((l, i) => {
              const g = resourceOf(l.key).group;
              return (
                <tr key={i}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">{l.label}</p>
                    <p className="text-[12px] text-ink-faint">{GROUP_LABEL[g]}</p>
                  </td>
                  <td className="num px-3 py-3 text-right text-ink">{l.qty ? `${qtyFmt(l.qty)} ${l.unit}` : "—"}</td>
                  <td className="num px-3 py-3 text-right text-ink-soft">{l.ratePaise ? `${rateFmt(l.ratePaise)} / ${l.unit}` : "—"}</td>
                  <td className={`num px-5 py-3 text-right font-semibold ${l.amountPaise < 0 ? "text-[#067647]" : "text-ink"}`}>{l.amountPaise < 0 ? `− ${formatINR(-l.amountPaise)}` : formatINR(l.amountPaise)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-rule bg-paper">
              <td className="px-5 py-3.5 text-[14px] font-semibold" colSpan={3}>Total</td>
              <td className="num px-5 py-3.5 text-right text-[16px] font-semibold">{formatINR(b.totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Network egress (GB) per billing period. */
function Egress({ bills, selected }: { bills: Bill[]; selected: number }) {
  const list = [...bills].reverse().slice(-12);
  const max = Math.max(1, ...list.map((b) => b.totals.egressGb));
  return (
    <section className="panel p-5">
      <h2 className="text-[15px] font-semibold">Network egress</h2>
      <p className="text-[12.5px] text-ink-soft">Data sent out by your store (pages, photos, checkout) in each billing period.</p>
      <ul className="mt-4 space-y-2.5">
        {list.map((b) => (
          <li key={b.id} className="grid grid-cols-[90px_minmax(0,1fr)_80px] items-center gap-3 text-[13px]" title={`${range(b)}: ${qtyFmt(b.totals.egressGb)} GB`}>
            <span className={b.id === selected ? "font-semibold text-ink" : "text-ink-soft"}>{fmt(b.start, { month: "short", year: "2-digit" })}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-paper-sunk"><span className="block h-full rounded-full" style={{ width: `${(b.totals.egressGb / max) * 100}%`, background: BRAND, opacity: b.id === selected ? 1 : 0.5 }} /></span>
            <span className="num text-right font-medium text-ink">{qtyFmt(b.totals.egressGb)} GB</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

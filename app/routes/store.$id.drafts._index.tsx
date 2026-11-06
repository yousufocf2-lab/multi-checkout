// Orders → Drafts: orders the store owner made (phone, WhatsApp, Instagram), before they become real orders.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { LearnMore } from "~/components/ui";
import { can, requireStore, requireViewer } from "~/lib/auth.server";
import { draftCounts, draftName, draftTotals, listDrafts } from "~/lib/drafts.server";
import { formatINR } from "~/lib/pricing";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!can(viewer, "orders")) throw new Response("Not allowed", { status: 403 });
  const sp = new URL(request.url).searchParams;
  const status = ["open", "completed", "cancelled"].includes(sp.get("status") ?? "") ? sp.get("status")! : "all";
  const [rows, counts] = await Promise.all([listDrafts(store.id, { status, q: sp.get("q") ?? "" }), draftCounts(store.id)]);
  return json({
    counts,
    drafts: rows.map((d) => ({ id: d.id, name: draftName(d.number), status: d.status, customer: [d.customer.firstName, d.customer.lastName].filter(Boolean).join(" ") || d.customer.phone || "No customer", total: draftTotals(d).total, items: draftTotals(d).items, at: d.createdAt.toISOString(), orderId: d.orderId })),
  });
}

const PILL: Record<string, [string, string]> = {
  open: ["Open", "bg-[#fff1e3] text-[#5e4200]"], link_sent: ["Link sent", "bg-[#e0f0ff] text-[#00527c]"],
  completed: ["Completed", "bg-[#cdfee1] text-[#0c5132]"], cancelled: ["Cancelled", "bg-paper-sunk text-ink-soft"],
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Drafts() {
  const { counts, drafts } = useLoaderData<typeof loader>();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const status = sp.get("status") ?? "all";
  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) { const n = new URLSearchParams(sp); if (q) n.set("q", q); else n.delete("q"); setSp(n, { replace: true }); } }, 300);
    return () => clearTimeout(t);
  }, [q, sp, setSp]);

  return (
    <div className="space-y-4">
      <div className="flex min-h-[32px] items-center gap-2">
        <Icon name="design" className="h-4 w-4" strokeWidth={1.9} />
        <h1 className="flex-1 text-[15px] font-semibold">Drafts</h1>
        <LearnMore topic="drafts" />
        <Link to="new" className="btn-primary">Create order</Link>
      </div>

      {counts.all === 0 ? (
        <section className="panel flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-paper-sunk"><Icon name="inbox" className="h-9 w-9 text-ink-soft" strokeWidth={1.4} /></span>
          <h2 className="mt-5 text-[15px] font-semibold">Manual orders will show here</h2>
          <p className="mt-1 max-w-md text-[13px] text-ink-soft">Got an order on phone, WhatsApp or Instagram? Create it here, then send the customer a checkout link or mark it as COD or paid.</p>
          <Link to="new" className="btn-primary mt-5">Create order</Link>
        </section>
      ) : (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-rule px-2 py-1.5">
            {[["all", "All", counts.all], ["open", "Open", counts.open], ["completed", "Completed", counts.completed], ["cancelled", "Cancelled", counts.cancelled]].map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => { const x = new URLSearchParams(sp); if (k === "all") x.delete("status"); else x.set("status", String(k)); setSp(x, { replace: true }); }}
                className={`h-7 rounded-lg px-2.5 text-[12.5px] font-medium ${status === k ? "bg-paper-sunk text-ink" : "text-ink-soft hover:bg-paper"}`}>{label} <span className="text-ink-faint">{n}</span></button>
            ))}
            <label className="ml-auto flex h-8 min-w-[240px] items-center gap-2 rounded-lg px-2 text-ink-faint shadow-[inset_0_0_0_1px_rgb(var(--rule))] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
              <Icon name="search" className="h-4 w-4" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by draft, name or phone" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none" aria-label="Search drafts" />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead><tr><th>Draft</th><th>Date</th><th>Customer</th><th>Status</th><th className="text-right">Items</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td><Link to={String(d.id)} className="font-semibold hover:underline">{d.name}</Link></td>
                    <td className="text-ink-soft">{when(d.at)}</td>
                    <td>{d.customer}</td>
                    <td><span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${PILL[d.status][1]}`}>{PILL[d.status][0]}</span></td>
                    <td className="num text-right text-ink-soft">{d.items}</td>
                    <td className="num text-right font-medium">{formatINR(d.total)}</td>
                  </tr>
                ))}
                {drafts.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-ink-faint">No drafts match.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

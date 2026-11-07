// One monthly bill with its full breakdown: orders and net sales, the % transaction fee, plan, WhatsApp and OTP.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { invoiceSummary } from "~/lib/billing-breakdown.server";
import { storePath } from "~/lib/store-code";
import { invoiceFor } from "~/lib/subscription-billing.server";
import { rupees } from "~/lib/wallet";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const inv = await invoiceFor(store.id, Number(params.invoiceId));
  if (!inv) throw new Response("Bill not found", { status: 404 });
  const s = await invoiceSummary(inv);
  return json({
    storeId: store.id,
    bill: {
      id: inv.id, no: inv.invoiceNo, status: inv.status, periodStart: inv.periodStart.toISOString(), periodEnd: inv.periodEnd.toISOString(),
      createdAt: inv.createdAt.toISOString(), dueAt: inv.dueAt.toISOString(), paidAt: inv.paidAt?.toISOString() ?? null,
      subtotal: inv.subtotalPaise, gst: inv.gstPaise, credit: inv.creditPaise + inv.creditGstPaise, total: inv.totalPaise, due: inv.duePaise,
      igst: inv.billing?.taxType !== "cgst_sgst",
    },
    s,
  });
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const n = (v: number) => v.toLocaleString("en-IN");

export default function BillPage() {
  const { storeId, bill: b, s } = useLoaderData<typeof loader>();
  const late = b.status === "open" && new Date(b.dueAt).getTime() < Date.now();
  const fee = s.feePaise - s.feeReversedPaise;
  return (
    <div className="mx-auto max-w-[860px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={storePath(storeId, "wallet")} className="btn-quiet !px-2" aria-label="Back to billing"><Icon name="chevron" className="h-4 w-4 rotate-90" /></Link>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Bill {b.no}</h1>
        <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${b.status === "paid" ? "bg-[#cdfee1] text-[#0c5132]" : late ? "bg-[#fee9e8] text-[#8e1f0b]" : "bg-[#fff1e3] text-[#5e4200]"}`}>{b.status === "paid" ? "Paid" : late ? "Overdue" : "Unpaid"}</span>
        <a href={storePath(storeId, `billing/invoice/${b.id}`)} className="btn-secondary"><Icon name="download" className="h-4 w-4" />Download PDF</a>
        {b.status !== "paid" && <Link to={storePath(storeId, `billing/pay/${b.id}`)} className="btn-primary">Pay {rupees(b.due)}</Link>}
      </div>

      <section className="panel p-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <Meta k="Billing period" v={`${day(b.periodStart)} – ${day(b.periodEnd)}`} wide />
          <Meta k="Bill date" v={day(b.createdAt)} />
          <Meta k={b.status === "paid" ? "Paid on" : "Pay by"} v={day(b.paidAt ?? b.dueAt)} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-rule pt-5 sm:grid-cols-4">
          <Stat k="Orders" v={n(s.orders)} />
          <Stat k="Net sales" v={rupees(s.netSalesPaise)} />
          <Stat k={`Transaction fee (${(s.feeBps / 100).toString()}%)`} v={rupees(fee)} />
          <Stat k="Amount" v={rupees(b.total)} strong />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <h2 className="px-5 pb-2 pt-4 text-[14px] font-semibold">Breakdown</h2>
        <div className="divide-y divide-rule border-t border-rule text-[13px]">
          <Group title={`${s.planName} plan`} note="Monthly subscription" amount={s.planPaise} />
          <Group title="Transaction fees" note={`${(s.feeBps / 100).toString()}% of ${rupees(s.netSalesPaise)} net sales from ${n(s.orders)} order${s.orders === 1 ? "" : "s"}`} amount={s.feePaise}>
            {s.feeReversedPaise > 0 && <Sub label={`Returned for ${n(s.refundedOrders)} refunded order${s.refundedOrders === 1 ? "" : "s"}`} amount={-s.feeReversedPaise} />}
          </Group>
          <Group title="WhatsApp messages" note={`${n(s.whatsapp.count)} message${s.whatsapp.count === 1 ? "" : "s"} sent`} amount={s.whatsapp.paise}>
            {s.whatsapp.parts.map((p) => <Sub key={p.label} label={`${p.label} · ${n(p.count)}`} amount={p.paise} />)}
          </Group>
          <Group title="OTP messages" note={`${n(s.otp.count)} code${s.otp.count === 1 ? "" : "s"} sent`} amount={s.otp.paise} />
          {s.other.map((o) => <Group key={o.label} title={o.label} amount={o.paise} />)}
          {s.previousDuePaise > 0 && <Group title="Previous wallet balance due" amount={s.previousDuePaise} />}
        </div>
        <dl className="num space-y-1.5 border-t border-rule bg-[#fafafa] px-5 py-4 text-[13px]">
          <Line k="Subtotal" v={b.subtotal} />
          {b.igst ? <Line k="IGST @ 18%" v={b.gst} /> : <><Line k="CGST @ 9%" v={Math.round(b.gst / 2)} /><Line k="SGST @ 9%" v={b.gst - Math.round(b.gst / 2)} /></>}
          {b.credit > 0 && <Line k="Credit applied" v={-b.credit} />}
          <div className="flex justify-between border-t border-rule pt-2 text-[15px] font-semibold"><dt>Total</dt><dd>{rupees(b.total)}</dd></div>
          {b.status !== "paid" && <div className="flex justify-between font-semibold text-[#8e1f0b]"><dt>To pay by {day(b.dueAt)}</dt><dd>{rupees(b.due)}</dd></div>}
        </dl>
      </section>
    </div>
  );
}

function Meta({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><p className="text-[12px] text-ink-soft">{k}</p><p className="mt-0.5 text-[13.5px] font-medium">{v}</p></div>;
}
function Stat({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="rounded-[10px] px-3 py-2.5 shadow-[0_0_0_1px_rgba(0,0,0,.08)]"><p className="text-[12px] text-ink-soft">{k}</p><p className={`num mt-0.5 font-semibold ${strong ? "text-[18px]" : "text-[16px]"}`}>{v}</p></div>;
}
function Group({ title, note, amount, children }: { title: string; note?: string; amount: number; children?: React.ReactNode }) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div><p className="font-medium">{title}</p>{note && <p className="text-[12px] text-ink-soft">{note}</p>}</div>
        <p className="num shrink-0 font-medium">{rupees(amount)}</p>
      </div>
      {children && <div className="mt-2 space-y-1 border-l-2 border-rule pl-3">{children}</div>}
    </div>
  );
}
const Sub = ({ label, amount }: { label: string; amount: number }) => <div className="flex justify-between gap-4 text-[12.5px] text-ink-soft"><span>{label}</span><span className="num">{rupees(amount)}</span></div>;
const Line = ({ k, v }: { k: string; v: number }) => <div className="flex justify-between"><dt className="text-ink-soft">{k}</dt><dd>{rupees(v)}</dd></div>;

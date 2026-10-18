import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { db, stores, walletRecharges, wallets } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { rupees } from "~/lib/wallet";
import { getPlatform } from "~/lib/wallet.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: data ? `Invoice ${data.inv.no}` : "Invoice" }, { name: "robots", content: "noindex" }];

/** GST tax invoice for a paid wallet recharge. Print or save as PDF from the browser. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const [row] = await db.select({ r: walletRecharges, w: wallets, storeName: stores.name })
    .from(walletRecharges).innerJoin(wallets, eq(walletRecharges.walletId, wallets.id)).innerJoin(stores, eq(wallets.storeId, stores.id))
    .where(eq(walletRecharges.id, Number(params.id))).limit(1);
  if (!row || row.r.status !== "paid" || !row.r.invoiceNo) throw new Response("Invoice not found", { status: 404 });
  await requireStore(viewer, row.w.storeId);
  const p = await getPlatform();
  const b = row.r.billing ?? {};
  const intra = b.taxType === "cgst_sgst";
  return json({
    seller: { ...p.billing },
    buyer: { name: b.name || row.storeName, gstin: b.gstin, address: b.address, state: b.state, email: b.email, phone: b.phone },
    inv: {
      no: row.r.invoiceNo, date: (row.r.paidAt ?? row.r.createdAt).toISOString(), txnid: row.r.txnid, mihpayid: row.r.mihpayid,
      credit: row.r.creditPaise, gst: row.r.gstPaise, total: row.r.totalPaise, intra, store: row.storeName,
    },
  });
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`; }
function three(n: number) { return `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " : ""}` : ""}${n % 100 ? two(n % 100) : ""}`; }
/** Indian-style words: 2360.50 → "Two Thousand Three Hundred Sixty Rupees and Fifty Paise Only" */
function inWords(paise: number) {
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  const cr = Math.floor(r / 1_00_00_000); r %= 1_00_00_000;
  const lakh = Math.floor(r / 1_00_000); r %= 1_00_000;
  const th = Math.floor(r / 1000); r %= 1000;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (r) parts.push(three(r));
  return `${parts.join(" ") || "Zero"} Rupees${p ? ` and ${two(p)} Paise` : ""} Only`;
}

export default function Invoice() {
  const { seller, buyer, inv } = useLoaderData<typeof loader>();
  const half = Math.round(inv.gst / 2);
  const date = new Date(inv.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  return (
    <main className="min-h-screen bg-paper px-4 py-8 print:bg-white print:p-0">
      <style>{"@media print { .no-print { display: none !important } @page { margin: 14mm } }"}</style>
      <div className="no-print mx-auto mb-4 flex max-w-3xl justify-end gap-2">
        <button type="button" onClick={() => window.print()} className="btn-primary">Download / Print</button>
      </div>
      <article className="mx-auto max-w-3xl rounded-xl border border-rule bg-white p-8 text-[13px] leading-relaxed text-[#1C2430] shadow-lift print:rounded-none print:border-0 print:shadow-none sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#E2E5E0] pb-6">
          <div>
            <p className="text-lg font-semibold">{seller.name || "Multi Checkout"}</p>
            {seller.address && <p className="max-w-xs text-[#475467]">{seller.address}</p>}
            {seller.state && <p className="text-[#475467]">State: {seller.state}</p>}
            {seller.gstin && <p className="font-medium">GSTIN: {seller.gstin}</p>}
            {(seller.email || seller.phone) && <p className="text-[#475467]">{[seller.email, seller.phone].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight">Tax Invoice</p>
            <p className="mt-1"><span className="text-[#7A8494]">Invoice no.</span> <b>{inv.no}</b></p>
            <p><span className="text-[#7A8494]">Date</span> {date}</p>
            <p className="text-[#7A8494]">Txn {inv.txnid}{inv.mihpayid ? ` · PayU ${inv.mihpayid}` : ""}</p>
          </div>
        </header>

        <section className="grid gap-6 py-6 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8494]">Billed to</p>
            <p className="mt-1 font-semibold">{buyer.name}</p>
            {buyer.address && <p className="text-[#475467]">{buyer.address}</p>}
            {buyer.state && <p className="text-[#475467]">State: {buyer.state}</p>}
            {buyer.gstin && <p className="font-medium">GSTIN: {buyer.gstin}</p>}
            {(buyer.email || buyer.phone) && <p className="text-[#475467]">{[buyer.email, buyer.phone].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7A8494]">Place of supply</p>
            <p className="mt-1">{buyer.state || seller.state || "—"}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-[#7A8494]">Store</p>
            <p>{inv.store}</p>
          </div>
        </section>

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-[#E2E5E0] bg-[#F4F5F2] text-[11px] uppercase tracking-wider text-[#475467]">
              <th className="px-3 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 font-semibold">SAC</th>
              <th className="px-3 py-2 text-right font-semibold">Taxable value</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#E2E5E0]">
              <td className="px-3 py-3">
                <p className="font-medium">Prepaid wallet credit for Multi Checkout services</p>
                <p className="text-[#7A8494]">Checkout platform fees, OTP and WhatsApp messaging</p>
              </td>
              <td className="px-3 py-3">{seller.sac || "998314"}</td>
              <td className="num px-3 py-3 text-right">{rupees(inv.credit)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="num w-full max-w-xs space-y-1.5">
            <div className="flex justify-between"><dt className="text-[#475467]">Taxable value</dt><dd>{rupees(inv.credit)}</dd></div>
            {inv.intra ? (
              <>
                <div className="flex justify-between"><dt className="text-[#475467]">CGST @ 9%</dt><dd>{rupees(half)}</dd></div>
                <div className="flex justify-between"><dt className="text-[#475467]">SGST @ 9%</dt><dd>{rupees(inv.gst - half)}</dd></div>
              </>
            ) : (
              <div className="flex justify-between"><dt className="text-[#475467]">IGST @ 18%</dt><dd>{rupees(inv.gst)}</dd></div>
            )}
            <div className="flex justify-between border-t border-[#1C2430] pt-2 text-base font-semibold"><dt>Total paid</dt><dd>{rupees(inv.total)}</dd></div>
          </dl>
        </div>
        <p className="mt-3 text-right text-[#475467]"><span className="text-[#7A8494]">In words:</span> {inWords(inv.total)}</p>

        <footer className="mt-10 space-y-1 border-t border-[#E2E5E0] pt-4 text-[11.5px] text-[#7A8494]">
          <p>Paid online via PayU. Wallet credit of {rupees(inv.credit)} has been added to the store's Multi Checkout wallet.</p>
          <p>Wallet balance is non-refundable and non-transferable and can be used only for Multi Checkout services.</p>
          <p>This is a computer-generated invoice and does not need a signature.</p>
        </footer>
      </article>
    </main>
  );
}

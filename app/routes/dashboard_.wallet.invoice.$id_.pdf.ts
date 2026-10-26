// Download a wallet recharge's GST tax invoice as a PDF.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, stores, walletRecharges, wallets } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { invoicePdf } from "~/lib/invoice-pdf.server";
import { getPlatform } from "~/lib/wallet.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const [row] = await db.select({ r: walletRecharges, w: wallets, storeName: stores.name })
    .from(walletRecharges).innerJoin(wallets, eq(walletRecharges.walletId, wallets.id)).innerJoin(stores, eq(wallets.storeId, stores.id))
    .where(eq(walletRecharges.id, Number(params.id))).limit(1);
  if (!row || row.r.status !== "paid" || !row.r.invoiceNo) throw new Response("Invoice not found", { status: 404 });
  await requireStore(viewer, row.w.storeId);
  const p = await getPlatform();
  const b = row.r.billing ?? {};
  const pdf = await invoicePdf({
    no: row.r.invoiceNo, date: row.r.paidAt ?? row.r.createdAt, txnid: row.r.txnid, mihpayid: row.r.mihpayid,
    source: row.r.source, note: row.r.note,
    seller: { ...p.billing, name: p.billing?.name || "Growpefy" },
    buyer: { name: b.name || row.storeName, gstin: b.gstin, address: b.address, state: b.state, email: b.email, phone: b.phone },
    store: row.storeName, credit: row.r.creditPaise, gst: row.r.gstPaise, total: row.r.totalPaise, intra: b.taxType === "cgst_sgst",
  });
  const file = `Growpefy-Invoice-${row.r.invoiceNo.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

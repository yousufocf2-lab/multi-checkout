import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { invoiceFor } from "~/lib/subscription-billing.server";
import { monthlyInvoicePdf } from "~/lib/invoice-pdf.server";
import { invoiceSummary } from "~/lib/billing-breakdown.server";
import { getPlatform } from "~/lib/wallet.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const invoice = await invoiceFor(store.id, Number(params.invoiceId));
  if (!invoice) throw new Response("Invoice not found", { status: 404 });
  const platform = await getPlatform();
  const pdf = await monthlyInvoicePdf({
    no: invoice.invoiceNo, date: invoice.createdAt, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd,
    dueAt: invoice.dueAt, paidAt: invoice.paidAt, seller: { ...platform.billing, name: platform.billing?.name || "Growpefy" },
    buyer: invoice.billing ?? {}, store: store.name, lines: invoice.lines, subtotalPaise: invoice.subtotalPaise,
    gstPaise: invoice.gstPaise, creditPaise: invoice.creditPaise, creditGstPaise: invoice.creditGstPaise,
    totalPaise: invoice.totalPaise, duePaise: invoice.duePaise, taxType: invoice.billing?.taxType === "cgst_sgst" ? "cgst_sgst" : "igst",
    summary: await invoiceSummary(invoice),
  });
  const name = `Growpefy-Invoice-${invoice.invoiceNo.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}

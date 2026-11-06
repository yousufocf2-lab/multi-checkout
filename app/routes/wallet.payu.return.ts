import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, walletRecharges, wallets } from "~/db.server";
import { checkReturnHash, confirmRecharge } from "~/lib/wallet.server";
import { storePath } from "~/lib/store-code";
import { confirmBillingInvoice } from "~/lib/subscription-billing.server";
import { billingInvoices } from "~/db.server";

/**
 * PayU posts here after a wallet recharge (surl / furl). The posted status is never trusted:
 * the payment is re-checked with PayU server to server before any money is credited.
 */
export async function action({ request }: ActionFunctionArgs) {
  const f = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const txnid = f.txnid ?? "";
  if (!(await checkReturnHash(f))) console.warn(`[wallet] return hash mismatch for ${txnid}`);
  if (txnid.startsWith("BI")) {
    let status = "pending";
    try { status = (await confirmBillingInvoice(txnid)).status; }
    catch (e) { console.error("[billing] confirm on return:", e instanceof Error ? e.message : e); }
    const [invoice] = await db.select({ storeId: billingInvoices.storeId }).from(billingInvoices).where(eq(billingInvoices.paymentTxnid, txnid)).limit(1);
    if (!invoice) return redirect("/dashboard");
    const tag = status === "paid" ? "success" : status === "failed" ? "failed" : status === "mismatch" ? "mismatch" : "pending";
    return redirect(`${storePath(invoice.storeId)}/wallet?invoice=${tag}`);
  }
  let status = "pending";
  try {
    status = (await confirmRecharge(txnid)).status;
  } catch (e) {
    console.error("[wallet] confirm on return:", e instanceof Error ? e.message : e);
  }
  const [row] = await db.select({ storeId: wallets.storeId }).from(walletRecharges).innerJoin(wallets, eq(walletRecharges.walletId, wallets.id)).where(eq(walletRecharges.txnid, txnid)).limit(1);
  if (!row) return redirect("/dashboard");
  const tag = status === "paid" ? "success" : status === "failed" ? "failed" : "pending";
  return redirect(`${storePath(row.storeId)}/wallet?recharge=${tag}`);
}

export const loader = (_: LoaderFunctionArgs) => redirect("/dashboard");

import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, orders } from "~/db.server";
import { finalizeOrder, getOrderWithStore } from "~/lib/orders.server";
import { verifyPayuResponse } from "~/lib/payu.server";
import { rupeesToPaise } from "~/lib/pricing";

export const loader = () => redirect("/");

/** PayU posts here for both success (surl) and failure (furl). */
export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const f: Record<string, string> = {};
  fd.forEach((v, k) => { if (typeof v === "string") f[k] = v; });

  const row = f.txnid ? await getOrderWithStore(f.txnid) : null;
  if (!row) return redirect("/");
  const { order, store } = row;

  // Already handled (PayU can post twice / user refresh)
  if (order.status !== "pending_payment") return redirect(`/order/${order.id}`);

  const hashOk = verifyPayuResponse(store, f);
  const amount = rupeesToPaise(f.amount);
  const amountOk = amount === order.total;
  const success = hashOk && amountOk && f.status === "success" && f.key === store.payuKey;

  if (!success) {
    await db
      .update(orders)
      .set({
        status: "failed",
        payuRaw: f,
        payuMihpayid: f.mihpayid ?? null,
        error: !hashOk ? "PayU hash mismatch" : !amountOk ? "Amount mismatch" : f.error_Message || f.field9 || f.status,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));
    return redirect(`/order/${order.id}`);
  }

  // Bank offer: PayU debits less than `amount` when an offer_key was availed
  const debited = rupeesToPaise(f.net_amount_debit) ?? order.total;
  const bankDiscount = Math.max(0, order.total - debited);

  await finalizeOrder(store, order, {
    status: "paid",
    payuRaw: f,
    payuMihpayid: f.mihpayid ?? null,
    amountPaid: debited,
    bankDiscount,
  });
  return redirect(`/order/${order.id}`);
}

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { eq, or } from "drizzle-orm";
import { db, orders, stores } from "~/db.server";
import { logPaymentEvent, syncRefunds } from "~/lib/orders.server";
import { syncOrderPayment } from "~/lib/gateways/index.server";

export const loader = () => json({ ok: true, hint: "PayU webhooks POST here" });

/**
 * PayU webhook for payment success, failure and refunds.
 * Payloads are never trusted on their own: every event is re-checked with PayU's
 * verify / refund APIs before an order changes.
 */
export async function action({ request }: ActionFunctionArgs) {
  let body: Record<string, unknown> = {};
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) body = (await request.json()) as Record<string, unknown>;
    else (await request.formData()).forEach((v, k) => { if (typeof v === "string") body[k] = v; });
  } catch {
    return json({ ok: false, error: "unreadable body" }, { status: 400 });
  }

  const pick = (...keys: string[]) => keys.map((k) => body[k]).find((v) => typeof v === "string" && v) as string | undefined;
  const txnid = pick("txnid", "merchantTransactionId", "merchant_txn_id", "udf2");
  const mihpayid = pick("mihpayid", "payuId", "payu_id");
  const text = JSON.stringify(body).toLowerCase();
  const isRefund = /refund/.test(text) || Boolean(pick("request_id", "refund_mode", "action"));

  const where = txnid && mihpayid ? or(eq(orders.id, txnid), eq(orders.payuMihpayid, mihpayid)) : txnid ? eq(orders.id, txnid) : mihpayid ? eq(orders.payuMihpayid, mihpayid) : null;
  const [row] = where ? await db.select({ order: orders, store: stores }).from(orders).innerJoin(stores, eq(orders.storeId, stores.id)).where(where).limit(1) : [];

  await logPaymentEvent({ storeId: row?.store.id ?? null, orderId: row?.order.id ?? txnid ?? null, source: "webhook", kind: isRefund ? "refund" : "payment", status: pick("status") ?? null, payload: body });
  if (!row) return json({ ok: true, matched: false });

  try {
    if (isRefund && row.order.status === "paid") await syncRefunds(row.store, row.order, "webhook");
    else await syncOrderPayment(row.store, row.order, "webhook");
  } catch (e) {
    console.error("[payu webhook]", e instanceof Error ? e.message : e);
  }
  // Always 200 so PayU doesn't keep retrying an event we've logged
  return json({ ok: true, matched: true });
}

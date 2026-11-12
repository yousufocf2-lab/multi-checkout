// What a monthly bill is made of: orders and net sales in the period, the transaction fee on them,
// the plan, and WhatsApp / OTP usage with counts. Also the estimate for the bill that's coming.
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { billingAccounts, billingInvoices, billingUsage, db, orders, type BillingInvoice, type BillSummary } from "~/db.server";

export type { BillSummary };
import { orderValuePaise } from "./payment-methods";
import { planById } from "./plans";
import { WALLET_GST } from "./wallet";

type UsageRow = { type: string; amountPaise: number; refType: string; refId: string };


const WA: Record<string, string> = {
  wa_confirm: "Order confirmations", wa_tracking: "Delivery updates", wa_promo: "Promotional messages",
  wa_reply: "Inbox replies", wa_followup: "Inbox follow-ups", wa_recovery: "Abandoned checkout reminders",
};
const USAGE_LABEL: Record<string, string> = { theme_purchase: "Premium perfume theme · Scentelier" };

export async function summarize(storeId: number, planId: string, usage: UsageRow[], previousDuePaise = 0): Promise<BillSummary> {
  const plan = planById(planId);
  const s: BillSummary = {
    planName: plan?.name ?? planId, planPaise: (plan?.monthlyRupees ?? 0) * 100,
    orders: 0, netSalesPaise: 0, feeBps: plan?.feeBps ?? 0, feePaise: 0, refundedOrders: 0, feeReversedPaise: 0,
    whatsapp: { count: 0, paise: 0, parts: [] }, otp: { count: 0, paise: 0 }, other: [], previousDuePaise,
  };
  const saleIds: string[] = [], refundIds: string[] = [];
  const wa = new Map<string, { count: number; paise: number }>();
  const other = new Map<string, number>();
  for (const u of usage) {
    if (u.type === "sale_fee") { s.orders++; s.feePaise += u.amountPaise; if (u.refType === "order") saleIds.push(u.refId); }
    else if (u.type === "sale_fee_reversal") { s.refundedOrders++; s.feeReversedPaise += -u.amountPaise; if (u.refType === "order") refundIds.push(u.refId); }
    else if (u.type === "otp") { s.otp.count++; s.otp.paise += u.amountPaise; }
    else if (u.type.startsWith("wa_")) { const x = wa.get(u.type) ?? { count: 0, paise: 0 }; x.count++; x.paise += u.amountPaise; wa.set(u.type, x); }
    else other.set(u.type, (other.get(u.type) ?? 0) + u.amountPaise);
  }
  // Net sales: value of the orders the fee was charged on, less the ones fully refunded
  const value = async (ids: string[]) => {
    let total = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await db.select().from(orders).where(and(eq(orders.storeId, storeId), inArray(orders.id, ids.slice(i, i + 500))));
      total += rows.reduce((n, o) => n + orderValuePaise(o), 0);
    }
    return total;
  };
  s.netSalesPaise = (await value(saleIds)) - (await value(refundIds));
  for (const [type, x] of wa) { s.whatsapp.parts.push({ label: WA[type] ?? type.replace(/^wa_/, "").replaceAll("_", " "), ...x }); s.whatsapp.count += x.count; s.whatsapp.paise += x.paise; }
  s.whatsapp.parts.sort((a, b) => b.paise - a.paise);
  for (const [type, paise] of other) if (paise) s.other.push({ label: USAGE_LABEL[type] ?? type.replaceAll("_", " "), paise });
  return s;
}

/** Invoice lines that say what each charge is for (counts and the % fee on net sales). */
export function linesFrom(s: BillSummary) {
  const inr = (p: number) => `Rs. ${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; // PDF fonts have no ₹ sign
  const lines = [{ label: `${s.planName} plan · monthly subscription`, amountPaise: s.planPaise }];
  if (s.feePaise) lines.push({ label: `Transaction fee ${(s.feeBps / 100).toString()}% · ${s.orders} order${s.orders === 1 ? "" : "s"}, net sales ${inr(s.netSalesPaise)}`, amountPaise: s.feePaise });
  if (s.feeReversedPaise) lines.push({ label: `Transaction fee returned · ${s.refundedOrders} refunded order${s.refundedOrders === 1 ? "" : "s"}`, amountPaise: -s.feeReversedPaise });
  if (s.whatsapp.paise) lines.push({ label: `WhatsApp messages · ${s.whatsapp.count.toLocaleString("en-IN")} sent`, amountPaise: s.whatsapp.paise });
  if (s.otp.paise) lines.push({ label: `OTP messages · ${s.otp.count.toLocaleString("en-IN")} sent`, amountPaise: s.otp.paise });
  for (const o of s.other) lines.push({ label: o.label, amountPaise: o.paise });
  if (s.previousDuePaise) lines.push({ label: "Previous wallet balance due", amountPaise: s.previousDuePaise });
  return lines;
}

/** Breakdown for a bill: saved on new bills, worked out from its usage for older ones. */
export async function invoiceSummary(inv: BillingInvoice): Promise<BillSummary> {
  if (inv.summary) return inv.summary;
  const usage = await db.select({ type: billingUsage.type, amountPaise: billingUsage.amountPaise, refType: billingUsage.refType, refId: billingUsage.refId })
    .from(billingUsage).where(eq(billingUsage.invoiceId, inv.id));
  const prev = inv.lines.find((l) => /previous wallet/i.test(l.label))?.amountPaise ?? 0;
  const s = await summarize(inv.storeId, inv.planId, usage, prev);
  await db.update(billingInvoices).set({ summary: s }).where(eq(billingInvoices.id, inv.id)).catch(() => {});
  return s;
}

/** The bill that's coming: plan + everything used so far this period, with GST, less any credit. */
export async function upcomingBill(storeId: number) {
  const [acc] = await db.select().from(billingAccounts).where(eq(billingAccounts.storeId, storeId)).limit(1);
  if (!acc || acc.status === "cancelled") return null;
  const plan = planById(acc.planId);
  const [prev] = await db.select({ end: billingInvoices.periodEnd }).from(billingInvoices).where(eq(billingInvoices.storeId, storeId)).orderBy(sql`${billingInvoices.periodEnd} desc`).limit(1);
  const periodStart = prev?.end ?? acc.startedAt;
  const billDate = acc.nextInvoiceAt;
  const [u] = await db.select({ sum: sql<string>`coalesce(sum(${billingUsage.amountPaise}), 0)` }).from(billingUsage)
    .where(and(eq(billingUsage.storeId, storeId), isNull(billingUsage.invoiceId), gte(billingUsage.createdAt, periodStart), lt(billingUsage.createdAt, billDate)));
  const subtotal = Math.max(0, (plan?.monthlyRupees ?? 0) * 100 + Number(u?.sum ?? 0) + acc.legacyDebtPaise);
  const gst = Math.round(subtotal * WALLET_GST);
  const credit = Math.min(acc.creditPaise, subtotal) + Math.min(acc.creditGstPaise, gst);
  return {
    amountPaise: Math.max(0, subtotal + gst - credit),
    periodStart: periodStart.toISOString(), billDate: billDate.toISOString(),
    payBy: new Date(billDate.getTime() + 7 * 86_400_000).toISOString(),
    planName: plan?.name ?? acc.planId, hasCredit: credit > 0,
  };
}

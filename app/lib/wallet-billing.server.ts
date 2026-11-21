// Everything a store pays Growpefy now comes out of its wallet (no separate bills):
//   - order fee (% of each order, by plan) and OTP / WhatsApp messages: charged as they happen (wallet.server.ts)
//   - monthly plan fee: charged on the plan's monthly date
//   - hosting (Railway usage bills): charged when the bill is published, adjusted if it's changed
// One-time move from the old monthly bills: unpaid bills, not-yet-billed usage, carried credit and old dues all
// become wallet entries, so nothing owed (or owed back) is lost. Every entry has a unique reference: running it again
// charges nothing twice.
import { and, eq, isNull, like, lte, ne, sql } from "drizzle-orm";
import { billingAccounts, billingInvoices, billingUsage, db, usageBills, walletTransactions } from "~/db.server";
import { addBillingMonths } from "./subscription-billing.server";
import { planById } from "./plans";
import { usageTotals } from "./usage-bill";
import type { TxType } from "./wallet";
import { getWallet, postTransaction } from "./wallet.server";

const ist = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

/** Charges each elapsed month of the plan fee from the wallet. */
export async function chargePlanFees(now = new Date()) {
  const accounts = await db.select().from(billingAccounts).where(and(ne(billingAccounts.status, "cancelled"), lte(billingAccounts.nextInvoiceAt, now)));
  for (const a of accounts) {
    const plan = planById(a.planId);
    if (!plan) continue;
    const w = await getWallet(a.storeId);
    let next = a.nextInvoiceAt, guard = 0;
    while (next <= now && guard++ < 18) {
      const months = (next.getUTCFullYear() - a.startedAt.getUTCFullYear()) * 12 + next.getUTCMonth() - a.startedAt.getUTCMonth();
      const start = addBillingMonths(a.startedAt, months - 1);
      await postTransaction({
        walletId: w.id, type: "plan_fee", amountPaise: -plan.monthlyRupees * 100, refType: "plan", refId: `${a.storeId}:${start.toISOString().slice(0, 10)}`,
        note: `${plan.name} plan · ${ist(start)} – ${ist(next)}`, createdBy: "Growpefy",
      });
      next = addBillingMonths(a.startedAt, months + 1);
    }
    await db.update(billingAccounts).set({ nextInvoiceAt: next, status: "active", updatedAt: now }).where(eq(billingAccounts.storeId, a.storeId));
  }
}

const USAGE_TX: Record<string, TxType> = {
  sale_fee: "sale_fee", sale_fee_reversal: "refund_reversal", otp: "otp", wa_confirm: "wa_confirm", wa_tracking: "wa_tracking",
  wa_promo: "wa_promo", wa_reply: "wa_reply", wa_followup: "wa_followup", wa_recovery: "wa_recovery",
};

/** One-time (safe to repeat): old monthly-billing balances into the wallet. */
export async function moveBillingToWallet() {
  const accounts = await db.select().from(billingAccounts);
  let entries = 0;
  for (const a of accounts) {
    const w = await getWallet(a.storeId);
    // 1. Usage recorded for the next bill that was never billed
    const usage = await db.select().from(billingUsage).where(and(eq(billingUsage.storeId, a.storeId), isNull(billingUsage.invoiceId)));
    for (const u of usage) {
      if (!u.amountPaise) continue;
      const r = await postTransaction({ walletId: w.id, type: USAGE_TX[u.type] ?? (u.amountPaise > 0 ? "manual_debit" : "manual_credit"), amountPaise: -u.amountPaise, refType: "billing_usage", refId: String(u.id), note: u.note, createdBy: "Growpefy" });
      if (!r.duplicate) entries++;
    }
    // 2. Bills not paid yet come from the wallet. Wallet money already carries GST (paid at recharge), so the bill's
    //    amount before GST is debited, less any credit the bill already used.
    const open = await db.select().from(billingInvoices).where(and(eq(billingInvoices.storeId, a.storeId), eq(billingInvoices.status, "open")));
    for (const inv of open) {
      const due = inv.duePaise > 0 ? Math.max(0, inv.subtotalPaise - inv.creditPaise) : 0;
      if (due > 0) {
        const r = await postTransaction({ walletId: w.id, type: "bill_settled", amountPaise: -due, refType: "billing_invoice", refId: String(inv.id), note: `Bill ${inv.invoiceNo} (${ist(inv.periodStart)} – ${ist(inv.periodEnd)})`, createdBy: "Growpefy" });
        if (!r.duplicate) entries++;
      }
      await db.update(billingInvoices).set({ status: "paid", paidAt: new Date() }).where(eq(billingInvoices.id, inv.id));
    }
    // 3. Wallet money moved into billing and not used yet goes back; old dues carried into billing are charged
    const credit = a.creditPaise;
    if (credit > 0) {
      const r = await postTransaction({ walletId: w.id, type: "manual_credit", amountPaise: credit, refType: "billing_credit", refId: String(a.storeId), note: "Unused balance from monthly billing", createdBy: "Growpefy" });
      if (!r.duplicate) entries++;
    }
    if (a.legacyDebtPaise > 0) {
      const r = await postTransaction({ walletId: w.id, type: "manual_debit", amountPaise: -a.legacyDebtPaise, refType: "billing_debt", refId: String(a.storeId), note: "Earlier wallet dues", createdBy: "Growpefy" });
      if (!r.duplicate) entries++;
    }
    if (credit > 0 || a.legacyDebtPaise > 0) await db.update(billingAccounts).set({ creditPaise: 0, creditGstPaise: 0, legacyDebtPaise: 0, updatedAt: new Date() }).where(eq(billingAccounts.storeId, a.storeId));
    if (a.status === "paused") await db.update(billingAccounts).set({ status: "active", updatedAt: new Date() }).where(eq(billingAccounts.storeId, a.storeId));
  }
  if (entries) console.log(`[wallet-billing] moved ${entries} billing entr${entries === 1 ? "y" : "ies"} into wallets`);
}

/**
 * Hosting bill (Railway usage): once published (Due), its total comes from the wallet and it's marked Paid.
 * If Growpefy changes a published bill, only the difference is charged or given back; a deleted bill is refunded.
 */
export async function settleUsageBill(billId: number, deleted = false) {
  const [b] = await db.select().from(usageBills).where(eq(usageBills.id, billId)).limit(1);
  const storeId = b?.storeId;
  if (!storeId) return;
  const w = await getWallet(storeId);
  const [{ charged }] = await db.select({ charged: sql<number>`coalesce(sum(${walletTransactions.amountPaise}), 0)::bigint` }).from(walletTransactions)
    .where(and(eq(walletTransactions.walletId, w.id), eq(walletTransactions.type, "hosting"), eq(walletTransactions.refType, "usage_bill"), like(walletTransactions.refId, `${billId}:%`)));
  // A bill marked Paid that never went through the wallet was paid outside: nothing to charge
  if (!deleted && b.status === "paid" && Number(charged) === 0) return;
  const target = deleted || b.status === "draft" ? 0 : -usageTotals(b.lines).total;
  const diff = target - Number(charged);
  if (diff !== 0) {
    await postTransaction({
      walletId: w.id, type: "hosting", amountPaise: diff, refType: "usage_bill", refId: `${billId}:${Date.now()}`,
      note: `${Number(charged) === 0 ? "" : diff > 0 ? "Correction (refund) · " : "Correction · "}Hosting ${ist(new Date(b.periodStart))} – ${ist(new Date(b.periodEnd))}`, createdBy: "Growpefy",
    });
  }
  if (!deleted && b.status === "due") await db.update(usageBills).set({ status: "paid", paidAt: new Date() }).where(eq(usageBills.id, billId));
}

/** Published hosting bills not charged yet (e.g. made before the wallet took over). */
export async function settleOpenUsageBills() {
  for (const b of await db.select({ id: usageBills.id }).from(usageBills).where(eq(usageBills.status, "due"))) await settleUsageBill(b.id);
}

let timer: NodeJS.Timeout | null = null;
/** Moves old bills once, then every 10 minutes charges due plan months and published hosting bills. */
export function startWalletBilling() {
  if (timer) return;
  const run = async (first: boolean) => {
    try {
      if (first) await moveBillingToWallet();
      await chargePlanFees();
      await settleOpenUsageBills();
    } catch (e) { console.error("[wallet-billing]", e instanceof Error ? e.message : e); }
  };
  timer = setInterval(() => { void run(false); }, 10 * 60_000);
  timer.unref?.();
  setTimeout(() => { void run(true); }, 4_000).unref?.();
}

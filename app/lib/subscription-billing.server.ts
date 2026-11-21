import crypto from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  billingAccounts, billingInvoices, billingUsage, db, platformSettings, stores, walletRecharges, walletTransactions, wallets,
  type BillingLine, type BillingDetails, type BillingInvoice,
} from "~/db.server";
import { feePct, planById, PLANS, type PlanId } from "./plans";
import { storeBilling } from "./billing.server";
import { linesFrom, summarize } from "./billing-breakdown.server";
import { financialYear, WALLET_GST } from "./wallet";
import { sha512, payuEndpoint, verifyPayment } from "./payu.server";

const GRACE_DAYS = 7;
const dayMs = 86_400_000;
const dueAfter = (d: Date) => new Date(d.getTime() + GRACE_DAYS * dayMs);
const billingPayu = (p: typeof platformSettings.$inferSelect) => ({
  payuKey: p.payuKey || process.env.PLATFORM_PAYU_KEY || null,
  payuSalt: p.payuSalt || process.env.PLATFORM_PAYU_SALT || null,
  payuMode: (p.payuKey ? p.payuMode : process.env.PLATFORM_PAYU_MODE) === "live" ? "live" as const : "test" as const,
});

/** Add calendar months while keeping the original day where it exists (31st clamps to month end). */
export function addBillingMonths(d: Date, months: number) {
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + months, day = d.getUTCDate();
  const targetYear = year + Math.floor(month / 12), targetMonth = ((month % 12) + 12) % 12;
  const endDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, endDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}
export const addBillingMonth = (d: Date) => addBillingMonths(d, 1);

export async function accountFor(storeId: number) {
  return (await db.select().from(billingAccounts).where(eq(billingAccounts.storeId, storeId)).limit(1))[0] ?? null;
}

/** Picks a plan. The plan fee and its % fee are charged from the wallet (wallet-billing.server.ts). */
export async function startSubscription(storeId: number, planId: string) {
  if (!planById(planId)) throw new Error("Choose one of the available Growpefy plans.");
  const now = new Date();
  const existing = await accountFor(storeId);
  if (existing && existing.status !== "cancelled") throw new Error("A plan is already active for this store. Contact Growpefy to change it.");
  if (existing) await db.update(billingAccounts).set({ planId: planId as PlanId, status: "active", startedAt: now, nextInvoiceAt: addBillingMonth(now), updatedAt: now }).where(eq(billingAccounts.storeId, storeId));
  else await db.insert(billingAccounts).values({ storeId, planId: planId as PlanId, startedAt: now, nextInvoiceAt: addBillingMonth(now), status: "active", updatedAt: now });
  return accountFor(storeId);
}

export async function recordBillingUsage(input: {
  storeId: number; type: string; amountPaise: number; refType: string; refId: string; note?: string | null;
}) {
  if (!Number.isFinite(input.amountPaise) || input.amountPaise === 0) return false;
  const [account] = await db.select({ status: billingAccounts.status }).from(billingAccounts)
    .where(eq(billingAccounts.storeId, input.storeId)).limit(1);
  if (!account || account.status === "cancelled") return false;
  await db.insert(billingUsage).values({ ...input, note: input.note ?? null })
    .onConflictDoNothing({ target: [billingUsage.type, billingUsage.refType, billingUsage.refId] });
  return true;
}

async function invoiceNumber() {
  const [p] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  const [seq] = (await db.execute(sql`select nextval('wallet_invoice_seq')::text as n`)) as unknown as { n: string }[];
  const seller = p?.billing ?? {};
  return { no: `${seller.invoicePrefix || "GP"}/${financialYear(new Date())}/${String(seq.n).padStart(5, "0")}`, seller };
}

/** Creates all elapsed anniversary invoices once; account locking makes concurrent calls safe. */
export async function ensureBillingInvoices(storeId: number, now = new Date()) {
  let generated = 0;
  while (generated < 18) {
    const [account] = await db.select().from(billingAccounts).where(eq(billingAccounts.storeId, storeId)).limit(1);
    if (!account || account.status === "cancelled" || account.nextInvoiceAt > now) break;
    const invoice = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(billingAccounts).where(eq(billingAccounts.storeId, storeId)).for("update");
      if (!locked || locked.status === "cancelled" || locked.nextInvoiceAt > now) return null;
      const [previous] = await tx.select({ periodEnd: billingInvoices.periodEnd }).from(billingInvoices)
        .where(eq(billingInvoices.storeId, storeId)).orderBy(sql`${billingInvoices.periodEnd} desc`).limit(1);
      const periodStart = previous?.periodEnd ?? locked.startedAt;
      const periodEnd = locked.nextInvoiceAt;
      if (periodEnd <= periodStart) return null;
      const [exists] = await tx.select({ id: billingInvoices.id }).from(billingInvoices)
        .where(and(eq(billingInvoices.storeId, storeId), eq(billingInvoices.periodStart, periodStart))).limit(1);
      if (exists) {
        const elapsed = (periodEnd.getUTCFullYear() - locked.startedAt.getUTCFullYear()) * 12 + periodEnd.getUTCMonth() - locked.startedAt.getUTCMonth();
        await tx.update(billingAccounts).set({ nextInvoiceAt: addBillingMonths(locked.startedAt, elapsed + 1), updatedAt: now }).where(eq(billingAccounts.storeId, storeId));
        return { advanced: true as const };
      }
      const plan = planById(locked.planId);
      if (!plan) return null;
      const usage = await tx.select().from(billingUsage).where(and(
        eq(billingUsage.storeId, storeId), sql`${billingUsage.invoiceId} is null`,
        gte(billingUsage.createdAt, periodStart), lt(billingUsage.createdAt, periodEnd),
      )).orderBy(asc(billingUsage.createdAt)).for("update");
      // Orders, net sales, the % fee, plan, WhatsApp and OTP counts: kept on the bill and shown line by line
      const summary = await summarize(storeId, locked.planId, usage, Math.max(0, locked.legacyDebtPaise));
      const lines: BillingLine[] = linesFrom(summary);
      const subtotalPaise = Math.max(0, lines.reduce((n, l) => n + l.amountPaise, 0));
      const gstPaise = Math.round(subtotalPaise * WALLET_GST);
      const totalPaise = subtotalPaise + gstPaise;
      const creditPaise = Math.min(locked.creditPaise, subtotalPaise);
      const creditGstPaise = Math.min(locked.creditGstPaise, gstPaise, Math.round(creditPaise * WALLET_GST));
      const duePaise = Math.max(0, totalPaise - creditPaise - creditGstPaise);
      const { no, seller } = await invoiceNumber();
      const buyer = await storeBilling(storeId);
      const sameState = Boolean(seller.state && buyer.details.state && seller.state.trim().toLowerCase() === buyer.details.state.trim().toLowerCase());
      const [created] = await tx.insert(billingInvoices).values({
        storeId, invoiceNo: no, planId: locked.planId, periodStart, periodEnd, lines, summary,
        subtotalPaise, gstPaise, creditPaise, creditGstPaise, totalPaise, duePaise,
        status: duePaise ? "open" : "paid", dueAt: dueAfter(periodEnd),
        billing: { ...buyer.details, taxType: sameState ? "cgst_sgst" : "igst" }, paidAt: duePaise ? null : now,
      }).returning();
      if (usage.length) await tx.update(billingUsage).set({ invoiceId: created.id }).where(sql`${billingUsage.id} in (${sql.join(usage.map((u) => sql`${u.id}`), sql`, `)})`);
      await tx.update(billingAccounts).set({
        nextInvoiceAt: addBillingMonths(locked.startedAt, (periodEnd.getUTCFullYear() - locked.startedAt.getUTCFullYear()) * 12 + periodEnd.getUTCMonth() - locked.startedAt.getUTCMonth() + 1),
        creditPaise: locked.creditPaise - creditPaise,
        creditGstPaise: locked.creditGstPaise - creditGstPaise,
        legacyDebtPaise: 0, updatedAt: now,
      }).where(eq(billingAccounts.storeId, storeId));
      return { invoice: created };
    });
    if (!invoice) break;
    if ("advanced" in invoice) continue;
    generated++;
  }
  return generated;
}

/** Monthly bills are gone (everything is charged from the wallet), so checkout is never blocked by a bill. */
export async function billingBlocked(_storeId: number, _now = new Date()) {
  return false;
}

export async function oldBillingBlocked(storeId: number, now = new Date()) {
  const [row] = await db.select({ status: billingAccounts.status }).from(billingAccounts)
    .where(eq(billingAccounts.storeId, storeId)).limit(1);
  if (!row || row.status === "cancelled") return false;
  await ensureBillingInvoices(storeId, now);
  const [late] = await db.select({ id: billingInvoices.id }).from(billingInvoices).where(and(
    eq(billingInvoices.storeId, storeId), eq(billingInvoices.status, "open"), lt(billingInvoices.dueAt, new Date(now.getTime() - GRACE_DAYS * dayMs)),
  )).limit(1);
  if (late && row.status !== "paused") await db.update(billingAccounts).set({ status: "paused", updatedAt: now }).where(eq(billingAccounts.storeId, storeId));
  if (!late && row.status === "paused") await db.update(billingAccounts).set({ status: "active", updatedAt: now }).where(eq(billingAccounts.storeId, storeId));
  return Boolean(late);
}

export async function invoicesFor(storeId: number) {
  await billingBlocked(storeId);
  return db.select().from(billingInvoices).where(eq(billingInvoices.storeId, storeId)).orderBy(sql`${billingInvoices.periodStart} desc`);
}

export async function invoiceFor(storeId: number, invoiceId: number) {
  return (await db.select().from(billingInvoices).where(and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.storeId, storeId))).limit(1))[0] ?? null;
}

export async function invoicePayuForm(invoiceId: number, store: { id: number; name: string }, payer: { name: string; email: string; phone?: string | null }) {
  const [row] = await db.select().from(billingInvoices).where(and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.storeId, store.id))).limit(1);
  if (!row) throw new Response("Invoice not found", { status: 404 });
  if (row.status === "paid" || row.duePaise <= 0) throw new Response("This invoice is already paid.", { status: 409 });
  const platform = (await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1))[0];
  if (!platform) throw new Error("Growpefy PayU billing is not configured.");
  const creds = billingPayu(platform);
  if (!creds.payuKey || !creds.payuSalt) throw new Error("Growpefy PayU billing is not configured.");
  const txnid = `BI${row.id}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const f: Record<string, string> = {
    key: creds.payuKey, txnid, amount: (row.duePaise / 100).toFixed(2),
    productinfo: `Growpefy invoice ${row.invoiceNo} · ${store.name}`.slice(0, 100),
    firstname: (payer.name || store.name || "Store owner").slice(0, 60),
    email: payer.email.includes("@") ? payer.email : `billing${store.id}@growpefy.com`,
    phone: (payer.phone ?? "").replace(/\D/g, "").slice(-10) || "9999999999",
    surl: `${appUrl}/wallet/payu/return`, furl: `${appUrl}/wallet/payu/return`,
    udf1: "billing_invoice", udf2: String(row.id), udf3: String(store.id), udf4: "", udf5: "",
  };
  f.hash = sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, f.udf1, f.udf2, f.udf3, f.udf4, f.udf5, "", "", "", "", "", creds.payuSalt].join("|"));
  await db.update(billingInvoices).set({ paymentTxnid: txnid }).where(eq(billingInvoices.id, row.id));
  return { action: payuEndpoint(creds), fields: f, duePaise: row.duePaise };
}

export async function confirmBillingInvoice(txnid: string) {
  const [row] = await db.select().from(billingInvoices).where(eq(billingInvoices.paymentTxnid, txnid)).limit(1);
  if (!row) return { status: "not_found" as const };
  if (row.status === "paid") {
    // Paid through PayU after the bill was already settled from the wallet: give that wallet debit back
    if (!row.paymentMihpayid) {
      const { getWallet, postTransaction } = await import("./wallet.server");
      const w = await getWallet(row.storeId);
      const [settled] = await db.select().from(walletTransactions).where(and(eq(walletTransactions.walletId, w.id), eq(walletTransactions.type, "bill_settled"), eq(walletTransactions.refType, "billing_invoice"), eq(walletTransactions.refId, String(row.id)))).limit(1);
      const platform = settled ? (await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1))[0] : null;
      if (settled && platform) {
        const v = await verifyPayment(billingPayu(platform), txnid);
        if (v.status === "success") {
          await postTransaction({ walletId: w.id, type: "manual_credit", amountPaise: -settled.amountPaise, refType: "billing_payment", refId: txnid, note: `Bill ${row.invoiceNo} paid online · wallet debit returned`, createdBy: "Growpefy" });
          await db.update(billingInvoices).set({ paymentMihpayid: v.mihpayid }).where(eq(billingInvoices.id, row.id));
        }
      }
    }
    return { status: "paid" as const, invoice: row };
  }
  const platform = (await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1))[0];
  if (!platform) throw new Error("Growpefy PayU billing is not configured.");
  const v = await verifyPayment(billingPayu(platform), txnid);
  if (v.status === "failure") return { status: "failed" as const, invoice: row };
  if (v.status !== "success") return { status: "pending" as const, invoice: row };
  if (v.amountPaise != null && v.amountPaise !== row.duePaise) {
    console.error(`[billing] invoice ${row.invoiceNo}: PayU amount ${v.amountPaise} != ${row.duePaise}`);
    return { status: "mismatch" as const, invoice: row };
  }
  const [paid] = await db.update(billingInvoices).set({ status: "paid", paymentMihpayid: v.mihpayid, paidAt: new Date() })
    .where(and(eq(billingInvoices.id, row.id), eq(billingInvoices.status, "open"))).returning();
  if (!paid) return { status: "paid" as const, invoice: row };
  const [late] = await db.select({ id: billingInvoices.id }).from(billingInvoices).where(and(
    eq(billingInvoices.storeId, row.storeId), eq(billingInvoices.status, "open"), lt(billingInvoices.dueAt, new Date(Date.now() - GRACE_DAYS * dayMs)),
  )).limit(1);
  if (!late) await db.update(billingAccounts).set({ status: "active", updatedAt: new Date() }).where(eq(billingAccounts.storeId, row.storeId));
  return { status: "paid" as const, invoice: paid };
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Replaced by startWalletBilling (wallet-billing.server.ts). Kept so old imports still work. */
export function startBillingWatcher() {}

export { PLANS };
export type { BillingInvoice };

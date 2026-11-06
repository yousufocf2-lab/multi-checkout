import crypto from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  billingAccounts, billingInvoices, billingUsage, db, platformSettings, stores, walletRecharges, walletTransactions, wallets,
  type BillingLine, type BillingDetails, type BillingInvoice,
} from "~/db.server";
import { feePct, planById, PLANS, type PlanId } from "./plans";
import { storeBilling } from "./billing.server";
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

/** Explicit plan selection starts a subscription. Existing non-fulfilment wallet funds become invoice credit. */
export async function startSubscription(storeId: number, planId: string) {
  if (!planById(planId)) throw new Error("Choose one of the available Growpefy plans.");
  const now = new Date();
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(billingAccounts).where(eq(billingAccounts.storeId, storeId)).for("update");
    if (existing) throw new Error("A billing plan is already active for this store. Contact Growpefy to change it.");
    const [store] = await tx.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store) throw new Error("Store not found.");
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.storeId, storeId)).for("update");
    let creditPaise = 0, creditGstPaise = 0, legacyDebtPaise = 0;
    // Fulfilment balances remain available to the dropshipping service; they are not subscription credits.
    if (wallet && !store.dropshipEnabled && wallet.balancePaise !== 0) {
      if (wallet.balancePaise > 0) {
        creditPaise = wallet.balancePaise;
        // Preserve only GST actually paid on the unused prepaid amount. Free/admin credits carry no GST credit.
        const ledger = await tx.select().from(walletTransactions).where(eq(walletTransactions.walletId, wallet.id)).orderBy(asc(walletTransactions.createdAt), asc(walletTransactions.id));
        const rechargeRows = await tx.select({ txnid: walletRecharges.txnid, creditPaise: walletRecharges.creditPaise, gstPaise: walletRecharges.gstPaise })
          .from(walletRecharges).where(and(eq(walletRecharges.walletId, wallet.id), eq(walletRecharges.status, "paid")));
        const taxByTxn = new Map(rechargeRows.map((r) => [r.txnid, { credit: r.creditPaise, gst: r.gstPaise }]));
        const buckets: { principal: number; gst: number }[] = [];
        const consume = (amount: number) => {
          for (const bucket of buckets) {
            if (amount <= 0) break;
            const take = Math.min(amount, bucket.principal);
            const tax = bucket.principal ? Math.min(bucket.gst, Math.round(bucket.gst * take / bucket.principal)) : 0;
            bucket.principal -= take; bucket.gst -= tax; amount -= take;
          }
        };
        for (const entry of ledger) {
          if (entry.amountPaise > 0) {
            const paid = entry.type === "recharge" ? taxByTxn.get(entry.refId) : null;
            const principal = Math.min(entry.amountPaise, paid?.credit ?? 0);
            const gst = principal && paid ? Math.round(paid.gst * principal / paid.credit) : 0;
            buckets.push({ principal: entry.amountPaise, gst });
          } else if (entry.amountPaise < 0) consume(-entry.amountPaise);
        }
        const tracked = buckets.reduce((n, b) => n + b.principal, 0);
        if (tracked > creditPaise) consume(tracked - creditPaise);
        else if (tracked < creditPaise) buckets.push({ principal: creditPaise - tracked, gst: 0 });
        creditGstPaise = buckets.reduce((n, b) => n + b.gst, 0);
      } else legacyDebtPaise = -wallet.balancePaise;
      const amountPaise = -wallet.balancePaise;
      const type = amountPaise > 0 ? "manual_credit" : "manual_debit";
      await tx.insert(walletTransactions).values({
        walletId: wallet.id, type, amountPaise, balanceAfterPaise: 0,
        refType: "billing_migration", refId: `plan-start-${storeId}`,
        note: "Transferred to the monthly billing account", createdBy: "Growpefy billing",
      }).onConflictDoNothing();
      await tx.update(wallets).set({ balancePaise: 0, updatedAt: now }).where(eq(wallets.id, wallet.id));
    }
    await tx.insert(billingAccounts).values({
      storeId, planId: planId as PlanId, startedAt: now, nextInvoiceAt: addBillingMonth(now),
      creditPaise, creditGstPaise, legacyDebtPaise, status: "active", updatedAt: now,
    });
  });
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
      const byType = new Map<string, number>();
      for (const u of usage) byType.set(u.type, (byType.get(u.type) ?? 0) + u.amountPaise);
      const lines: BillingLine[] = [{ label: `${plan.name} plan · monthly subscription`, amountPaise: plan.monthlyRupees * 100 }];
      const label: Record<string, string> = { sale_fee: `Checkout transaction fees (${feePct(plan)})`, sale_fee_reversal: "Transaction fee reversals", otp: "OTP messages", wa_confirm: "WhatsApp order confirmations", wa_tracking: "WhatsApp tracking messages", wa_promo: "WhatsApp promotional messages", wa_reply: "WhatsApp inbox replies", wa_followup: "WhatsApp inbox follow-ups", wa_recovery: "Abandoned checkout messages" };
      for (const [type, amountPaise] of byType) if (amountPaise) lines.push({ label: label[type] ?? type.replaceAll("_", " "), amountPaise });
      if (locked.legacyDebtPaise > 0) lines.push({ label: "Previous wallet balance due", amountPaise: locked.legacyDebtPaise });
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
        storeId, invoiceNo: no, planId: locked.planId, periodStart, periodEnd, lines,
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

export async function billingBlocked(storeId: number, now = new Date()) {
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
  if (row.status === "paid") return { status: "paid" as const, invoice: row };
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
export function startBillingWatcher() {
  if (timer) return;
  const run = async () => {
    try {
      const rows = await db.select({ storeId: billingAccounts.storeId }).from(billingAccounts)
        .where(sql`${billingAccounts.status} <> 'cancelled'`);
      for (const r of rows) await ensureBillingInvoices(r.storeId);
    } catch (e) { console.error("[billing] invoice watcher:", e instanceof Error ? e.message : e); }
  };
  timer = setInterval(() => { void run(); }, 10 * 60_000);
  timer.unref?.();
  setTimeout(() => { void run(); }, 4_000).unref?.();
}

export { PLANS };
export type { BillingInvoice };

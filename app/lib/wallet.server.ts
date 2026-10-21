import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import crypto from "node:crypto";
import {
  db, platformSettings, walletRecharges, walletTransactions, wallets,
  type Order, type PlatformSettings, type Store, type Wallet, type WalletRates,
} from "~/db.server";
import { payuEndpoint, sha512, verifyPayment, verifyPayuResponse, type PayuCreds } from "./payu.server";
import { orderValuePaise } from "./payment-methods";
import {
  DEFAULT_RATES, USAGE_RATE_KEY, financialYear, mergeRates, rechargeBreakup, saleFeeFor, walletState,
  type TxType, type UsageType,
} from "./wallet";

// ---------------- platform settings ----------------

export async function getPlatform(): Promise<PlatformSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(platformSettings).values({ id: 1, rates: DEFAULT_RATES, billing: { invoicePrefix: "GP", sac: "998314" } })
    .onConflictDoNothing().returning();
  return created ?? (await db.select().from(platformSettings).where(eq(platformSettings.id, 1)))[0];
}

/** Our own PayU account for wallet recharges (dashboard settings first, then env vars). */
export function platformPayu(p: PlatformSettings): PayuCreds {
  return {
    payuKey: p.payuKey || process.env.PLATFORM_PAYU_KEY || null,
    payuSalt: p.payuSalt || process.env.PLATFORM_PAYU_SALT || null,
    payuMode: (p.payuKey ? p.payuMode : process.env.PLATFORM_PAYU_MODE) === "live" ? "live" : "test",
  };
}

// ---------------- wallets ----------------

export async function getWallet(storeId: number): Promise<Wallet> {
  const [w] = await db.select().from(wallets).where(eq(wallets.storeId, storeId)).limit(1);
  if (w) return w;
  const p = await getPlatform();
  await db.insert(wallets).values({ storeId, negativeLimitPaise: p.defaultNegativeLimitPaise, lowAlertPaise: p.defaultLowAlertPaise }).onConflictDoNothing();
  return (await db.select().from(wallets).where(eq(wallets.storeId, storeId)).limit(1))[0];
}

export async function walletsFor(storeIds: number[]) {
  if (!storeIds.length) return [];
  await Promise.all(storeIds.map((id) => getWallet(id)));
  return db.select().from(wallets).where(inArray(wallets.storeId, storeIds));
}

export const stateOf = (w: Pick<Wallet, "balancePaise" | "lowAlertPaise" | "negativeLimitPaise">) =>
  walletState(w.balancePaise, w.lowAlertPaise, w.negativeLimitPaise);

export async function ratesFor(w: Wallet): Promise<WalletRates> {
  return mergeRates((await getPlatform()).rates, w.rates);
}

// ---------------- ledger ----------------

export type PostInput = { walletId: number; type: TxType; amountPaise: number; refType: string; refId: string; note?: string | null; createdBy?: string | null };

/**
 * Adds one ledger entry and updates the cached balance in a single transaction.
 * The wallet row is locked (SELECT … FOR UPDATE) so parallel orders can't corrupt the balance.
 * (type, refType, refId) is unique: a retry returns the existing entry and charges nothing.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function postTransaction(input: PostInput) {
  return db.transaction((tx) => postWithin(tx, input));
}

async function postWithin(tx: Tx, input: PostInput) {
  const [w] = await tx.select().from(wallets).where(eq(wallets.id, input.walletId)).for("update");
  if (!w) throw new Error("Wallet not found");
  const balanceAfter = w.balancePaise + input.amountPaise;
  const [row] = await tx.insert(walletTransactions).values({
    walletId: w.id, type: input.type, amountPaise: input.amountPaise, balanceAfterPaise: balanceAfter,
    refType: input.refType, refId: input.refId, note: input.note ?? null, createdBy: input.createdBy ?? null,
  }).onConflictDoNothing().returning();
  if (!row) {
    const [existing] = await tx.select().from(walletTransactions)
      .where(and(eq(walletTransactions.type, input.type), eq(walletTransactions.refType, input.refType), eq(walletTransactions.refId, input.refId)));
    return { entry: existing, duplicate: true };
  }
  await tx.update(wallets).set({ balancePaise: balanceAfter, updatedAt: new Date() }).where(eq(wallets.id, w.id));
  return { entry: row, duplicate: false };
}

// ---------------- sale fee ----------------

/** 1% (store rate) of a successful order. Safe to call many times for the same order. Never throws. */
export async function chargeSaleFee(store: Store, order: Order) {
  try {
    if (order.status !== "paid" && order.status !== "cod_placed") return null;
    const w = await getWallet(store.id);
    const rates = await ratesFor(w);
    const base = orderValuePaise(order);
    const fee = saleFeeFor(base, rates.saleFeeBps);
    if (fee <= 0) return null;
    return await postTransaction({
      walletId: w.id, type: "sale_fee", amountPaise: -fee, refType: "order", refId: order.id,
      note: `${(rates.saleFeeBps / 100).toFixed(2)}% of ₹${(base / 100).toFixed(2)} · ${order.paymentMethod === "cod" ? "COD" : order.paymentMethod === "partial" ? "Partial COD" : "Prepaid"}${order.shopifyOrderName ? ` · ${order.shopifyOrderName}` : ""}`,
    });
  } catch (e) {
    console.error(`[wallet] sale fee for ${order.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Gives the sale fee back after a full refund, if the store's wallet allows it. */
export async function reverseSaleFee(store: Store, order: Order) {
  try {
    const w = await getWallet(store.id);
    if (!w.reverseFeeOnRefund) return null;
    const [fee] = await db.select().from(walletTransactions)
      .where(and(eq(walletTransactions.type, "sale_fee"), eq(walletTransactions.refType, "order"), eq(walletTransactions.refId, order.id)));
    if (!fee) return null;
    return await postTransaction({ walletId: w.id, type: "refund_reversal", amountPaise: -fee.amountPaise, refType: "order", refId: order.id, note: "Order fully refunded" });
  } catch (e) {
    console.error(`[wallet] reversal for ${order.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------- messages / OTP ----------------

/** Whether a message type may be sent. Past the negative limit only OTP and order confirmations go out. */
export async function canUse(storeId: number, type: UsageType) {
  const w = await getWallet(storeId);
  if (w.status === "suspended") return type === "otp" || type === "wa_confirm";
  if (stateOf(w) === "locked") return type === "otp" || type === "wa_confirm";
  return true;
}

/**
 * Charges one OTP / WhatsApp message. Call ONLY after the provider says sent/accepted.
 * refId must be unique per message (provider message id) so retries don't double charge.
 */
export async function chargeUsage(storeId: number, type: UsageType, refId: string, note?: string) {
  const w = await getWallet(storeId);
  const rate = (await ratesFor(w))[USAGE_RATE_KEY[type]] ?? 0;
  if (rate <= 0) return null;
  return postTransaction({ walletId: w.id, type, amountPaise: -rate, refType: "message", refId, note });
}

// ---------------- manual adjustments (super admin) ----------------

export async function manualAdjust(walletId: number, amountPaise: number, reason: string, by: string) {
  if (!reason.trim()) throw new Error("A reason is required");
  if (!amountPaise) throw new Error("Enter an amount");
  return postTransaction({
    walletId, type: amountPaise > 0 ? "manual_credit" : "manual_debit", amountPaise,
    refType: "manual", refId: crypto.randomUUID(), note: reason.trim().slice(0, 300), createdBy: by,
  });
}

// ---------------- recharges ----------------

export function newRechargeTxnid() {
  return `WR${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createRecharge(w: Wallet, creditPaise: number, by: string) {
  const p = await getPlatform();
  if (creditPaise < p.minRechargePaise) throw new Error(`Minimum recharge is ₹${(p.minRechargePaise / 100).toLocaleString("en-IN")}`);
  if (creditPaise > 10_00_000_00) throw new Error("Maximum ₹10,00,000 per recharge");
  const creds = platformPayu(p);
  if (!creds.payuKey || !creds.payuSalt) throw new Error("Online recharge isn't set up yet. Contact support.");
  const b = rechargeBreakup(creditPaise);
  const [r] = await db.insert(walletRecharges).values({
    walletId: w.id, txnid: newRechargeTxnid(), creditPaise: b.credit, gstPaise: b.gst, totalPaise: b.total, createdBy: by,
  }).returning();
  return r;
}

/** PayU form fields for a wallet recharge (our PayU account). */
export async function rechargePayuForm(txnid: string, payer: { name: string; email: string; phone?: string | null }, storeName: string) {
  const p = await getPlatform();
  const creds = platformPayu(p);
  const [r] = await db.select().from(walletRecharges).where(eq(walletRecharges.txnid, txnid)).limit(1);
  if (!r) throw new Response("Recharge not found", { status: 404 });
  if (!creds.payuKey || !creds.payuSalt) throw new Error("Online recharge isn't set up yet");
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const f: Record<string, string> = {
    key: creds.payuKey,
    txnid: r.txnid,
    amount: (r.totalPaise / 100).toFixed(2),
    productinfo: `Growpefy wallet recharge - ${storeName}`.slice(0, 100),
    firstname: (payer.name || "Store owner").slice(0, 60),
    email: payer.email.includes("@") ? payer.email : `wallet${r.walletId}@growpefy.com`,
    phone: (payer.phone ?? "").replace(/\D/g, "").slice(-10) || "9999999999",
    surl: `${appUrl}/wallet/payu/return`,
    furl: `${appUrl}/wallet/payu/return`,
    udf1: "wallet", udf2: String(r.walletId), udf3: "", udf4: "", udf5: "",
  };
  f.hash = sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, f.udf1, f.udf2, f.udf3, f.udf4, f.udf5, "", "", "", "", "", creds.payuSalt].join("|"));
  return { action: payuEndpoint(creds), fields: f, recharge: r };
}

export async function checkReturnHash(f: Record<string, string>) {
  return verifyPayuResponse(platformPayu(await getPlatform()), f);
}

/**
 * Confirms a recharge with PayU (server to server) and credits the wallet exactly once.
 * The wallet is credited only when PayU says success AND the amount matches.
 */
export async function confirmRecharge(txnid: string) {
  const p = await getPlatform();
  const [r] = await db.select().from(walletRecharges).where(eq(walletRecharges.txnid, txnid)).limit(1);
  if (!r) return { status: "not_found" as const };
  if (r.status === "paid") return { status: "paid" as const, recharge: r };

  const v = await verifyPayment(platformPayu(p), txnid);
  if (v.status === "failure") {
    await db.update(walletRecharges).set({ status: "failed" }).where(and(eq(walletRecharges.id, r.id), eq(walletRecharges.status, "pending")));
    return { status: "failed" as const, recharge: r };
  }
  if (v.status !== "success") return { status: "pending" as const, recharge: r };
  if (v.amountPaise != null && v.amountPaise !== r.totalPaise) {
    console.error(`[wallet] recharge ${txnid}: PayU amount ${v.amountPaise} ≠ ${r.totalPaise}`);
    return { status: "mismatch" as const, recharge: r };
  }

  const ours = p.billing ?? {};
  // One transaction: lock the recharge, give it an invoice number, credit the wallet. Runs once per recharge.
  const paid = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(walletRecharges).where(eq(walletRecharges.id, r.id)).for("update");
    if (locked.status === "paid") return locked;
    const [w] = await tx.select().from(wallets).where(eq(wallets.id, locked.walletId));
    const sameState = Boolean(ours.state && w.billing?.state && ours.state.trim().toLowerCase() === w.billing.state.trim().toLowerCase());
    const [seq] = (await tx.execute(sql`select nextval('wallet_invoice_seq')::text as n`)) as unknown as { n: string }[];
    const invoiceNo = `${ours.invoicePrefix || "GP"}/${financialYear(new Date())}/${String(seq.n).padStart(5, "0")}`;
    const [u] = await tx.update(walletRecharges).set({
      status: "paid", mihpayid: v.mihpayid, paidAt: new Date(), invoiceNo,
      billing: { ...(w.billing ?? {}), taxType: sameState ? "cgst_sgst" : "igst" },
    }).where(eq(walletRecharges.id, locked.id)).returning();
    await postWithin(tx, {
      walletId: locked.walletId, type: "recharge", amountPaise: locked.creditPaise, refType: "recharge", refId: locked.txnid,
      note: `Paid ₹${(locked.totalPaise / 100).toFixed(2)} incl. GST${v.mihpayid ? ` · PayU ${v.mihpayid}` : ""}`,
    });
    return u;
  });
  return { status: "paid" as const, recharge: paid };
}

// ---------------- reports ----------------

const usageTypes = ["sale_fee", "otp", "wa_confirm", "wa_tracking", "wa_promo", "refund_reversal"] as const;

/** Count + amount per transaction type in a period (amounts as positive paise spent). */
export async function usageSummary(walletIds: number[], from: Date, to: Date) {
  if (!walletIds.length) return [];
  const rows = await db.select({
    type: walletTransactions.type,
    n: sql<number>`count(*)::int`,
    amount: sql<string>`coalesce(sum(${walletTransactions.amountPaise}), 0)`,
  }).from(walletTransactions)
    .where(and(inArray(walletTransactions.walletId, walletIds), gte(walletTransactions.createdAt, from), lt(walletTransactions.createdAt, to)))
    .groupBy(walletTransactions.type);
  return rows.map((r) => ({ type: r.type, count: r.n, amount: Number(r.amount) }));
}

export async function rechargeSummary(walletIds: number[] | null, from: Date, to: Date) {
  const where = [eq(walletRecharges.status, "paid"), gte(walletRecharges.paidAt, from), lt(walletRecharges.paidAt, to)];
  if (walletIds) where.push(inArray(walletRecharges.walletId, walletIds.length ? walletIds : [-1]));
  const [r] = await db.select({
    n: sql<number>`count(*)::int`,
    credit: sql<string>`coalesce(sum(${walletRecharges.creditPaise}), 0)`,
    gst: sql<string>`coalesce(sum(${walletRecharges.gstPaise}), 0)`,
    total: sql<string>`coalesce(sum(${walletRecharges.totalPaise}), 0)`,
  }).from(walletRecharges).where(and(...where));
  return { count: r?.n ?? 0, credit: Number(r?.credit ?? 0), gst: Number(r?.gst ?? 0), total: Number(r?.total ?? 0) };
}

export function recentRecharges(walletId: number, limit = 50) {
  return db.select().from(walletRecharges).where(eq(walletRecharges.walletId, walletId)).orderBy(desc(walletRecharges.createdAt)).limit(limit);
}

export { usageTypes };

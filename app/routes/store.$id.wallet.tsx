import { DownloadLink } from "~/components/DownloadLink";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { and, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { Notice, SubmitButton } from "~/components/ui";
import { db, stores, walletTransactions, wallets } from "~/db.server";
import { kycGate, requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, istToday, resolveRange } from "~/lib/dates";
import { INDIAN_STATES } from "~/lib/states";
import { DEFAULT_RATES, TX_LABELS, mergeRates, rechargeBreakup, rupees, type TxType } from "~/lib/wallet";
import {
  adminAdjustments, adminCredit, confirmRecharge, createRecharge, getPlatform, getWallet, manualAdjust, platformPayu, ratesFor, recentRecharges, stateOf, usageSummary,
} from "~/lib/wallet.server";
import { storeBilling } from "~/lib/billing.server";
import { BILLING_FIELDS, BILLING_LABEL, type BillingField } from "~/lib/billing";
import { storePath } from "~/lib/store-code";
import { accountFor, invoicesFor, startSubscription, PLANS } from "~/lib/subscription-billing.server";
import { upcomingBill } from "~/lib/billing-breakdown.server";
import { planById, feePct, rupeesLabel } from "~/lib/plans";

const PAGE = 50;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const [w, p] = await Promise.all([getWallet(store.id), getPlatform()]);
  const url = new URL(request.url);
  const sp = new URLSearchParams(url.searchParams);
  if (!sp.get("range")) sp.set("range", "30d");
  const range = resolveRange(sp);
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const type = url.searchParams.get("type") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const where: SQL[] = [eq(walletTransactions.walletId, w.id), gte(walletTransactions.createdAt, from), lt(walletTransactions.createdAt, to)];
  if (type && type in TX_LABELS) where.push(eq(walletTransactions.type, type));

  const monthStart = new Date(`${istToday().slice(0, 7)}-01T00:00:00+05:30`);
  const isAdmin = viewer.role === "admin";
  const [rows, usage, recharges, rates, billing, adjustments, accountRow] = await Promise.all([
    db.select().from(walletTransactions).where(and(...where)).orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id)).limit(PAGE + 1).offset((page - 1) * PAGE),
    usageSummary([w.id], monthStart, new Date(Date.now() + 60_000)),
    recentRecharges(w.id, 30),
    ratesFor(w),
    storeBilling(store.id),
    isAdmin ? adminAdjustments(w.id) : Promise.resolve([]),
    accountFor(store.id),
  ]);
  const invoices = accountRow ? await invoicesFor(store.id) : [];
  const account = accountRow ? await accountFor(store.id) : null;
  const plan = account ? planById(account.planId) : null;
  const upcoming = account ? await upcomingBill(store.id) : null;
  const dropship = (await db.select({ dropshipEnabled: stores.dropshipEnabled }).from(stores).where(eq(stores.id, store.id)).limit(1))[0]?.dropshipEnabled ?? false;
  const creds = platformPayu(p);

  return json({
    storeId: store.id,
    storeName: store.name,
    dropship,
    account: account ? { planId: account.planId, status: account.status, startedAt: account.startedAt.toISOString(), nextInvoiceAt: account.nextInvoiceAt.toISOString(), creditPaise: account.creditPaise, creditGstPaise: account.creditGstPaise, legacyDebtPaise: account.legacyDebtPaise, planName: plan?.name ?? account.planId } : null,
    plans: PLANS,
    upcoming,
    invoices: invoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, planId: i.planId, periodStart: i.periodStart.toISOString(), periodEnd: i.periodEnd.toISOString(), lines: i.lines, subtotalPaise: i.subtotalPaise, gstPaise: i.gstPaise, creditPaise: i.creditPaise, creditGstPaise: i.creditGstPaise, totalPaise: i.totalPaise, duePaise: i.duePaise, status: i.status, dueAt: i.dueAt.toISOString(), paidAt: i.paidAt?.toISOString() ?? null })),
    isAdmin: viewer.role === "admin",
    wallet: {
      balance: w.balancePaise, state: stateOf(w), negativeLimit: w.negativeLimitPaise, lowAlert: w.lowAlertPaise,
      status: w.status, billing: w.billing ?? {}, reverseFeeOnRefund: w.reverseFeeOnRefund, rateOverride: w.rates ?? {},
    },
    billing,
    adjustments: adjustments.map((t) => ({ id: t.id, amount: t.amountPaise, note: t.note, by: t.createdBy, at: t.createdAt.toISOString() })),
    rates,
    defaultRates: mergeRates(p.rates),
    minRecharge: p.minRechargePaise,
    payuReady: Boolean(creds.payuKey && creds.payuSalt),
    payuMode: creds.payuMode,
    range, type, page,
    hasMore: rows.length > PAGE,
    ledger: rows.slice(0, PAGE).map((t) => ({ id: t.id, type: t.type, amount: t.amountPaise, after: t.balanceAfterPaise, refType: t.refType, refId: t.refId, note: t.note, by: t.createdBy, at: t.createdAt.toISOString() })),
    usage,
    recharges: recharges.map((r) => ({ id: r.id, txnid: r.txnid, credit: r.creditPaise, gst: r.gstPaise, total: r.totalPaise, status: r.status, invoiceNo: r.invoiceNo, source: r.source, note: r.note, by: r.createdBy, at: (r.paidAt ?? r.createdAt).toISOString() })),
  });
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const paise = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[^\d.-]/g, "")) * 100);

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const w = await getWallet(store.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const fail = (error: string, field = intent) => json({ ok: null, error, field }, { status: 400 });

  try {
    switch (intent) {
      case "subscribe": {
        if (await accountFor(store.id)) return fail("A billing plan is already active for this store. Contact Growpefy to change it.");
        const planId = s("planId");
        if (!planById(planId)) return fail("Choose a Growpefy plan.");
        if (fd.get("agree") !== "on") return fail("Confirm the monthly plan and billing terms to continue.");
        await startSubscription(store.id, planId);
        return json({ ok: "Plan started. Your first invoice will be created on your monthly billing date.", error: null, field: intent });
      }
      case "recharge": {
        if (await accountFor(store.id) && !store.dropshipEnabled) return fail("This store now uses monthly billing. Open an invoice below to pay.");
        { const g = kycGate(viewer, "adding money to your wallet"); if (g) return fail(g); }
        const credit = paise(fd.get("amount"));
        if (!Number.isFinite(credit) || credit <= 0) return fail("Enter the amount to add");
        const r = await createRecharge(w, credit, viewer.email);
        return redirect(`/wallet/pay/${r.txnid}`);
      }
      case "billing": {
        // Owners can only fill what's missing; details from KYC (and anything already set) change only by Growpefy (re-KYC)
        const cur = await storeBilling(store.id);
        const admin = viewer.role === "admin";
        const may = (f: BillingField) => admin || (!cur.fromKyc.includes(f) && !cur.details[f]) || (f === "name" && !cur.hasOwner && !(w.billing ?? {}).name);
        const next = { ...(w.billing ?? {}) };
        const max: Record<BillingField, number> = { name: 120, gstin: 15, address: 300, state: 60, email: 120, phone: 20 };
        for (const f of BILLING_FIELDS) {
          if (!fd.has(f) || !may(f)) continue;
          const v = (f === "gstin" ? s(f).toUpperCase() : s(f)).slice(0, max[f]);
          if (f === "gstin" && v && !GSTIN.test(v)) return fail("GSTIN doesn't look right. It has 15 characters, e.g. 09ABCDE1234F1Z5");
          if (f === "state" && v && !INDIAN_STATES.some((x) => x.name === v)) return fail("Pick the state");
          if (v) next[f] = v; else delete next[f];
        }
        await db.update(wallets).set({ billing: next, updatedAt: new Date() }).where(eq(wallets.id, w.id));
        return json({ ok: "Billing details saved. New invoices will use them.", error: null, field: intent });
      }
      case "recheck": {
        const r = await confirmRecharge(s("txnid"));
        const msg = r.status === "paid" ? "Payment confirmed. The amount is in your wallet." : r.status === "failed" ? "PayU says this payment failed." : "PayU hasn't confirmed this payment yet. Try again in a minute.";
        return json({ ok: msg, error: null, field: intent });
      }
    }

    // ----- super admin only -----
    if (viewer.role !== "admin") return fail("Not allowed");
    switch (intent) {
      case "adjust": {
        const amount = paise(fd.get("amount"));
        if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount");
        const by = viewer.staff?.name ?? "Super admin";
        if (s("direction") === "debit") {
          await manualAdjust(w.id, -amount, s("reason"), by);
          return json({ ok: `Debited ${rupees(amount)}`, error: null, field: intent });
        }
        const bill = fd.get("bill") === "on";
        const r = await adminCredit(store.id, amount, { bill, by, reason: s("reason") });
        return json({
          ok: bill ? `Added ${rupees(amount)} with GST invoice ${r.invoiceNo} (${rupees(Math.round(amount * 1.18))} incl. GST). The store can download it from Recharges and invoices.` : `Added ${rupees(amount)} as Growpefy free credit. No invoice.`,
          error: null, field: intent,
        });
      }
      case "limits": {
        await db.update(wallets).set({
          negativeLimitPaise: Math.max(0, paise(fd.get("negativeLimit")) || 0),
          lowAlertPaise: Math.max(0, paise(fd.get("lowAlert")) || 0),
          reverseFeeOnRefund: fd.get("reverseFeeOnRefund") === "on",
          status: s("status") === "suspended" ? "suspended" : "active",
          updatedAt: new Date(),
        }).where(eq(wallets.id, w.id));
        return json({ ok: "Wallet limits saved", error: null, field: intent });
      }
      case "rates": {
        const o: Record<string, number> = {};
        const num = (k: string) => (s(k) === "" ? null : Number(s(k)));
        const pct = num("saleFeePct");
        if (pct != null) o.saleFeeBps = Math.round(pct * 100);
        for (const k of ["otp", "waConfirm", "waTracking", "waPromo", "waReply", "waFollowup"]) { const v = num(k); if (v != null) o[k] = Math.round(v * 100); }
        if (Object.values(o).some((v) => !Number.isFinite(v) || v < 0)) return fail("Rates must be 0 or more");
        await db.update(wallets).set({ rates: Object.keys(o).length ? o : null, updatedAt: new Date() }).where(eq(wallets.id, w.id));
        return json({ ok: Object.keys(o).length ? "Special rates saved for this store" : "This store now uses the default rate card", error: null, field: intent });
      }
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    return fail(e instanceof Error ? e.message : "Something went wrong");
  }
  return fail("Unknown action");
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

const STATE_UI = {
  ok: { label: "Healthy", cls: "bg-emerald-400/20 text-emerald-100" },
  low: { label: "Low balance", cls: "bg-amber-400/25 text-amber-100" },
  negative: { label: "Below ₹0", cls: "bg-orange-400/25 text-orange-100" },
  locked: { label: "Limit crossed", cls: "bg-red-400/30 text-red-100" },
} as const;

const when = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function WalletPage() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [params] = useSearchParams();
  const rc = params.get("recharge");
  const invoiceNotice = params.get("invoice");
  const st = STATE_UI[d.wallet.state];
  const spentMonth = d.usage.filter((u) => u.type !== "recharge" && u.type !== "manual_credit" && u.type !== "manual_debit").reduce((n, u) => n - u.amount, 0);

  return (
    <div className="space-y-5">
      {rc === "success" && <Notice tone="success">Recharge successful. The amount has been added to your wallet.</Notice>}
      {rc === "failed" && <Notice tone="error">The payment didn't go through. No money was added. You can try again.</Notice>}
      {rc === "pending" && <Notice tone="warning">We're waiting for PayU to confirm your payment. It usually takes a minute. Use “Check status” below.</Notice>}
      {invoiceNotice === "success" && <Notice tone="success">Invoice payment confirmed. Your billing status has been updated.</Notice>}
      {invoiceNotice === "pending" && <Notice tone="warning">PayU is still confirming this invoice payment. Refresh shortly; the invoice will update after verification.</Notice>}
      {invoiceNotice === "failed" && <Notice tone="error">PayU did not confirm the invoice payment. The invoice remains open; you can try again.</Notice>}
      {invoiceNotice === "mismatch" && <Notice tone="error">The received payment amount did not match the invoice. Contact Growpefy support before retrying.</Notice>}
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      {d.wallet.status === "suspended" && <Notice tone="error">This wallet is suspended by the admin. Only OTP and order confirmation messages go out.</Notice>}
      {d.wallet.state === "locked" && (
        <Notice tone="error">
          Your balance is below the allowed limit of {rupees(-d.wallet.negativeLimit, 0)}. Checkout keeps working, but promotional and tracking messages are paused
          and some dashboard features are locked. Recharge to unlock everything.
        </Notice>
      )}

      {d.account ? <BillingOverview d={d} /> : <SubscriptionPanel d={d} />}
      {/* Existing wallet remains the fulfilment wallet for dropshipping stores. */}
      {(d.dropship || !d.account) && <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0E1714_0%,#0B5D4B_65%,#138a6e_100%)] p-5 text-white shadow-lift sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-white/70">Wallet balance</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
            </div>
            <p className={`num mt-2 text-[44px] font-semibold leading-none tracking-tight sm:text-[56px] ${d.wallet.balance < 0 ? "text-red-200" : ""}`}>{rupees(d.wallet.balance)}</p>
            <p className="mt-3 text-sm text-white/75">
              Checkout never stops. The balance may go down to {rupees(-d.wallet.negativeLimit, 0)} before promotional and tracking messages pause.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15"><dt className="text-[11px] text-white/70">Spent this month</dt><dd className="num mt-0.5 text-lg font-semibold">{rupees(spentMonth)}</dd></div>
            <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15"><dt className="text-[11px] text-white/70">Low balance alert</dt><dd className="num mt-0.5 text-lg font-semibold">{rupees(d.wallet.lowAlert, 0)}</dd></div>
          </dl>
        </div>
      </section>}

      {(d.dropship || !d.account) && <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <RechargeCard d={d} />
        <section className="panel">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Your rates</h2>
          <ul className="divide-y divide-rule text-sm">
            {[
              ["Sale fee", `${(d.rates.saleFeeBps / 100).toFixed(2).replace(/\.00$/, "")}% of each order`, "Charged when an order is paid online or placed on COD"],
              ["OTP", `${rupees(d.rates.otp)} per OTP`, "Only when the OTP is sent"],
              ["WhatsApp order confirmation", `${rupees(d.rates.waConfirm)} per message`, null],
              ["WhatsApp courier tracking", `${rupees(d.rates.waTracking)} per message`, null],
              ["WhatsApp promotional", `${rupees(d.rates.waPromo)} per message`, null],
              ["WhatsApp inbox reply (within 24 h)", `${rupees(d.rates.waReply ?? 7)} per reply`, null],
              ["WhatsApp inbox follow-up (after 24 h)", `${rupees(d.rates.waFollowup ?? 150)} per message`, null],
            ].map(([k, v, h]) => (
              <li key={k} className="flex items-start justify-between gap-3 px-5 py-3">
                <div><p className="font-medium">{k}</p>{h && <p className="text-xs text-ink-faint">{h}</p>}</div>
                <p className="num shrink-0 font-semibold">{v}</p>
              </li>
            ))}
          </ul>
          <p className="border-t border-rule px-5 py-2.5 text-xs text-ink-faint">Messages are charged only when they're delivered to WhatsApp / the SMS provider. Failed sends are free.</p>
        </section>
      </div>}

      {(d.dropship || !d.account) && <UsageCard usage={d.usage} />}
      {(d.dropship || !d.account) && <Ledger d={d} />}
      {(d.dropship || !d.account) && <Recharges d={d} />}
      <Billing d={d} field={res?.field} />
      {d.isAdmin && <AdminPanel d={d} />}
    </div>
  );
}

function SubscriptionPanel({ d }: { d: D }) {
  const [planId, setPlanId] = useState("growth");
  const account = d.account;
  const money = (n: number) => rupees(n);
  return <section className="panel overflow-hidden">
    <div className="border-b border-rule px-5 py-4"><h2 className="text-[15px] font-semibold">Plan & monthly billing</h2><p className="mt-1 text-xs text-ink-soft">Monthly plan, checkout fees and message usage appear on one GST invoice.</p></div>
    {account ? <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-paper p-4">
        <div><p className="text-xs text-ink-soft">Current plan</p><p className="mt-1 text-lg font-semibold">{account.planName} · {rupeesLabel(d.plans.find((p) => p.id === account.planId)?.monthlyRupees ?? 0)}/month</p><p className="mt-1 text-sm text-ink-soft">{feePct(d.plans.find((p) => p.id === account.planId) ?? { feeBps: 0 })} Smart Checkout transaction fee · Renews {new Date(account.nextInvoiceAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</p></div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{account.status}</span>
      </div>
      {(account.creditPaise + account.creditGstPaise > 0 || account.legacyDebtPaise > 0) && <p className="text-sm text-ink-soft">Invoice credit remaining: <b>{money(account.creditPaise + account.creditGstPaise)}</b>{account.legacyDebtPaise > 0 ? ` · Previous wallet balance due: ${money(account.legacyDebtPaise)}` : ""}</p>}
      <div><h3 className="mb-2 text-sm font-semibold">Invoices</h3>{d.invoices.length ? <div className="divide-y divide-rule rounded-xl border border-rule">{d.invoices.map((i) => <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div><p className="text-sm font-medium">{i.invoiceNo} <span className="ml-1 text-xs text-ink-faint">· {new Date(i.periodStart).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</span></p><p className="mt-0.5 text-xs text-ink-soft">Total {money(i.totalPaise)} · {i.status === "paid" ? "Paid" : `Due ${money(i.duePaise)} by ${new Date(i.dueAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}`}</p></div>
        <div className="flex gap-2">{i.status !== "paid" && <Link className="btn-primary btn" to={storePath(d.storeId, `billing/pay/${i.id}`)}>Pay invoice</Link>}<a className="btn-secondary btn" href={storePath(d.storeId, `billing/invoice/${i.id}`)}>Download PDF</a></div>
      </div>)}</div> : <p className="text-sm text-ink-soft">No invoice yet. Your first invoice is created on your monthly billing date.</p>}</div>
    </div> : <div className="p-5"><p className="mb-4 max-w-2xl text-sm text-ink-soft">Choose a plan to start monthly billing. Any unused wallet balance and its previously paid GST will be credited to future invoices. Dropshipping fulfilment balances remain in the wallet.</p>
      <Form method="post" className="space-y-4"><div className="grid gap-3 md:grid-cols-3">{d.plans.map((p) => <label key={p.id} className={`cursor-pointer rounded-xl border p-4 ${planId === p.id ? "border-pine ring-2 ring-pine/15" : "border-rule"}`}><input type="radio" name="planId" value={p.id} checked={planId === p.id} onChange={() => setPlanId(p.id)} className="sr-only"/><span className="text-sm font-semibold">{p.name}</span><span className="mt-1 block text-xl font-semibold">{rupeesLabel(p.monthlyRupees)}<small className="ml-1 text-xs font-normal text-ink-soft">/month</small></span><span className="mt-1 block text-xs text-ink-soft">{feePct(p)} per Smart Checkout order</span></label>)}</div>
      <label className="flex items-start gap-2 text-xs text-ink-soft"><input type="checkbox" name="agree" className="mt-0.5"/><span>I agree to the monthly plan fee, transaction and message usage charges, 18% GST, PayU invoice payments, and the 7-day grace period.</span></label><SubmitButton intent="subscribe" busyText="Starting plan…">Start monthly plan</SubmitButton></Form>
    </div>}
  </section>;
}

function RechargeCard({ d }: { d: D }) {
  const min = d.minRecharge / 100;
  const [amount, setAmount] = useState(String(min));
  const credit = Math.round((Number(amount) || 0) * 100);
  const b = rechargeBreakup(credit);
  const tooLow = credit < d.minRecharge;
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "recharge";
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Add money</h2>
        <span className="flex items-center gap-1 text-xs text-ink-faint"><Icon name="wallet" className="h-3.5 w-3.5" />Secured by PayU</span>
      </div>
      <Form method="post" className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          {[min, 5000, 10000, 25000].filter((v, i, a) => a.indexOf(v) === i && v >= min).map((v) => (
            <button key={v} type="button" onClick={() => setAmount(String(v))}
              className={`rounded-lg border px-3.5 py-2 text-sm font-semibold ${Number(amount) === v ? "border-pine bg-pine-tint text-pine" : "border-rule-strong bg-surface text-ink-soft hover:text-ink"}`}>
              {rupees(v * 100, 0)}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="label">Amount to add to wallet (₹)</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">₹</span>
            <input name="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="input num pl-7 text-lg font-semibold" aria-describedby="min-note" />
          </div>
          <span id="min-note" className={`hint ${tooLow ? "text-bad" : ""}`}>Minimum {rupees(d.minRecharge, 0)}. GST is added on top.</span>
        </label>
        <dl className="num space-y-1.5 rounded-xl bg-paper p-4 text-sm">
          <div className="flex justify-between"><dt className="text-ink-soft">Wallet credit</dt><dd className="font-medium">{rupees(b.credit)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-soft">GST (18%)</dt><dd>{rupees(b.gst)}</dd></div>
          <div className="flex justify-between border-t border-rule pt-2 text-base font-semibold"><dt>You pay</dt><dd>{rupees(b.total)}</dd></div>
        </dl>
        {!d.payuReady ? (
          <Notice tone="warning">Online recharge isn't set up yet. {d.isAdmin ? "Add the platform PayU key and salt in All wallets → Settings." : "Please contact support to add money."}</Notice>
        ) : (
          <button name="intent" value="recharge" className="btn-primary w-full py-3 text-base" disabled={tooLow || busy}>
            {busy ? "Opening PayU…" : `Pay ${rupees(b.total)} securely`}
          </button>
        )}
        <p className="text-xs text-ink-faint">
          You'll get a GST invoice for every recharge. Wallet balance is non-refundable and non-transferable, and can only be used for Growpefy services.
          {d.payuMode === "test" && d.payuReady && <b className="text-warn"> PayU is in test mode.</b>}
        </p>
      </Form>
    </section>
  );
}

function UsageCard({ usage }: { usage: D["usage"] }) {
  const pick = (t: string) => usage.find((u) => u.type === t) ?? { count: 0, amount: 0 };
  const items: [TxType, string][] = [["sale_fee", "orders"], ["otp", "OTPs"], ["wa_confirm", "messages"], ["wa_tracking", "messages"], ["wa_promo", "messages"], ["wa_recovery", "messages"]];
  const reversed = pick("refund_reversal");
  return (
    <section className="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Usage this month</h2>
        {reversed.count > 0 && <span className="text-xs text-good">{reversed.count} fee{reversed.count === 1 ? "" : "s"} reversed · +{rupees(reversed.amount)}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-3">
        {items.map(([t, unit]) => {
          const u = pick(t);
          return (
            <div key={t} className="bg-surface px-5 py-4">
              <dt className="text-xs text-ink-soft">{TX_LABELS[t]}</dt>
              <dd className="num mt-1 text-lg font-semibold">{rupees(-u.amount)}</dd>
              <dd className="num text-xs text-ink-faint">{u.count.toLocaleString("en-IN")} {unit}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function Ledger({ d }: { d: D }) {
  const [params] = useSearchParams();
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    if (!("page" in patch)) p.delete("page");
    return `?${p}`;
  };
  const exportHref = `${storePath(d.storeId)}/wallet/export.csv?${new URLSearchParams([...params.entries()].filter(([k]) => ["range", "from", "to", "type"].includes(k)))}`;
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3.5">
        <h2 className="mr-auto text-[15px] font-semibold">Transactions</h2>
        <RangePicker current={d.range} align="right" />
        <Form method="get" preventScrollReset onChange={(e) => e.currentTarget.requestSubmit()}>
          {[...params.entries()].filter(([k]) => !["type", "page"].includes(k)).map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
          <select name="type" defaultValue={d.type} className="input h-9 py-0 text-sm" aria-label="Transaction type">
            <option value="">All types</option>
            {Object.entries(TX_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Form>
        <DownloadLink href={exportHref} title="Preparing your CSV" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rule-strong bg-surface px-3 text-sm text-ink-soft hover:text-ink"><Icon name="download" className="h-4 w-4" />CSV</DownloadLink>
      </div>
      {d.ledger.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-faint">No transactions in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead><tr><th>Date</th><th>Type</th><th>Details</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {d.ledger.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap text-sm">{when(t.at)}</td>
                  <td><span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${t.amount >= 0 ? "bg-emerald-50 text-good" : "bg-paper-sunk text-ink-soft"}`}>{TX_LABELS[t.type as TxType] ?? t.type}</span></td>
                  <td className="max-w-[320px] text-xs text-ink-soft">
                    <p className="truncate" title={t.note ?? ""}>{t.note ?? "—"}</p>
                    <p className="num truncate text-ink-faint">{t.refType === "order" ? `Order ${t.refId}` : t.refType === "recharge" ? `Txn ${t.refId}` : t.refType === "message" ? `Msg ${t.refId}` : t.by ? `By ${t.by}` : ""}</p>
                  </td>
                  <td className={`num text-right font-semibold ${t.amount >= 0 ? "text-good" : ""}`}>{t.amount >= 0 ? "+" : ""}{rupees(t.amount)}</td>
                  <td className={`num text-right ${t.after < 0 ? "text-bad" : "text-ink-soft"}`}>{rupees(t.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(d.page > 1 || d.hasMore) && (
        <div className="flex justify-between border-t border-rule px-5 py-3">
          {d.page > 1 ? <Link to={link({ page: String(d.page - 1) })} className="btn-secondary py-1.5">Newer</Link> : <span />}
          {d.hasMore && <Link to={link({ page: String(d.page + 1) })} className="btn-secondary py-1.5">Older</Link>}
        </div>
      )}
    </section>
  );
}

function Recharges({ d }: { d: D }) {
  return (
    <section className="panel">
      <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Recharges and invoices</h2>
      {d.recharges.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-faint">No recharges yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[680px]">
            <thead><tr><th>Date</th><th className="text-right">Credit</th><th className="text-right">GST</th><th className="text-right">Paid</th><th>Status</th><th>Invoice</th></tr></thead>
            <tbody>
              {d.recharges.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-sm">{when(r.at)}
                    <p className="num text-xs text-ink-faint">{r.source === "admin" ? <span className="mr-1 rounded bg-violet-50 px-1.5 py-px font-sans font-medium text-violet-800">By Growpefy</span> : <span className="mr-1 rounded bg-sky-50 px-1.5 py-px font-sans font-medium text-sky-800">Online</span>}{r.txnid}</p>
                    {d.isAdmin && r.source === "admin" && (r.note || r.by) && <p className="max-w-[220px] truncate text-xs text-ink-faint" title={r.note ?? ""}>{[r.note, r.by && `by ${r.by}`].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="num text-right font-medium">{rupees(r.credit)}</td>
                  <td className="num text-right text-ink-soft">{rupees(r.gst)}</td>
                  <td className="num text-right font-semibold">{rupees(r.total)}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "paid" ? "bg-emerald-50 text-good" : r.status === "failed" ? "bg-red-50 text-bad" : "bg-amber-50 text-amber-800"}`}>
                      {r.status === "paid" ? "Paid" : r.status === "failed" ? "Failed" : "Pending"}
                    </span>
                  </td>
                  <td>
                    {r.invoiceNo ? (
                      <span className="flex flex-col items-start gap-0.5">
                        <a href={`/dashboard/wallet/invoice/${r.id}/pdf`} download className="inline-flex items-center gap-1 text-sm font-medium text-pine hover:underline"><Icon name="download" className="h-3.5 w-3.5" />{r.invoiceNo} · PDF</a>
                        <a href={`/dashboard/wallet/invoice/${r.id}/pdf?view=1`} target="_blank" rel="noreferrer" className="text-xs text-ink-faint hover:text-ink">View</a>
                      </span>
                    ) : r.status === "pending" ? (
                      <Form method="post"><input type="hidden" name="txnid" value={r.txnid} /><SubmitButton intent="recheck" className="btn-secondary px-2.5 py-1 text-xs" busyText="Checking">Check status</SubmitButton></Form>
                    ) : <span className="text-xs text-ink-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const BILLING_ORDER: BillingField[] = ["name", "gstin", "address", "state", "email", "phone"];

function Billing({ d, field }: { d: D; field?: string }) {
  const b = d.billing;
  const det = b.details as Record<string, string | undefined>;
  // Owner: what came from KYC (or is already set) is read-only; only missing details can be added here
  const editable = (f: BillingField) => d.isAdmin || (!b.fromKyc.includes(f) && !det[f]);
  const missing = BILLING_ORDER.filter((f) => !det[f] && editable(f));
  const [open, setOpen] = useState(d.isAdmin ? field === "billing" : true);
  const summary = [det.name, det.gstin, det.state].filter(Boolean).join(" · ");
  const input = (f: BillingField) => f === "state" ? (
    <select name="state" defaultValue={det.state ?? ""} className="input"><option value="">Select state</option>{INDIAN_STATES.map((x) => <option key={x.code} value={x.name}>{x.name}</option>)}</select>
  ) : (
    <input name={f} defaultValue={det[f] ?? ""} type={f === "email" ? "email" : "text"} maxLength={f === "gstin" ? 15 : undefined} className={`input ${f === "gstin" ? "uppercase" : ""}`} placeholder={f === "gstin" ? "09ABCDE1234F1Z5" : undefined} />
  );

  return (
    <section className="panel">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">Billing details on your GST invoices</span>
          <span className="block truncate text-sm text-ink-soft">{summary || "Your invoices use these details."}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {b.complete ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-good">Complete</span> : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Details missing</span>}
          <Icon name="chevron" className={`h-4 w-4 text-ink-faint transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-rule p-5">
          {d.isAdmin ? (
            <Form method="post" className="grid gap-4 sm:grid-cols-2">
              <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900 sm:col-span-2">Admin only. Changing details that came from the owner's KYC is a manual re-KYC: check their documents first. New invoices use these details; old invoices don't change.</p>
              {BILLING_ORDER.map((f) => (
                <label key={f} className={`block ${f === "address" ? "sm:col-span-2" : ""}`}>
                  <span className="label">{BILLING_LABEL[f]}{b.fromKyc.includes(f) && <span className="ml-1.5 rounded bg-paper-sunk px-1.5 py-px text-[10px] font-medium text-ink-soft">From KYC</span>}</span>
                  {input(f)}
                </label>
              ))}
              <div className="sm:col-span-2"><SubmitButton intent="billing" busyText="Saving">Save billing details</SubmitButton></div>
            </Form>
          ) : (
            <>
              <dl className="divide-y divide-rule rounded-xl border border-rule">
                {BILLING_ORDER.filter((f) => det[f]).map((f) => (
                  <div key={f} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm">
                    <dt className="w-40 shrink-0 text-ink-soft">{BILLING_LABEL[f]}</dt>
                    <dd className="min-w-0 flex-1 break-words font-medium">{det[f]}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-faint"><Icon name="lock" className="mt-px h-3.5 w-3.5 shrink-0" />These come from your KYC and can't be changed here. To correct them, write to Growpefy support for a re-KYC.</p>
              {missing.length > 0 && (
                <Form method="post" className="mt-4 grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
                  <p className="text-sm font-medium sm:col-span-2">Add the missing details</p>
                  {missing.map((f) => (
                    <label key={f} className={`block ${f === "address" ? "sm:col-span-2" : ""}`}>
                      <span className="label">{BILLING_LABEL[f]}{f === "gstin" ? " (optional)" : ""}</span>
                      {input(f)}
                      {f === "state" && <span className="hint">Decides CGST + SGST or IGST on the invoice.</span>}
                    </label>
                  ))}
                  <p className="text-xs text-ink-faint sm:col-span-2">Once saved, these can only be changed by Growpefy.</p>
                  <div className="sm:col-span-2"><SubmitButton intent="billing" busyText="Saving">Save</SubmitButton></div>
                </Form>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function AdminPanel({ d }: { d: D }) {
  const o = d.wallet.rateOverride as Partial<typeof DEFAULT_RATES>;
  const def = d.defaultRates;
  const [dir, setDir] = useState("credit");
  const [bill, setBill] = useState(false);
  const [amt, setAmt] = useState("");
  const credit = Math.round((Number(amt) || 0) * 100);
  const nav = useNavigation();
  const [key, setKey] = useState(0);
  useEffect(() => { if (nav.state === "idle") { setKey((k) => k + 1); setAmt(""); setBill(false); } }, [nav.state]);
  return (
    <section className="panel border-2 border-dashed border-violet-300">
      <div className="flex items-center gap-2 border-b border-rule px-5 py-4">
        <Icon name="sparkle" className="h-4 w-4 text-violet-600" />
        <h2 className="text-[15px] font-semibold">Super admin controls</h2>
        <span className="text-xs text-ink-faint">Only you see this</span>
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-3">
        <Form method="post" className="space-y-3" key={`adj${key}`}>
          <p className="text-sm font-semibold">Add money / debit</p>
          <input type="hidden" name="direction" value={dir} />
          <div className="flex rounded-lg border border-rule-strong bg-surface p-0.5">
            {[["credit", "Add money"], ["debit", "Debit"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setDir(v)} className={`flex-1 rounded-md px-2 py-1.5 text-sm ${dir === v ? (v === "credit" ? "bg-good text-white" : "bg-bad text-white") : "text-ink-soft"}`}>{l}</button>
            ))}
          </div>
          <input name="amount" inputMode="decimal" placeholder="Amount for the wallet ₹" className="input num" required value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} />
          {dir === "credit" && (
            <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm ${bill ? "border-pine bg-pine-tint/40" : "border-rule"}`}>
              <input type="checkbox" name="bill" checked={bill} onChange={(e) => setBill(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0B5D4B]" />
              <span>
                <span className="block font-medium">Generate GST bill</span>
                <span className="block text-xs text-ink-soft">
                  {bill ? <>The store gets an invoice of <b className="num text-ink">{rupees(Math.round(credit * 1.18))}</b> ({rupees(credit)} + 18% GST) to download.</> : "Off: added as “Growpefy free credit”, with no invoice or recharge record."}
                </span>
              </span>
            </label>
          )}
          <input name="reason" placeholder={dir === "credit" && bill ? "Payment reference (optional, shown on the invoice)" : "Reason (required, shown in the ledger)"} className="input" required={!(dir === "credit" && bill)} maxLength={200} />
          <SubmitButton intent="adjust" busyText="Saving" className={dir === "credit" ? "btn-primary w-full" : "btn w-full bg-bad text-white"}>{dir === "credit" ? (bill ? "Add money and make the bill" : "Add free credit") : "Debit wallet"}</SubmitButton>
        </Form>

        <Form method="post" className="space-y-3">
          <p className="text-sm font-semibold">Limits</p>
          <label className="block"><span className="label">Can go negative down to (₹)</span><input name="negativeLimit" defaultValue={d.wallet.negativeLimit / 100} inputMode="numeric" className="input num" /></label>
          <label className="block"><span className="label">Low balance alert below (₹)</span><input name="lowAlert" defaultValue={d.wallet.lowAlert / 100} inputMode="numeric" className="input num" /></label>
          <label className="block"><span className="label">Status</span>
            <select name="status" defaultValue={d.wallet.status} className="input"><option value="active">Active</option><option value="suspended">Suspended (only OTP + confirmations)</option></select></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reverseFeeOnRefund" defaultChecked={d.wallet.reverseFeeOnRefund} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />Give the sale fee back when a prepaid order is fully refunded</label>
          <SubmitButton intent="limits" className="btn-secondary w-full" busyText="Saving">Save limits</SubmitButton>
        </Form>

        <Form method="post" className="space-y-3">
          <p className="text-sm font-semibold">Special rates for {d.storeName}</p>
          <p className="text-xs text-ink-faint">Leave a box empty to use the default rate.</p>
          {[
            ["saleFeePct", "Sale fee (%)", o.saleFeeBps != null ? o.saleFeeBps / 100 : "", def.saleFeeBps / 100],
            ["otp", "OTP (₹)", o.otp != null ? o.otp / 100 : "", def.otp / 100],
            ["waConfirm", "WA confirmation (₹)", o.waConfirm != null ? o.waConfirm / 100 : "", def.waConfirm / 100],
            ["waTracking", "WA tracking (₹)", o.waTracking != null ? o.waTracking / 100 : "", def.waTracking / 100],
            ["waPromo", "WA promotional (₹)", o.waPromo != null ? o.waPromo / 100 : "", def.waPromo / 100],
            ["waReply", "Inbox reply (₹)", o.waReply != null ? o.waReply / 100 : "", (def.waReply ?? 7) / 100],
            ["waFollowup", "Inbox follow-up (₹)", o.waFollowup != null ? o.waFollowup / 100 : "", (def.waFollowup ?? 150) / 100],
          ].map(([name, label, val, ph]) => (
            <label key={name as string} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-soft">{label}</span>
              <input name={name as string} defaultValue={val as string} placeholder={`Default ${ph}`} inputMode="decimal" className="input num w-32 py-1.5 text-right" />
            </label>
          ))}
          <SubmitButton intent="rates" className="btn-secondary w-full" busyText="Saving">Save rates</SubmitButton>
        </Form>
      </div>
      <div className="border-t border-rule">
        <p className="px-5 pt-4 text-sm font-semibold">Free credits and debits by Growpefy</p>
        {d.adjustments.length === 0 ? <p className="px-5 py-4 text-sm text-ink-faint">None yet. Billed recharges are listed under Recharges and invoices.</p> : (
          <ul className="divide-y divide-rule px-5 pb-2">
            {d.adjustments.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 text-sm">
                <span className={`num w-24 font-semibold ${t.amount >= 0 ? "text-good" : "text-bad"}`}>{t.amount >= 0 ? "+" : ""}{rupees(t.amount)}</span>
                <span className="min-w-0 flex-1 truncate text-ink-soft" title={t.note ?? ""}>{t.note ?? "—"}</span>
                <span className="text-xs text-ink-faint">{t.by ? `${t.by} · ` : ""}{when(t.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------- monthly billing (Shopify-style) ----------------

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

function BillingOverview({ d }: { d: D }) {
  const a = d.account!;
  const up = d.upcoming;
  const plan = d.plans.find((p) => p.id === a.planId);
  const open = d.invoices.filter((i) => i.status === "open");
  const overdue = open.filter((i) => new Date(i.dueAt).getTime() < Date.now());
  const elapsed = up ? Math.min(1, Math.max(0, (Date.now() - new Date(up.periodStart).getTime()) / (new Date(up.billDate).getTime() - new Date(up.periodStart).getTime()))) : 0;
  return (
    <div className="space-y-4">
      {open.length > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px] ${overdue.length ? "bg-[#fee9e8] text-[#8e1f0b]" : "bg-[#fff1e3] text-[#5e4200]"}`}>
          <span><b>{overdue.length ? "Overdue bill" : "Bill ready to pay"}</b> · {rupees(open[0].duePaise)} {overdue.length ? "was due" : "due"} on {day(open[0].dueAt)}.{a.status === "paused" ? " Some features are paused until it's paid." : ""}</span>
          <Link to={storePath(d.storeId, `billing/pay/${open[0].id}`)} className="btn-primary h-8 px-3 text-[12.5px]">Pay {rupees(open[0].duePaise)}</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink-soft">Upcoming bill</p>
              <p className="num mt-1.5 text-[34px] font-semibold leading-none tracking-tight">{up ? rupees(up.amountPaise) : "—"}</p>
              <p className="mt-1.5 text-[12px] text-ink-faint">Estimated so far, incl. GST{up?.hasCredit ? ", after your credit" : ""}</p>
            </div>
            <span className="rounded-full bg-[#f1f1f1] px-2.5 py-1 text-[11.5px] font-medium text-ink-soft">Estimate</span>
          </div>
          {up && (
            <>
              <div className="mt-5">
                <div className="flex justify-between text-[11.5px] text-ink-faint"><span>{shortDay(up.periodStart)}</span><span>{shortDay(up.billDate)}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#ececec]"><div className="h-full rounded-full bg-[#303030]" style={{ width: `${Math.round(elapsed * 100)}%` }} /></div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-rule pt-4 text-[13px]">
                <div><dt className="text-ink-soft">Bill date</dt><dd className="mt-0.5 font-semibold">{day(up.billDate)}</dd></div>
                <div><dt className="text-ink-soft">Pay by</dt><dd className="mt-0.5 font-semibold">{day(up.payBy)}</dd></div>
              </dl>
            </>
          )}
        </section>

        <section className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink-soft">Current plan</p>
              <p className="mt-1.5 text-[20px] font-semibold">{a.planName}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${a.status === "active" ? "bg-[#cdfee1] text-[#0c5132]" : "bg-[#fff1e3] text-[#5e4200]"}`}>{a.status === "active" ? "Active" : a.status === "paused" ? "Paused" : a.status}</span>
          </div>
          <ul className="mt-4 space-y-2 text-[13px]">
            <li className="flex justify-between"><span className="text-ink-soft">Monthly price</span><span className="num font-medium">{rupeesLabel(plan?.monthlyRupees ?? 0)}</span></li>
            <li className="flex justify-between"><span className="text-ink-soft">Transaction fee</span><span className="num font-medium">{feePct(plan ?? { feeBps: 0 })} of each order</span></li>
            <li className="flex justify-between"><span className="text-ink-soft">Customer since</span><span className="font-medium">{day(a.startedAt)}</span></li>
            {a.creditPaise + a.creditGstPaise > 0 && <li className="flex justify-between"><span className="text-ink-soft">Credit left</span><span className="num font-medium text-good">{rupees(a.creditPaise + a.creditGstPaise)}</span></li>}
          </ul>
          <p className="mt-4 border-t border-rule pt-3 text-[12px] text-ink-faint">All prices are before 18% GST. To change your plan, contact Growpefy support.</p>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4"><h2 className="text-[14px] font-semibold">Bills</h2><span className="text-[12px] text-ink-faint">{d.invoices.length} bill{d.invoices.length === 1 ? "" : "s"}</span></div>
        {d.invoices.length === 0 ? (
          <p className="border-t border-rule px-5 py-8 text-center text-[13px] text-ink-soft">Your first bill is created on {up ? day(up.billDate) : "your billing date"}.</p>
        ) : (
          <div className="overflow-x-auto border-t border-rule">
            <table className="w-full text-[13px]">
              <thead className="bg-[#f7f7f7] text-left text-[12px] text-ink-soft">
                <tr><th className="px-5 py-2.5 font-medium">Bill</th><th className="px-3 py-2.5 font-medium">Period</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-5 py-2.5" /></tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {d.invoices.map((i) => {
                  const late = i.status === "open" && new Date(i.dueAt).getTime() < Date.now();
                  return (
                    <tr key={i.id} className="hover:bg-[#fafafa]">
                      <td className="px-5 py-3"><Link to={storePath(d.storeId, `billing/bill/${i.id}`)} className="font-medium hover:underline">{i.invoiceNo}</Link></td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-soft">{shortDay(i.periodStart)} – {shortDay(i.periodEnd)}</td>
                      <td className="num whitespace-nowrap px-3 py-3 text-right font-medium">{rupees(i.totalPaise)}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${i.status === "paid" ? "bg-[#cdfee1] text-[#0c5132]" : late ? "bg-[#fee9e8] text-[#8e1f0b]" : "bg-[#fff1e3] text-[#5e4200]"}`}>
                          {i.status === "paid" ? "Paid" : late ? "Overdue" : `Due ${shortDay(i.dueAt)}`}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <Link to={storePath(d.storeId, `billing/bill/${i.id}`)} className="text-[12.5px] font-medium underline-offset-2 hover:underline">View</Link>
                        {i.status !== "paid" && <Link to={storePath(d.storeId, `billing/pay/${i.id}`)} className="btn-primary ml-3 h-7 px-2.5 text-[12px]">Pay</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

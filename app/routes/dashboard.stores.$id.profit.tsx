import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { and, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { PageHeader, Notice, SubmitButton } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { confirmProfitPayment, createProfitPayment, profitReport } from "~/lib/profit.server";
import { rupees } from "~/lib/wallet";
import { db, profitPayments } from "~/db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!store.profitEnabled && viewer.role !== "admin") throw new Response("Not found", { status: 404 });
  const raw = await profitReport(store);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? raw.since;
  const to = url.searchParams.get("to") ?? raw.until;
  const validDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const filterFrom = validDay(from) ? (from < raw.since ? raw.since : from) : raw.since;
  const filterTo = validDay(to) ? (to > raw.until ? raw.until : to) : raw.until;
  const payments = await db.select().from(profitPayments)
    .where(and(eq(profitPayments.storeId, store.id), or(
      eq(profitPayments.status, "pending"),
      and(eq(profitPayments.status, "confirmed"), gte(profitPayments.paymentDate, filterFrom), lte(profitPayments.paymentDate, filterTo)),
    )))
    .orderBy(desc(profitPayments.createdAt)).limit(100);
  const report = viewer.role === "admin" ? raw : {
    ...raw,
    rows: raw.rows.map(({ growpefyShare: _share, growpefyBalance: _balance, ...row }) => ({ ...row, growpefyShare: null, growpefyBalance: null })),
    totals: raw.totals ? { ...raw.totals, growpefyShare: null, growpefyBalance: null } : null,
  };
  const rows = filterFrom <= filterTo ? report.rows.filter((r) => r.day >= filterFrom && r.day <= filterTo) : [];
  const canManage = viewer.role === "owner" || (viewer.role === "admin" && !viewer.staff);
  return json({ name: store.name, admin: viewer.role === "admin", canManage, dropship: store.dropshipEnabled,
    viewerRole: viewer.role, viewerName: viewer.name, storeId: store.id, report: { ...report, rows },
    filter: { from: filterFrom, to: filterTo }, payments: payments.map((p) => ({ id: p.id, amount: p.amountPaise,
      date: p.paymentDate, note: p.note, createdBy: p.createdBy, confirmedBy: p.confirmedBy, status: p.status, confirmRole: p.confirmRole,
      expiresAt: p.otpExpiresAt?.toISOString() ?? null, expired: p.status === "pending" && (!p.otpExpiresAt || p.otpExpiresAt.getTime() < Date.now()),
      canConfirm: canManage && p.status === "pending" && Boolean(p.otpExpiresAt && p.otpExpiresAt.getTime() >= Date.now()) && p.confirmRole === viewer.role })) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (viewer.role === "admin" && viewer.staff) throw new Response("Only the Super Admin can record or confirm direct payments.", { status: 403 });
  if (viewer.role === "owner" && !store.profitEnabled) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  try {
    if (intent === "createPayment") {
      const amountPaise = Math.round(Number(String(fd.get("amount") ?? "").replace(/[₹,\s]/g, "")) * 100);
      await createProfitPayment(store, {
        amountPaise, paymentDate: String(fd.get("paymentDate") ?? ""),
        note: String(fd.get("note") ?? "").trim().slice(0, 200) || null, role: viewer.role, name: viewer.name,
      });
      return json({ ok: "A 6-digit confirmation code was sent to the other party. The entry affects the balance only after they confirm.", error: null });
    }
    if (intent === "confirmPayment") {
      const result = await confirmProfitPayment(String(fd.get("paymentId") ?? ""), store.id, String(fd.get("code") ?? "").trim(), viewer.role, viewer.name);
      const messages = {
        confirmed: "Payment confirmed. Growpefy's pending balance is updated.",
        incorrect: "That code isn't correct. Check the WhatsApp message and try again.",
        locked: "Too many incorrect codes. This entry expired; create a new entry to confirm the payment.",
        expired: "This code expired. Create a new entry to confirm the payment.",
        unavailable: "This payment can't be confirmed from this account or is no longer pending.",
      };
      return result === "confirmed" ? json({ ok: messages[result], error: null }) : json({ ok: null, error: messages[result] }, { status: 400 });
    }
    return json({ ok: null, error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Could not save this payment entry." }, { status: 400 });
  }
}

const inr = (v: number) => rupees(Math.round(v * 100), 2);
const signedInr = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + inr(Math.abs(v));
const dateLabel = (v: string) => new Date(`${v}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default function ProfitShare() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const { report } = d;
  const rows = report.rows;
  const r = report.totals;
  const share = d.admin ? r?.growpefyBalance ?? 0 : r?.storeShare ?? 0;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return (
    <>
      <PageHeader title="Sales and profit" description={d.name + " · cumulative totals since " + dateLabel(report.since) + " · cash profit follows PayU settlement dates"} />
      <div className="space-y-5">
        {res?.ok && <Notice tone="success">{res.ok}</Notice>}
        {res?.error && <Notice tone="error">{res.error}</Notice>}
        {!report.enabled && <Notice tone="info">This store's profit dashboard is off. Turn it on in the Super Admin's Store settings.</Notice>}
        {report.warnings.map((w, i) => <Notice key={i} tone="warning">{w}</Notice>)}
        {report.enabled && <>
          <Form method="get" className="panel flex flex-wrap items-end gap-3 p-4">
            <label className="block"><span className="label">From</span><input type="date" name="from" min={report.since} max={report.until} defaultValue={d.filter.from} className="input" /></label>
            <label className="block"><span className="label">To</span><input type="date" name="to" min={report.since} max={report.until} defaultValue={d.filter.to} className="input" /></label>
            <button className="btn-secondary">Filter days</button>
            <Link to={`/dashboard/stores/${d.storeId}/profit`} className="btn-quiet">Show all</Link>
          </Form>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="All checkout orders" value={String(r?.orders ?? 0)} sub={inr(r?.revenue ?? 0) + " revenue by order date"} />
            <Stat label="PayU settled to bank" value={inr(r?.settlement ?? 0)} sub="Actual settlements received" />
            <Stat label="Ads incl. 18% GST" value={inr(r?.adCostWithGst ?? 0)} sub="Meta + Google daily spend" />
            <Stat label={d.admin ? "Growpefy balance" : "Your total profit"} value={d.admin ? signedInr(share) : inr(share)} sub={d.admin ? "Growpefy share earned minus confirmed direct payments" : "Your cumulative share of " + inr(r?.cumulative ?? 0) + " net profit"} />
            {d.admin && <Stat label="Growpefy share earned" value={signedInr(r?.growpefyShare ?? 0)} sub={inr(r?.payments ?? 0) + " in confirmed direct payments"} />}
          </div>
          <section className="panel">
            <div className="border-b border-rule px-5 py-4">
              <h2 className="text-[15px] font-semibold">Daily breakdown</h2>
              <p className="mt-0.5 text-xs text-ink-faint">Orders and revenue include Growpefy and native Shopify checkout. Profit is grouped by the day PayU settles money to the bank. Ads GST is added at 18%.</p>
            </div>
            {rows.length ? <div className="overflow-x-auto"><table className="table min-w-[1080px]">
              <thead><tr><th>Date</th><th className="text-right">Orders</th><th className="text-right">Order revenue</th><th className="text-right">Bank settlement</th><th className="text-right">Ads + GST</th>{d.dropship && <th className="text-right">Dropship costs</th>}<th className="text-right">Day profit</th><th className="text-right">Running profit</th><th className="text-right">Direct payments</th>{d.admin && <><th className="text-right">Growpefy share</th><th className="text-right">Growpefy balance</th></>}<th className="text-right">Store share</th></tr></thead>
              <tbody>{rows.slice().reverse().map((x) => <tr key={x.day}>
                <td>{dateLabel(x.day)}</td><td className="num text-right">{x.orders.toLocaleString("en-IN")}</td><td className="num text-right">{inr(x.revenue)}</td>
                <td className="num text-right">{inr(x.settlement)}</td><td className="num text-right">{inr(x.adCostWithGst)}</td>{d.dropship && <td className="num text-right">{inr(-x.dropship)}</td>}
                <td className={`num text-right ${x.net < 0 ? "text-bad" : ""}`}>{inr(x.net)}</td><td className={`num text-right font-semibold ${x.cumulative < 0 ? "text-bad" : ""}`}>{inr(x.cumulative)}</td>
                <td className="num text-right">{inr(x.payments)}</td>{d.admin && <><td className="num text-right">{inr(x.growpefyShare ?? 0)}</td><td className="num text-right">{signedInr(x.growpefyBalance ?? 0)}</td></>}<td className="num text-right">{inr(x.storeShare)}</td>
              </tr>)}</tbody>
            </table></div> : <p className="px-5 py-8 text-center text-sm text-ink-faint">No orders or settlements in this period yet.</p>}
          </section>
          <section className="panel">
            <div className="border-b border-rule px-5 py-4">
              <h2 className="text-[15px] font-semibold">Direct payments between store and Growpefy</h2>
              <p className="mt-1 text-xs text-ink-faint">Only confirmed entries reduce Growpefy's balance. The other party must enter the 6-digit code sent to their WhatsApp.</p>
            </div>
            {d.canManage && <Form method="post" className="grid gap-3 border-b border-rule p-5 sm:grid-cols-4">
              <input type="hidden" name="intent" value="createPayment" />
              <label className="block"><span className="label">Amount (₹)</span><input name="amount" type="number" min="0.01" step="0.01" required className="input" /></label>
              <label className="block"><span className="label">Payment date</span><input name="paymentDate" type="date" max={today} defaultValue={today} required className="input" /></label>
              <label className="block sm:col-span-2"><span className="label">Reference / note (optional)</span><input name="note" maxLength={200} className="input" placeholder="UPI / bank reference" /></label>
              <div className="sm:col-span-4"><SubmitButton intent="createPayment" className="btn-primary" busyText="Sending code">Record payment and send OTP</SubmitButton></div>
            </Form>}
            {d.payments.length === 0 ? <p className="px-5 py-6 text-sm text-ink-faint">No payment entries in this date range.</p> : <div className="divide-y divide-rule">
              {d.payments.map((p) => <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1"><p className="num font-semibold">{inr(p.amount)} <span className="text-xs font-normal text-ink-faint">{dateLabel(p.date)}</span></p>
                  <p className="text-xs text-ink-soft">Entered by {p.createdBy}{p.note ? " · " + p.note : ""}</p>
                  <p className={`text-xs ${p.status === "confirmed" ? "text-good" : "text-amber-700"}`}>{p.status === "confirmed" ? "Confirmed by " + (p.confirmedBy ?? "the other party") : p.expired ? "OTP expired — create a new entry to confirm" : "Waiting for " + (p.confirmRole === "admin" ? "Growpefy Super Admin" : "store") + " confirmation"}</p></div>
                {p.canConfirm && <Form method="post" className="flex items-end gap-2"><input type="hidden" name="intent" value="confirmPayment" /><input type="hidden" name="paymentId" value={p.id} />
                  <label className="block"><span className="label">6-digit OTP</span><input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required className="input w-32" /></label>
                  <SubmitButton className="btn-secondary" busyText="Confirming">Confirm</SubmitButton></Form>}
              </div>)}
            </div>}
          </section>
          <p className="text-xs text-ink-faint">{d.dropship ? "Dropship costs include product, shipping, ₹4 packing per unit, RTO charges and wallet refunds. These amounts are already GST-inclusive and are not taxed again." : "Profit share is calculated after carrying forward earlier losses. The share is set by the super admin."}</p>
        </>}
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="panel min-w-0 p-4"><p className="truncate text-xs font-medium text-ink-soft">{label}</p><p className="num mt-2 text-xl font-semibold">{value}</p><p className="mt-1 truncate text-xs text-ink-faint">{sub}</p></div>;
}

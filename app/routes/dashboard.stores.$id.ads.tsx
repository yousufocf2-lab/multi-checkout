import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { orderValueSql } from "~/lib/order-value.server";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { CostTag, EmptyState, Notice, SubmitButton } from "~/components/ui";
import { db, metaRecharges, orders } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, istToday, resolveRange } from "~/lib/dates";
import { fetchAccount, fetchInsights } from "~/lib/meta.server";
import { GST, withGst } from "~/lib/gst";
import { creditFromGross, listRecharges, rechargeTotals, recordSnapshot, watchingSince } from "~/lib/recharges.server";
import { earliestDate } from "~/lib/stats.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate([store]));
  const configured = Boolean(store.metaAdAccountId && store.metaAccessToken);

  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const [ours] = await db
    .select({ orders: sql<number>`count(*)::int`, revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)` })
    .from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from), lt(orders.createdAt, to)));
  const own = { orders: ours?.orders ?? 0, revenue: Number(ours?.revenue ?? 0) / 100 };

  const [recharges, allTime, since] = await Promise.all([listRecharges(store.id, from, to), rechargeTotals(store.id), watchingSince(store.id)]);
  const rech = recharges.map((r) => ({ id: r.id, amount: r.amountPaise / 100, credit: r.creditPaise / 100, source: r.source, note: r.note, at: r.rechargedAt.toISOString() }));
  const base = { storeId: store.id, adAccountId: store.metaAdAccountId, range, configured, own, recharges: rech, allTime, watchingSince: since, today: istToday() };

  if (!configured) return json({ ...base, meta: null });

  const metaRange = { since: range.since, until: range.until };
  const [account, insights] = await Promise.allSettled([fetchAccount(store), fetchInsights(store, metaRange)]);
  if (account.status === "fulfilled") await recordSnapshot(store, account.value).catch((e) => console.error("[recharges]", e));
  const err = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as Error)?.message ?? "Error" : null);
  return json({
    ...base,
    meta: {
      account: account.status === "fulfilled" ? account.value : null,
      accountError: err(account),
      insights: insights.status === "fulfilled" ? insights.value : null,
      insightsError: err(insights),
    },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "addRecharge") {
    const amount = Number(String(fd.get("amount") ?? "").replace(/[^\d.]/g, ""));
    const date = String(fd.get("date") ?? "");
    if (!Number.isFinite(amount) || amount <= 0) return json({ ok: null, error: "Enter the amount you paid, e.g. 1000" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > istToday()) return json({ ok: null, error: "Pick the recharge date (today or earlier)" }, { status: 400 });
    const paise = Math.round(amount * 100);
    await db.insert(metaRecharges).values({
      storeId: store.id, amountPaise: paise, creditPaise: creditFromGross(paise), source: "manual",
      note: String(fd.get("note") ?? "").trim().slice(0, 140) || null, rechargedAt: new Date(`${date}T12:00:00+05:30`),
    });
    return json({ ok: `Added a ₹${amount.toLocaleString("en-IN")} recharge`, error: null });
  }
  if (intent === "deleteRecharge") {
    await db.delete(metaRecharges).where(and(eq(metaRecharges.id, Number(fd.get("id"))), eq(metaRecharges.storeId, store.id)));
    return json({ ok: "Recharge removed", error: null });
  }
  if (intent === "checkBalance") {
    try {
      const r = await recordSnapshot(store, await fetchAccount(store), true);
      return json({ ok: r ? `New recharge found: ₹${(r.amountPaise / 100).toLocaleString("en-IN")}` : "Balance checked. No new recharge since the last check.", error: null });
    } catch (e) {
      return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't reach Meta" });
    }
  }
  return json({ ok: null, error: "Unknown action" });
}

const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));
const x = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);
const when = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default function Ads() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  if (!d.configured || !d.meta) {
    return (
      <EmptyState title="Connect your Meta ad account" action={<Link to={`/dashboard/stores/${d.storeId}/settings#meta`} className="btn-primary">Open settings</Link>}>
        Add your ad account ID and a system user token to see spend, ROAS and cost per order here.
      </EmptyState>
    );
  }
  const { meta, own } = d;
  const t = meta.insights?.totals;
  const a = meta.account;
  const realCpo = t && own.orders ? t.spend / own.orders : null;
  const realRoas = t && t.spend ? own.revenue / t.spend : null;
  const invested = a ? withGst(a.amountSpent + (a.available ?? 0)) : null;
  const low = a?.available != null && a.available < 500;
  const billingUrl = `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${d.adAccountId}`;
  const periodTotal = d.recharges.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker current={d.range} />
        <a href={billingUrl} target="_blank" rel="noreferrer" className="btn-secondary h-9 py-0"><Icon name="wallet" className="h-4 w-4" />Recharge on Meta</a>
      </div>
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      {meta.accountError && <Notice tone="error">Couldn't load the ad account: {meta.accountError}</Notice>}
      {meta.insightsError && <Notice tone="error">Couldn't load ad performance: {meta.insightsError}</Notice>}
      {low && <Notice tone="warning">Ad balance is low ({inr(a!.available, 2)}). Recharge soon so your ads don't stop.</Notice>}

      {a && (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-4">
            <div className="min-w-0"><p className="truncate font-semibold">{a.name}</p><p className="text-xs text-ink-faint">act_{d.adAccountId} · {a.currency} · {a.isPrepaid ? "Prepaid" : "Postpaid"}{a.fundingSource ? ` · ${a.fundingSource}` : ""}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${a.status === "Active" ? "bg-emerald-50 text-good" : "bg-red-50 text-bad"}`}>{a.status}</span>
          </div>
          <dl className="grid grid-cols-2 divide-rule sm:grid-cols-4 sm:divide-x">
            <Big label={a.available != null ? "Available balance" : "Amount due"} value={inr(a.available ?? a.balance, 2)} tone={low ? "text-bad" : undefined} />
            <Big label="Lifetime spend" value={inr(a.amountSpent)} sub="Without GST, as Meta shows it" />
            <Big label="Total invested" value={inr(invested)} sub={`(Lifetime spend + balance) + ${GST * 100}% GST`} highlight />
            <Big label="Spending limit" value={a.spendCap ? inr(a.spendCap) : "None"} />
          </dl>
        </section>
      )}

      {t && (
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Performance</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat label="Ad spend" value={inr(t.spend)} big />
            <Stat label="Cost per order (actual)" value={inr(realCpo)} tag={<CostTag value={realCpo} />} sub={`${own.orders} orders on your checkout`} big />
            <Stat label="ROAS (actual)" value={x(realRoas)} sub={`${inr(own.revenue)} revenue`} big />
            <Stat label="Cost per purchase (Meta)" value={inr(t.costPerPurchase)} tag={<CostTag value={t.costPerPurchase} />} sub={`${n(t.purchases)} purchases reported`} big />
            <Stat label="Purchase value (Meta)" value={inr(t.purchaseValue)} sub={`ROAS ${x(t.roas)}`} />
            <Stat label="Impressions" value={n(t.impressions)} sub={`Reach ${n(t.reach)}`} />
            <Stat label="Link clicks" value={n(t.linkClicks)} sub={`CTR ${pct(t.ctr)}`} />
            <Stat label="CPC / CPM" value={`${inr(t.cpc, 2)} / ${inr(t.cpm)}`} />
            <Stat label="Add to cart" value={n(t.addToCart)} sub={t.addToCart ? `${inr(t.spend / t.addToCart)} each` : undefined} />
            <Stat label="Checkouts started" value={n(t.initiateCheckout)} sub={t.initiateCheckout ? `${inr(t.spend / t.initiateCheckout)} each` : undefined} />
          </dl>
          <p className="mt-4 text-xs text-ink-faint">Actual figures use orders placed on your checkout (online and COD). Meta figures use Meta's attribution. Cost tags: under ₹35 excellent, ₹35–59 good, ₹60–99 average, ₹100+ poor.</p>
        </section>
      )}

      {meta.insights && (
        <div className="panel overflow-x-auto">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Campaigns</h2>
          <table className="table num min-w-[760px]">
            <thead><tr><th>Campaign</th><th className="text-right">Spend</th><th className="text-right">Purchases</th><th className="text-right">Cost per purchase</th><th className="text-right">ROAS</th><th className="text-right">CTR</th><th className="text-right">CPC</th></tr></thead>
            <tbody>
              {meta.insights.campaigns.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-faint">No spend in this period</td></tr>}
              {meta.insights.campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-[280px]"><p className="truncate font-medium" title={c.name}>{c.name}</p></td>
                  <td className="text-right">{inr(c.spend)}</td><td className="text-right">{n(c.purchases)}</td>
                  <td className="text-right font-medium"><span className="inline-flex items-center justify-end gap-1.5">{inr(c.costPerPurchase)}<CostTag value={c.costPerPurchase} /></span></td>
                  <td className="text-right">{x(c.roas)}</td>
                  <td className="text-right">{pct(c.ctr)}</td><td className="text-right">{inr(c.cpc, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Recharges</h2>
            <p className="mt-0.5 max-w-prose text-sm text-ink-soft">
              Meta doesn't share prepaid recharges, so we spot them from balance changes and add the {GST * 100}% GST back. Example: ₹847 credit = ₹1,000 recharge.
              {d.watchingSince ? ` Watching since ${new Date(d.watchingSince).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}.` : ""}
            </p>
          </div>
          <Form method="post"><SubmitButton intent="checkBalance" className="btn-secondary py-2" busyText="Checking">Check balance now</SubmitButton></Form>
        </div>

        <div className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
          <Mini label="Recharged in this period" value={inr(periodTotal)} />
          <Mini label="GST in this period" value={inr(periodTotal - periodTotal / (1 + GST))} />
          <Mini label="Ad credit in this period" value={inr(periodTotal / (1 + GST))} />
          <Mini label="All recorded recharges" value={inr(d.allTime.amount)} sub={`${d.allTime.count} recharge${d.allTime.count === 1 ? "" : "s"}`} />
        </div>

        <Form method="post" className="grid gap-3 border-b border-t border-rule bg-paper/50 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end" key={d.allTime.count}>
          <label className="block"><span className="label">Amount paid (₹, with GST)</span><input name="amount" inputMode="decimal" placeholder="1000" className="input num" required /></label>
          <label className="block"><span className="label">Date</span><input name="date" type="date" max={d.today} defaultValue={d.today} className="input" required /></label>
          <label className="block"><span className="label">Note (optional)</span><input name="note" maxLength={140} placeholder="UPI, invoice number…" className="input" /></label>
          <SubmitButton intent="addRecharge" busyText="Adding"><Icon name="plus" className="h-4 w-4" />Add past recharge</SubmitButton>
        </Form>

        {d.recharges.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">No recharges in this period. Change the date range or add a past recharge above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table num min-w-[680px]">
              <thead><tr><th>Date</th><th className="text-right">Recharge</th><th className="text-right">GST ({GST * 100}%)</th><th className="text-right">Ad credit</th><th>Source</th><th /></tr></thead>
              <tbody>
                {d.recharges.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{when(r.at)}{r.note && <p className="max-w-[240px] truncate text-xs text-ink-faint" title={r.note}>{r.note}</p>}</td>
                    <td className="text-right font-semibold">{inr(r.amount)}</td>
                    <td className="text-right text-ink-soft">{inr(r.amount - r.credit, 2)}</td>
                    <td className="text-right">{inr(r.credit, 2)}</td>
                    <td><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${r.source === "auto" ? "bg-sky-50 text-sky-800" : "bg-paper-sunk text-ink-soft"}`}>{r.source === "auto" ? "Auto detected" : "Added by you"}</span></td>
                    <td className="text-right">
                      <Form method="post" onSubmit={(e) => { if (!window.confirm("Remove this recharge?")) e.preventDefault(); }}>
                        <input type="hidden" name="id" value={r.id} />
                        <button name="intent" value="deleteRecharge" className="btn-danger" aria-label="Remove recharge"><Icon name="trash" className="h-4 w-4" /></button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Big({ label, value, sub, highlight, tone }: { label: string; value: string; sub?: string; highlight?: boolean; tone?: string }) {
  return (
    <div className={`min-w-0 border-b border-rule px-5 py-4 sm:border-b-0 ${highlight ? "bg-pine-tint/60" : ""}`}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`num mt-1 truncate text-xl font-semibold ${tone ?? (highlight ? "text-pine" : "")}`}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-[11px] text-ink-faint" title={sub}>{sub}</dd>}
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface px-5 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="num mt-0.5 font-semibold">{value}</p>
      {sub && <p className="text-[11px] text-ink-faint">{sub}</p>}
    </div>
  );
}

function Stat({ label, value, sub, big, tag }: { label: string; value: string; sub?: string; big?: boolean; tag?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`num mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-semibold ${big ? "text-xl" : "text-base"}`}>{value}{tag}</dd>
      {sub && <dd className="mt-0.5 truncate text-xs text-ink-faint" title={sub}>{sub}</dd>}
    </div>
  );
}

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { RangePicker } from "~/components/Overview";
import { EmptyState, Notice } from "~/components/ui";
import { db, orders } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, resolveRange } from "~/lib/dates";
import { fetchAccount, fetchInsights, fetchRecharges } from "~/lib/meta.server";
import { earliestDate } from "~/lib/stats.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate([store]));
  const configured = Boolean(store.metaAdAccountId && store.metaAccessToken);

  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const [ours] = await db
    .select({ orders: sql<number>`count(*)::int`, revenue: sql<string>`coalesce(sum(coalesce(${orders.amountPaid}, ${orders.total})), 0)` })
    .from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from), lt(orders.createdAt, to)));
  const own = { orders: ours?.orders ?? 0, revenue: Number(ours?.revenue ?? 0) / 100 };

  if (!configured) return json({ storeId: store.id, range, configured, own, meta: null });

  const metaRange = { since: range.since, until: range.until };
  const [account, insights, recharges] = await Promise.allSettled([fetchAccount(store), fetchInsights(store, metaRange), fetchRecharges(store, metaRange)]);
  const err = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as Error)?.message ?? "Error" : null);
  return json({
    storeId: store.id, range, configured, own,
    meta: {
      account: account.status === "fulfilled" ? account.value : null,
      accountError: err(account),
      insights: insights.status === "fulfilled" ? insights.value : null,
      insightsError: err(insights),
      recharges: recharges.status === "fulfilled" ? recharges.value : { items: [], source: "none", note: err(recharges) ?? undefined },
    },
  });
}

const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));
const x = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

export default function Ads() {
  const d = useLoaderData<typeof loader>();
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

  return (
    <div className="space-y-5">
      <RangePicker current={d.range} />
      {meta.accountError && <Notice tone="error">Couldn't load the ad account: {meta.accountError}</Notice>}
      {meta.insightsError && <Notice tone="error">Couldn't load ad performance: {meta.insightsError}</Notice>}

      {a && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-semibold">{a.name}</p><p className="text-xs text-ink-faint">{a.id}, {a.currency}, {a.timezone}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${a.status === "Active" ? "bg-emerald-50 text-good" : "bg-red-50 text-bad"}`}>{a.status}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={a.isPrepaid ? "Prepaid balance" : "Unbilled amount"} value={inr(a.balance)} />
            <Stat label="Lifetime spend" value={inr(a.amountSpent)} />
            <Stat label="Spending limit" value={a.spendCap ? inr(a.spendCap) : "None"} />
            <Stat label="Payment" value={a.isPrepaid ? "Prepaid" : "Postpaid"} sub={a.fundingSource ?? undefined} />
          </dl>
        </section>
      )}

      {t && (
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Performance</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat label="Ad spend" value={inr(t.spend)} big />
            <Stat label="Cost per order (actual)" value={inr(realCpo)} sub={`${own.orders} orders on your checkout`} big />
            <Stat label="ROAS (actual)" value={x(realRoas)} sub={`${inr(own.revenue)} revenue`} big />
            <Stat label="Cost per purchase (Meta)" value={inr(t.costPerPurchase)} sub={`${n(t.purchases)} purchases reported`} big />
            <Stat label="Purchase value (Meta)" value={inr(t.purchaseValue)} sub={`ROAS ${x(t.roas)}`} />
            <Stat label="Impressions" value={n(t.impressions)} sub={`Reach ${n(t.reach)}`} />
            <Stat label="Link clicks" value={n(t.linkClicks)} sub={`CTR ${pct(t.ctr)}`} />
            <Stat label="CPC / CPM" value={`${inr(t.cpc, 2)} / ${inr(t.cpm)}`} />
            <Stat label="Add to cart" value={n(t.addToCart)} sub={t.addToCart ? `${inr(t.spend / t.addToCart)} each` : undefined} />
            <Stat label="Checkouts started" value={n(t.initiateCheckout)} sub={t.initiateCheckout ? `${inr(t.spend / t.initiateCheckout)} each` : undefined} />
          </dl>
          <p className="mt-4 text-xs text-ink-faint">Actual figures use orders placed on your checkout (online and COD). Meta figures use Meta's attribution.</p>
        </section>
      )}

      {meta.insights && (
        <div className="panel overflow-x-auto">
          <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Campaigns</h2>
          <table className="table num min-w-[720px]">
            <thead><tr><th>Campaign</th><th className="text-right">Spend</th><th className="text-right">Purchases</th><th className="text-right">Cost per purchase</th><th className="text-right">ROAS</th><th className="text-right">CTR</th><th className="text-right">CPC</th></tr></thead>
            <tbody>
              {meta.insights.campaigns.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-faint">No spend in this period</td></tr>}
              {meta.insights.campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-[280px]"><p className="truncate font-medium" title={c.name}>{c.name}</p></td>
                  <td className="text-right">{inr(c.spend)}</td><td className="text-right">{n(c.purchases)}</td>
                  <td className="text-right font-medium">{inr(c.costPerPurchase)}</td><td className="text-right">{x(c.roas)}</td>
                  <td className="text-right">{pct(c.ctr)}</td><td className="text-right">{inr(c.cpc, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <h2 className="text-[15px] font-semibold">Recharges and billing</h2>
          {meta.recharges.items.length > 0 && <span className="num text-sm font-medium">Total {inr(meta.recharges.items.reduce((s, r) => s + (r.amount ?? 0), 0))}</span>}
        </div>
        {meta.recharges.note && <p className="px-5 pt-3 text-xs text-warn">{meta.recharges.note}</p>}
        <table className="table num min-w-[520px]">
          <thead><tr><th>Date</th><th>Type</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {meta.recharges.items.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-ink-faint">No recharges in this period</td></tr>}
            {meta.recharges.items.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap">{r.time ? new Date(r.time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td>
                <td>{r.label}</td><td className="text-right font-medium">{inr(r.amount, 2)}</td><td className="text-xs">{r.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`num mt-1 truncate font-semibold ${big ? "text-xl" : "text-base"}`}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-xs text-ink-faint" title={sub}>{sub}</dd>}
    </div>
  );
}

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, orders, stores } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { PRESETS, addDays, eachDay, resolveRange } from "~/lib/dates";
import { fetchAccount, fetchInsights, fetchRecharges } from "~/lib/meta.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const [store] = await db.select().from(stores).where(eq(stores.id, Number(params.id))).limit(1);
  if (!store) throw new Response("Store not found", { status: 404 });

  const url = new URL(request.url);
  const range = resolveRange(url.searchParams.get("preset"), url.searchParams.get("since"), url.searchParams.get("until"));
  const configured = Boolean(store.metaAdAccountId && store.metaAccessToken);

  // Our own checkout orders in the same IST range
  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const day = sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const ourRows = await db
    .select({
      day,
      method: orders.paymentMethod,
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(coalesce(${orders.amountPaid}, ${orders.total})), 0)::bigint`,
    })
    .from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from), lt(orders.createdAt, to)))
    .groupBy(day, orders.paymentMethod);

  const ours = { orders: 0, prepaid: 0, cod: 0, revenue: 0, prepaidRevenue: 0, codRevenue: 0 };
  const oursByDay = new Map<string, { orders: number; revenue: number }>();
  for (const r of ourRows) {
    const rev = Number(r.revenue) / 100;
    ours.orders += r.count;
    ours.revenue += rev;
    if (r.method === "cod") { ours.cod += r.count; ours.codRevenue += rev; }
    else { ours.prepaid += r.count; ours.prepaidRevenue += rev; }
    const d = oursByDay.get(r.day) ?? { orders: 0, revenue: 0 };
    d.orders += r.count; d.revenue += rev;
    oursByDay.set(r.day, d);
  }

  if (!configured) {
    return json({ store: { id: store.id, name: store.name }, range, configured, ours, meta: null });
  }

  const [account, insights, recharges] = await Promise.allSettled([
    fetchAccount(store),
    fetchInsights(store, range),
    fetchRecharges(store, range),
  ]);
  const err = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as Error)?.message ?? "Error" : null);

  const ins = insights.status === "fulfilled" ? insights.value : null;
  const metaByDay = new Map((ins?.daily ?? []).map((d) => [d.date, d]));
  const daily = eachDay(range.since, range.until).reverse().map((date) => {
    const m = metaByDay.get(date);
    const o = oursByDay.get(date) ?? { orders: 0, revenue: 0 };
    return {
      date,
      spend: m?.spend ?? 0,
      metaPurchases: m?.purchases ?? 0,
      costPerPurchase: m?.costPerPurchase ?? null,
      orders: o.orders,
      revenue: o.revenue,
      costPerOrder: o.orders > 0 && m ? m.spend / o.orders : null,
    };
  });

  return json({
    store: { id: store.id, name: store.name },
    range,
    configured,
    ours,
    meta: {
      account: account.status === "fulfilled" ? account.value : null,
      accountError: err(account),
      totals: ins?.totals ?? null,
      campaigns: ins?.campaigns ?? [],
      insightsError: err(insights),
      daily,
      recharges: recharges.status === "fulfilled" ? recharges.value : { items: [], source: "none", note: err(recharges) ?? undefined },
    },
  });
}

// ======================= UI =======================

const inr = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));
const x = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

export default function Ads() {
  const d = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const loading = nav.state === "loading";

  return (
    <div className={loading ? "opacity-60 transition" : "transition"}>
      <Link to={`/admin/stores/${d.store.id}`} className="text-sm text-gray-500">← {d.store.name}</Link>
      <h1 className="mt-2 text-xl font-bold">Facebook Ads</h1>

      {/* Range picker */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {PRESETS.filter((p) => p.id !== "custom").map((p) => (
          <Link key={p.id} to={`?preset=${p.id}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${d.range.preset === p.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white"}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <Form method="get" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="preset" value="custom" />
        <label className="text-xs text-gray-600">From<input type="date" name="since" defaultValue={d.range.since} className="input mt-1 py-2" /></label>
        <label className="text-xs text-gray-600">To<input type="date" name="until" defaultValue={d.range.until} className="input mt-1 py-2" /></label>
        <button className="btn-ghost">Apply</button>
        <span className="pb-2.5 text-xs text-gray-500">{d.range.since} → {d.range.until} (IST)</span>
      </Form>

      {!d.configured || !d.meta ? (
        <div className="card mt-5 space-y-2 text-sm">
          <p className="font-semibold">Ad account abhi connect nahi hai</p>
          <p className="text-gray-600">Store Settings → <b>Facebook / Meta</b> mein Ad account ID aur System User access token daalo.</p>
          <Link to={`/admin/stores/${d.store.id}?tab=settings`} className="btn-primary mt-2">Settings kholo</Link>
          <OursCard ours={d.ours} />
        </div>
      ) : (
        <Dashboard d={d as Required<typeof d> & { meta: NonNullable<typeof d.meta> }} />
      )}
    </div>
  );
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

function Dashboard({ d }: { d: D & { meta: NonNullable<D["meta"]> } }) {
  const { meta, ours } = d;
  const t = meta.totals;
  const realCpo = t && ours.orders > 0 ? t.spend / ours.orders : null;
  const realRoas = t && t.spend > 0 ? ours.revenue / t.spend : null;
  const a = meta.account;
  const maxSpend = Math.max(1, ...meta.daily.map((r) => r.spend));

  return (
    <div className="mt-5 space-y-5">
      {/* Account */}
      {a ? (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-gray-500">{a.id} · {a.currency} · {a.timezone}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${a.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{a.status}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={a.isPrepaid ? "Prepaid balance" : "Unbilled balance"} value={inr(a.balance)} />
            <Stat label="Lifetime spent" value={inr(a.amountSpent)} />
            <Stat label="Spend cap" value={a.spendCap ? inr(a.spendCap) : "None"} />
            <Stat label="Payment" value={a.isPrepaid ? "Prepaid" : "Postpaid"} sub={a.fundingSource ?? undefined} />
          </div>
          {a.disableReason && a.disableReason !== "0" && <p className="mt-3 text-xs text-red-600">Disable reason: {a.disableReason}</p>}
        </section>
      ) : (
        <ErrorBox msg={`Account: ${meta.accountError}`} />
      )}

      {/* KPIs */}
      {meta.insightsError && <ErrorBox msg={`Insights: ${meta.insightsError}`} />}
      {t && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Performance</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi label="Ad spend" value={inr(t.spend)} strong />
            <Kpi label="Cost per purchase (Meta)" value={inr(t.costPerPurchase)} strong />
            <Kpi label="Real cost per order" value={inr(realCpo)} sub={`${ours.orders} checkout orders`} strong />
            <Kpi label="Real ROAS" value={x(realRoas)} sub={`Revenue ${inr(ours.revenue)}`} strong />
            <Kpi label="Purchases (Meta)" value={n(t.purchases)} />
            <Kpi label="Purchase value (Meta)" value={inr(t.purchaseValue)} />
            <Kpi label="ROAS (Meta)" value={x(t.roas)} />
            <Kpi label="Prepaid / COD orders" value={`${ours.prepaid} / ${ours.cod}`} sub={`${inr(ours.prepaidRevenue)} / ${inr(ours.codRevenue)}`} />
            <Kpi label="Impressions" value={n(t.impressions)} sub={`Reach ${n(t.reach)}`} />
            <Kpi label="Link clicks" value={n(t.linkClicks)} sub={`All clicks ${n(t.clicks)}`} />
            <Kpi label="CTR" value={pct(t.ctr)} />
            <Kpi label="CPC / CPM" value={`${inr(t.cpc, 2)} / ${inr(t.cpm, 0)}`} />
            <Kpi label="Add to cart" value={n(t.addToCart)} sub={t.addToCart ? `${inr(t.spend / t.addToCart, 0)} each` : undefined} />
            <Kpi label="Initiate checkout" value={n(t.initiateCheckout)} sub={t.initiateCheckout ? `${inr(t.spend / t.initiateCheckout, 0)} each` : undefined} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            “Real” numbers is checkout ke actual orders (paid + COD) se nikalte hain; Meta wale numbers attribution pe based hain.
          </p>
        </section>
      )}

      {/* Daily */}
      <section className="card overflow-x-auto p-0">
        <h2 className="p-4 pb-2 font-semibold">Day-wise</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-y border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="p-3">Date</th><th className="p-3">Spend</th><th className="p-3">Meta purch.</th><th className="p-3">CPP (Meta)</th><th className="p-3">Orders</th><th className="p-3">Revenue</th><th className="p-3">Real CPO</th></tr>
          </thead>
          <tbody>
            {meta.daily.map((r) => (
              <tr key={r.date} className="border-b border-gray-100 last:border-0">
                <td className="whitespace-nowrap p-3">{new Date(`${r.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short" })}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-20">{inr(r.spend)}</span>
                    <span className="hidden h-2 rounded bg-blue-500 sm:block" style={{ width: `${(r.spend / maxSpend) * 80}px` }} />
                  </div>
                </td>
                <td className="p-3">{n(r.metaPurchases)}</td>
                <td className="p-3">{inr(r.costPerPurchase)}</td>
                <td className="p-3">{r.orders}</td>
                <td className="p-3">{inr(r.revenue)}</td>
                <td className="p-3 font-medium">{inr(r.costPerOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Campaigns */}
      <section className="card overflow-x-auto p-0">
        <h2 className="p-4 pb-2 font-semibold">Campaigns</h2>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-y border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="p-3">Campaign</th><th className="p-3">Spend</th><th className="p-3">Purchases</th><th className="p-3">CPP</th><th className="p-3">ROAS</th><th className="p-3">CTR</th><th className="p-3">CPC</th></tr>
          </thead>
          <tbody>
            {meta.campaigns.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-500">Is range mein koi spend nahi</td></tr>}
            {meta.campaigns.map((c) => (
              <tr key={c.id} className="border-b border-gray-100 last:border-0">
                <td className="max-w-[260px] p-3"><p className="truncate font-medium" title={c.name}>{c.name}</p></td>
                <td className="p-3">{inr(c.spend)}</td>
                <td className="p-3">{n(c.purchases)}</td>
                <td className="p-3 font-medium">{inr(c.costPerPurchase)}</td>
                <td className="p-3">{x(c.roas)}</td>
                <td className="p-3">{pct(c.ctr)}</td>
                <td className="p-3">{inr(c.cpc, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Recharges */}
      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="font-semibold">Recharges / billing</h2>
          {meta.recharges.items.length > 0 && (
            <span className="text-sm font-medium">
              Total {inr(meta.recharges.items.reduce((s, r) => s + (r.amount ?? 0), 0))}
            </span>
          )}
        </div>
        {meta.recharges.note && <p className="px-4 pb-2 text-xs text-amber-700">{meta.recharges.note}</p>}
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-y border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {meta.recharges.items.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-gray-500">Is range mein koi recharge/charge nahi mila</td></tr>}
            {meta.recharges.items.map((r, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0">
                <td className="whitespace-nowrap p-3">{r.time ? new Date(r.time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td>
                <td className="p-3">{r.label}</td>
                <td className="p-3 font-medium">{inr(r.amount, 2)}</td>
                <td className="p-3 text-xs">{r.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function OursCard({ ours }: { ours: D["ours"] }) {
  return (
    <p className="pt-3 text-gray-600">
      Is range mein checkout orders: <b>{ours.orders}</b> ({ours.prepaid} prepaid, {ours.cod} COD) · Revenue {inr(ours.revenue)}
    </p>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
      {sub && <p className="truncate text-[11px] text-gray-500" title={sub}>{sub}</p>}
    </div>
  );
}

function Kpi({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${strong ? "border-gray-900/15 bg-white" : "border-gray-200 bg-white"}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 ${strong ? "text-xl" : "text-lg"} font-bold`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string | null }) {
  return <p className="break-words rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</p>;
}

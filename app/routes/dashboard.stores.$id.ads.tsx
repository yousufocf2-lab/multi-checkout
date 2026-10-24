import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { AdIcon, AdLogo } from "~/components/AdLogos";
import { RevenueChart } from "~/components/charts";
import { Icon } from "~/components/Icons";
import { AdsVersus, RangePicker } from "~/components/Overview";
import { CostTag, Notice, SubmitButton } from "~/components/ui";
import { db, metaRecharges, orders, stores } from "~/db.server";
import { metaReady } from "~/lib/ads.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { addDays, istToday, resolveRange } from "~/lib/dates";
import {
  createConversionAction, fetchAccount as googleAccount, fetchInsights as googleInsights, formatCid, googleAppReady,
  listAccounts, listConversionActions, revoke,
} from "~/lib/google-ads.server";
import { fetchAccount, fetchInsights } from "~/lib/meta.server";
import { GST, withGst } from "~/lib/gst";
import { orderValueSql } from "~/lib/order-value.server";
import { creditFromGross, listRecharges, rechargeTotals, recordSnapshot, watchingSince } from "~/lib/recharges.server";
import { earliestDate, loadOverview } from "~/lib/stats.server";

type Channel = "all" | "meta" | "google";
type CampaignAll = { platform: "meta" | "google"; id: string; name: string; channel: string; spend: number; purchases: number; cpp: number | null; roas: number | null; ctr: number; cpc: number };
type RechargeRow = { id: number; amount: number; credit: number; source: string; note: string | null; at: string };
type Picker = { accounts: Awaited<ReturnType<typeof listAccounts>>; actions: Awaited<ReturnType<typeof listConversionActions>> | null; error: string | null };
type MetaData = { account: Awaited<ReturnType<typeof fetchAccount>> | null; accountError: string | null; insights: Awaited<ReturnType<typeof fetchInsights>> | null; insightsError: string | null };
type GoogleData = { account: Awaited<ReturnType<typeof googleAccount>> | null; accountError: string | null; insights: Awaited<ReturnType<typeof googleInsights>> | null; insightsError: string | null };
type AllData = { buckets: Awaited<ReturnType<typeof loadOverview>>["buckets"]; granularity: string; totals: Awaited<ReturnType<typeof loadOverview>>["totals"]; ads: Awaited<ReturnType<typeof loadOverview>>["ads"]; adErrors: { store: string; error: string }[] };
const EMPTY = {
  all: null as AllData | null, allError: null as string | null, campaigns: [] as CampaignAll[], metaInsightsError: null as string | null, googleInsightsError: null as string | null,
  meta: null as MetaData | null, googleData: null as GoogleData | null, picker: null as Picker | null,
  recharges: [] as RechargeRow[], allTime: { amount: 0, count: 0 }, watchingSince: null as string | null,
};
const errOf = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as Error)?.message ?? "Error" : null);
const valOf = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const url = new URL(request.url);
  const range = resolveRange(url.searchParams, await earliestDate([store]));
  const metaOn = metaReady(store);
  const gConnected = Boolean(store.googleRefreshToken);
  const gReady = gConnected && Boolean(store.googleAdsCustomerId);
  const ch = (["meta", "google"].includes(url.searchParams.get("ch") ?? "") ? url.searchParams.get("ch") : "all") as Channel;

  const from = new Date(`${range.since}T00:00:00+05:30`);
  const to = new Date(`${addDays(range.until, 1)}T00:00:00+05:30`);
  const [ours] = await db
    .select({ orders: sql<number>`count(*)::int`, revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)` })
    .from(orders)
    .where(and(eq(orders.storeId, store.id), inArray(orders.status, ["paid", "cod_placed"]), gte(orders.createdAt, from), lt(orders.createdAt, to)));
  const own = { orders: ours?.orders ?? 0, revenue: Number(ours?.revenue ?? 0) / 100 };
  const metaRange = { since: range.since, until: range.until };

  const google = {
    appReady: googleAppReady(), connected: gConnected, ready: gReady, email: store.googleAccountEmail,
    customerId: store.googleAdsCustomerId, customerLabel: formatCid(store.googleAdsCustomerId),
    conversionAction: store.googleConversionActionName, hasConversion: Boolean(store.googleConversionAction),
    tagId: store.googleTagId ?? "", tagLabel: store.googleTagLabel ?? "", fireCod: store.googleFireCod,
  };
  const base = { storeId: store.id, ch, range, own, metaOn, adAccountId: store.metaAdAccountId, google, today: istToday() };

  if (ch === "all") {
    const [overview, mIns, gIns] = await Promise.allSettled([
      loadOverview([store], range),
      metaOn ? fetchInsights(store, metaRange) : Promise.resolve(null),
      gReady ? googleInsights(store, metaRange) : Promise.resolve(null),
    ]);
    const ov = valOf(overview);
    const campaigns: CampaignAll[] = [
      ...(valOf(mIns)?.campaigns ?? []).map((c) => ({ platform: "meta" as const, id: `m${c.id}`, name: c.name, channel: "", spend: c.spend, purchases: c.purchases, cpp: c.costPerPurchase, roas: c.roas, ctr: c.ctr, cpc: c.cpc })),
      ...(valOf(gIns)?.campaigns ?? []).map((c) => ({ platform: "google" as const, id: `g${c.id}`, name: c.name, channel: c.channel, spend: c.spend, purchases: c.purchases, cpp: c.costPerPurchase, roas: c.roas, ctr: c.ctr, cpc: c.cpc })),
    ].sort((a, b) => b.spend - a.spend);
    return json({
      ...base, ...EMPTY,
      all: ov ? { buckets: ov.buckets, granularity: ov.granularity, totals: ov.totals, ads: ov.ads, adErrors: ov.adErrors } : null,
      allError: errOf(overview), campaigns, metaInsightsError: errOf(mIns), googleInsightsError: errOf(gIns),
    });
  }

  if (ch === "meta") {
    const [recharges, allTime, since] = await Promise.all([listRecharges(store.id, from, to), rechargeTotals(store.id), watchingSince(store.id)]);
    const rech: RechargeRow[] = recharges.map((r) => ({ id: r.id, amount: r.amountPaise / 100, credit: r.creditPaise / 100, source: r.source, note: r.note, at: r.rechargedAt.toISOString() }));
    let meta: MetaData | null = null;
    if (metaOn) {
      const [account, insights] = await Promise.allSettled([fetchAccount(store), fetchInsights(store, metaRange)]);
      if (account.status === "fulfilled") await recordSnapshot(store, account.value).catch((e) => console.error("[recharges]", e));
      meta = { account: valOf(account), accountError: errOf(account), insights: valOf(insights), insightsError: errOf(insights) };
    }
    return json({ ...base, ...EMPTY, meta, recharges: rech, allTime, watchingSince: since ? new Date(since).toISOString() : null });
  }

  // google
  let picker: Picker | null = null;
  let googleData: GoogleData | null = null;
  if (gConnected && (!gReady || url.searchParams.get("pick") === "account")) {
    try { picker = { accounts: await listAccounts(store.googleRefreshToken!), actions: null, error: null }; }
    catch (e) { picker = { accounts: [], actions: null, error: (e as Error).message }; }
  } else if (gReady) {
    const [account, insights, actions] = await Promise.allSettled([
      googleAccount(store), googleInsights(store, metaRange),
      !store.googleConversionAction || url.searchParams.get("pick") === "conversion" ? listConversionActions(store) : Promise.resolve(null),
    ]);
    googleData = { account: valOf(account), accountError: errOf(account), insights: valOf(insights), insightsError: errOf(insights) };
    if (actions.status === "fulfilled" && actions.value) picker = { accounts: [], actions: actions.value, error: null };
    else if (actions.status === "rejected") picker = { accounts: [], actions: [], error: errOf(actions) };
  }
  return json({ ...base, ...EMPTY, googleData, picker });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = fd.get("intent");
  const ok = (msg: string) => json({ ok: msg, error: null });
  const bad = (msg: string, status = 400) => json({ ok: null, error: msg }, { status });

  if (intent === "addRecharge") {
    const amount = Number(String(fd.get("amount") ?? "").replace(/[^\d.]/g, ""));
    const date = String(fd.get("date") ?? "");
    if (!Number.isFinite(amount) || amount <= 0) return bad("Enter the amount you paid, e.g. 1000");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > istToday()) return bad("Pick the recharge date (today or earlier)");
    const paise = Math.round(amount * 100);
    await db.insert(metaRecharges).values({
      storeId: store.id, amountPaise: paise, creditPaise: creditFromGross(paise), source: "manual",
      note: String(fd.get("note") ?? "").trim().slice(0, 140) || null, rechargedAt: new Date(`${date}T12:00:00+05:30`),
    });
    return ok(`Added a ₹${amount.toLocaleString("en-IN")} recharge`);
  }
  if (intent === "deleteRecharge") {
    await db.delete(metaRecharges).where(and(eq(metaRecharges.id, Number(fd.get("id"))), eq(metaRecharges.storeId, store.id)));
    return ok("Recharge removed");
  }
  if (intent === "checkBalance") {
    try {
      const r = await recordSnapshot(store, await fetchAccount(store), true);
      return ok(r ? `New recharge found: ₹${(r.amountPaise / 100).toLocaleString("en-IN")}` : "Balance checked. No new recharge since the last check.");
    } catch (e) { return bad(e instanceof Error ? e.message : "Couldn't reach Meta"); }
  }

  // ---- Google ----
  if (intent === "googlePick") {
    if (!store.googleRefreshToken) return bad("Connect Google first");
    const id = String(fd.get("customerId") ?? "").replace(/\D/g, "");
    try {
      const opt = (await listAccounts(store.googleRefreshToken)).find((a) => a.id === id && !a.manager);
      if (!opt) return bad("That ad account isn't available to this Google login");
      await db.update(stores).set({
        googleAdsCustomerId: opt.id, googleLoginCustomerId: opt.loginCustomerId,
        ...(opt.id !== store.googleAdsCustomerId ? { googleConversionAction: null, googleConversionActionName: null } : {}),
      }).where(eq(stores.id, store.id));
      return ok(`${opt.name} connected`);
    } catch (e) { return bad((e as Error).message); }
  }
  if (intent === "googleConversion") {
    const res = String(fd.get("action") ?? "");
    try {
      const a = (await listConversionActions(store)).find((x) => x.resource === res);
      if (!a) return bad("Pick a conversion action from the list");
      await db.update(stores).set({ googleConversionAction: a.resource, googleConversionActionName: a.name }).where(eq(stores.id, store.id));
      return ok(`Purchases will be sent to "${a.name}"`);
    } catch (e) { return bad((e as Error).message); }
  }
  if (intent === "googleCreateConversion") {
    try {
      const a = await createConversionAction(store);
      await db.update(stores).set({ googleConversionAction: a.resource, googleConversionActionName: a.name }).where(eq(stores.id, store.id));
      return ok(`Created "${a.name}" in Google Ads. Purchases from ad clicks will be sent there.`);
    } catch (e) { return bad((e as Error).message); }
  }
  if (intent === "googleStopConversion") {
    await db.update(stores).set({ googleConversionAction: null, googleConversionActionName: null }).where(eq(stores.id, store.id));
    return ok("Stopped sending purchases to Google Ads");
  }
  if (intent === "googleTag") {
    const tagId = String(fd.get("tagId") ?? "").trim().toUpperCase().replace(/\s/g, "");
    const tagLabel = String(fd.get("tagLabel") ?? "").trim().replace(/\s/g, "");
    if (tagId && !/^AW-\d{6,14}$/.test(tagId)) return bad("Conversion ID looks like AW-123456789");
    if (tagId && !/^[\w-]{4,60}$/.test(tagLabel)) return bad("Add the conversion label too (from the same tag)");
    await db.update(stores).set({ googleTagId: tagId || null, googleTagLabel: tagId ? tagLabel : null, googleFireCod: fd.get("fireCod") === "on" }).where(eq(stores.id, store.id));
    return ok("Google conversion settings saved");
  }
  if (intent === "googleDisconnect") {
    if (store.googleRefreshToken) await revoke(store.googleRefreshToken);
    await db.update(stores).set({
      googleRefreshToken: null, googleAccountEmail: null, googleAdsCustomerId: null, googleLoginCustomerId: null,
      googleConversionAction: null, googleConversionActionName: null,
    }).where(eq(stores.id, store.id));
    return ok("Google Ads disconnected");
  }
  return bad("Unknown action");
}

const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));
const x = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}x`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);
const when = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

type D = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Ads() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [sp] = useSearchParams();
  const tab = (c: Channel) => { const p = new URLSearchParams(sp); p.delete("pick"); if (c === "all") p.delete("ch"); else p.set("ch", c); return `?${p}`; };
  const tabs: { id: Channel; label: React.ReactNode; on: boolean | null }[] = [
    { id: "all", label: <span className="flex items-center gap-1.5"><AdIcon p="meta" className="h-3.5 w-auto" /><AdIcon p="google" className="h-3.5 w-auto" />All ads</span>, on: null },
    { id: "meta", label: <AdLogo p="meta" className="h-[18px] w-auto" />, on: d.metaOn },
    { id: "google", label: <AdLogo p="google" className="h-[18px] w-auto" text="text-[15px]" />, on: d.google.ready },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-xl border border-rule bg-surface p-1 shadow-sm" aria-label="Ad platforms">
          {tabs.map((t) => (
            <Link key={t.id} to={tab(t.id)} preventScrollReset aria-current={d.ch === t.id ? "page" : undefined}
              className={`relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${d.ch === t.id ? "bg-paper-sunk text-ink shadow-[inset_0_0_0_1px_rgb(var(--rule-strong))]" : "text-ink-soft hover:bg-paper hover:text-ink"}`}>
              {t.label}
              {t.on != null && <span className={`h-1.5 w-1.5 rounded-full ${t.on ? "bg-emerald-500" : "bg-rule-strong"}`} title={t.on ? "Connected" : "Not connected"} />}
            </Link>
          ))}
        </nav>
        <RangePicker current={d.range} align="right" />
      </div>
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}
      {sp.get("gerr") && <Notice tone="error">Couldn't connect Google: {sp.get("gerr")}</Notice>}
      {d.ch === "all" && <AllTab d={d} />}
      {d.ch === "meta" && <MetaTab d={d} />}
      {d.ch === "google" && <GoogleTab d={d} />}
    </div>
  );
}

// ---------------- All ads ----------------

function AllTab({ d }: { d: D }) {
  if (!d.metaOn && !d.google.ready) {
    return (
      <div className="panel px-6 py-12 text-center">
        <div className="flex justify-center gap-4"><AdLogo p="meta" className="h-7 w-auto" /><AdLogo p="google" className="h-7 w-auto" text="text-xl" /></div>
        <p className="mt-5 font-semibold">Connect Meta or Google Ads</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">See spend, cost per order and ROAS from both platforms in one place, and which one is doing better.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="?ch=meta" className="btn-secondary"><AdIcon p="meta" className="h-4 w-auto" />Set up Meta</Link>
          <Link to="?ch=google" className="btn-secondary"><AdIcon p="google" className="h-4 w-auto" />Set up Google Ads</Link>
        </div>
      </div>
    );
  }
  const a = d.all;
  const t = a?.totals;
  const cpo = t && t.adSpend != null && d.own.orders ? t.adSpend / d.own.orders : null;
  return (
    <>
      {d.allError && <Notice tone="error">Couldn't load ad totals: {d.allError}</Notice>}
      {a?.adErrors.map((e) => <Notice key={e.store} tone="warning">{e.store}: {e.error}</Notice>)}
      {t && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total ad spend" value={inr(t.adSpend)} sub={<span className="inline-flex flex-wrap items-center gap-2">{t.metaSpend != null && <span className="inline-flex items-center gap-1"><AdIcon p="meta" className="h-3 w-auto" />{inr(t.metaSpend)}</span>}{t.googleSpend != null && <span className="inline-flex items-center gap-1"><AdIcon p="google" className="h-3 w-auto" />{inr(t.googleSpend)}</span>}</span>} />
          <Kpi label="Orders on your checkout" value={n(d.own.orders)} sub={`${inr(d.own.revenue)} revenue`} />
          <Kpi label="Cost per order (actual)" value={inr(cpo)} tag={<CostTag value={cpo} />} sub="All ad spend ÷ orders" />
          <Kpi label="ROAS (actual)" value={x(t.adSpend ? d.own.revenue / t.adSpend : null)} sub="Revenue ÷ all ad spend" />
        </div>
      )}
      {a && <AdsVersus a={a.ads} />}
      {a && (
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Revenue and ad spend</h2>
          <RevenueChart buckets={a.buckets} showAds />
        </section>
      )}
      {(d.metaInsightsError || d.googleInsightsError) && <Notice tone="warning">{d.metaInsightsError ? `Meta campaigns: ${d.metaInsightsError}. ` : ""}{d.googleInsightsError ? `Google campaigns: ${d.googleInsightsError}` : ""}</Notice>}
      <div className="panel overflow-x-auto">
        <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">All campaigns</h2>
        <table className="table num min-w-[760px]">
          <thead><tr><th>Campaign</th><th className="text-right">Spend</th><th className="text-right">Purchases</th><th className="text-right">Cost per purchase</th><th className="text-right">ROAS</th><th className="text-right">CTR</th><th className="text-right">CPC</th></tr></thead>
          <tbody>
            {d.campaigns.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-faint">No spend in this period</td></tr>}
            {d.campaigns.map((c) => (
              <tr key={c.id}>
                <td className="max-w-[320px]">
                  <span className="flex min-w-0 items-center gap-2"><AdIcon p={c.platform} className="h-3.5 w-auto" /><span className="truncate font-medium" title={c.name}>{c.name}</span></span>
                  {c.channel && <span className="ml-6 text-[11px] text-ink-faint">{c.channel}</span>}
                </td>
                <td className="text-right">{inr(c.spend)}</td><td className="text-right">{n(c.purchases)}</td>
                <td className="text-right font-medium"><span className="inline-flex items-center justify-end gap-1.5">{inr(c.cpp)}<CostTag value={c.cpp} /></span></td>
                <td className="text-right">{x(c.roas)}</td><td className="text-right">{pct(c.ctr)}</td><td className="text-right">{inr(c.cpc, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-rule px-5 py-2.5 text-xs text-ink-faint">Purchases and ROAS here are what each platform reports. Cost tags: under ₹35 excellent, ₹35–59 good, ₹60–99 average, ₹100+ poor.</p>
      </div>
    </>
  );
}

// ---------------- Meta ----------------

function MetaTab({ d }: { d: D }) {
  if (!d.metaOn || !d.meta) {
    return (
      <ConnectCard logo={<AdLogo p="meta" className="h-7 w-auto" />} title="Connect your Meta ad account"
        text="Add your ad account ID and a system user token to see spend, ROAS, cost per order and recharges here."
        action={<Link to={`/dashboard/stores/${d.storeId}/settings#meta`} className="btn-primary">Open settings</Link>} />
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
    <>
      <div className="flex flex-wrap gap-2"><a href={billingUrl} target="_blank" rel="noreferrer" className="btn-secondary h-9 py-0"><Icon name="wallet" className="h-4 w-4" />Recharge on Meta</a></div>
      {meta.accountError && <Notice tone="error">Couldn't load the ad account: {meta.accountError}</Notice>}
      {meta.insightsError && <Notice tone="error">Couldn't load ad performance: {meta.insightsError}</Notice>}
      {low && <Notice tone="warning">Ad balance is low ({inr(a!.available, 2)}). Recharge soon so your ads don't stop.</Notice>}

      {a && (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-4">
            <div className="flex min-w-0 items-center gap-3"><AdIcon p="meta" className="h-6 w-auto" /><div className="min-w-0"><p className="truncate font-semibold">{a.name}</p><p className="text-xs text-ink-faint">act_{d.adAccountId} · {a.currency} · {a.isPrepaid ? "Prepaid" : "Postpaid"}{a.fundingSource ? ` · ${a.fundingSource}` : ""}</p></div></div>
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
          <p className="mt-4 text-xs text-ink-faint">Actual figures use all orders placed on your checkout (online and COD) against Meta spend only. Meta figures use Meta's attribution. Cost tags: under ₹35 excellent, ₹35–59 good, ₹60–99 average, ₹100+ poor.</p>
        </section>
      )}

      {meta.insights && <CampaignTable rows={meta.insights.campaigns.map((c) => ({ ...c, channel: "" }))} />}

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
    </>
  );
}

// ---------------- Google ----------------

function GoogleTab({ d }: { d: D }) {
  const g = d.google;
  const nav = useNavigation();
  if (!g.appReady) {
    return (
      <ConnectCard logo={<AdLogo p="google" className="h-8 w-auto" text="text-2xl" />} title="Google Ads is coming to your dashboard"
        text="Growpefy is finishing its Google Ads setup. Once it's live you'll connect with one click here. Meanwhile you can add your Google purchase tag below so Google still counts your orders."
        extra={<TagCard d={d} />} />
    );
  }
  if (!g.connected) {
    return (
      <ConnectCard logo={<AdLogo p="google" className="h-8 w-auto" text="text-2xl" />} title="Connect Google Ads"
        text="Sign in with the Google account that runs your ads. We read spend and campaign results, and can send purchases from ad clicks back to Google."
        action={<a href={`/dashboard/stores/${d.storeId}/google/connect`} className="btn-primary"><GoogleG />Connect with Google</a>}
        extra={<TagCard d={d} />} />
    );
  }
  const picker = d.picker;
  if (!g.ready || (picker && picker.accounts.length > 0)) {
    return (
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="flex items-center gap-3"><AdIcon p="google" className="h-6 w-auto" /><div><h2 className="font-semibold">Pick the ad account for this store</h2><p className="text-xs text-ink-faint">Signed in as {g.email ?? "your Google account"}</p></div></div>
          <Form method="post"><button name="intent" value="googleDisconnect" className="btn-quiet text-sm">Use another Google login</button></Form>
        </div>
        {picker?.error && <div className="p-5"><Notice tone="error">{picker.error}</Notice></div>}
        {picker && picker.accounts.length === 0 && !picker.error && <p className="px-5 py-8 text-center text-sm text-ink-faint">No Google Ads accounts found for this login.</p>}
        <ul className="divide-y divide-rule">
          {picker?.accounts.map((a) => (
            <li key={`${a.id}-${a.loginCustomerId ?? ""}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.name}{a.id === g.customerId && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-good">Current</span>}</p>
                <p className="text-xs text-ink-faint">{formatCidClient(a.id)}{a.currency ? ` · ${a.currency}` : ""}{a.via ? ` · via ${a.via}` : ""}{a.manager ? " · Manager account (can't run ads)" : ""}</p>
              </div>
              {!a.manager && (
                <Form method="post"><input type="hidden" name="customerId" value={a.id} />
                  <button name="intent" value="googlePick" className="btn-primary h-9 px-4 text-sm" disabled={nav.state !== "idle"}>Use this account</button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const gd = d.googleData;
  const t = gd?.insights?.totals;
  const own = d.own;
  return (
    <>
      {gd?.accountError && <Notice tone="error">Couldn't load the Google Ads account: {gd.accountError}</Notice>}
      {gd?.insightsError && <Notice tone="error">Couldn't load Google Ads performance: {gd.insightsError}</Notice>}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <AdIcon p="google" className="h-7 w-auto" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{gd?.account?.name ?? g.customerLabel}</p>
              <p className="text-xs text-ink-faint">{g.customerLabel}{gd?.account ? ` · ${gd.account.currency}` : ""}{g.email ? ` · ${g.email}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gd?.account && <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${gd.account.status === "Active" ? "bg-emerald-50 text-good" : "bg-red-50 text-bad"}`}>{gd.account.status}</span>}
            <Link to="?ch=google&pick=account" className="btn-quiet text-sm">Change account</Link>
            <Form method="post" onSubmit={(e) => { if (!window.confirm("Disconnect Google Ads from this store?")) e.preventDefault(); }}>
              <button name="intent" value="googleDisconnect" className="btn-danger text-sm">Disconnect</button>
            </Form>
          </div>
        </div>
        {gd?.account?.autoTagging === false && <div className="border-t border-rule px-5 py-3"><Notice tone="warning">Auto-tagging is off in this Google Ads account, so ad clicks don't carry a click ID. Turn it on in Google Ads → Admin → Account settings to link orders to ads.</Notice></div>}
      </section>

      {t && (
        <section className="panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Performance</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat label="Ad spend" value={inr(t.spend)} big />
            <Stat label="Cost per order (actual)" value={inr(t.spend && own.orders ? t.spend / own.orders : null)} tag={<CostTag value={t.spend && own.orders ? t.spend / own.orders : null} />} sub={`${own.orders} orders on your checkout`} big />
            <Stat label="ROAS (actual)" value={x(t.spend ? own.revenue / t.spend : null)} sub={`${inr(own.revenue)} revenue`} big />
            <Stat label="Cost per conversion (Google)" value={inr(t.costPerPurchase)} tag={<CostTag value={t.costPerPurchase} />} sub={`${n(t.purchases)} conversions reported`} big />
            <Stat label="Conversion value (Google)" value={inr(t.purchaseValue)} sub={`ROAS ${x(t.roas)}`} />
            <Stat label="Impressions" value={n(t.impressions)} />
            <Stat label="Clicks" value={n(t.clicks)} sub={`CTR ${pct(t.ctr)}`} />
            <Stat label="Avg. CPC / CPM" value={`${inr(t.cpc, 2)} / ${inr(t.cpm)}`} />
          </dl>
          <p className="mt-4 text-xs text-ink-faint">Actual figures use all orders on your checkout against Google spend only. Google figures use the conversions counted in your Google Ads account.</p>
        </section>
      )}

      {gd?.insights && <CampaignTable rows={gd.insights.campaigns} google />}

      <ConversionCard d={d} />
      <TagCard d={d} />
    </>
  );
}

const formatCidClient = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

function ConversionCard({ d }: { d: D }) {
  const g = d.google;
  const picker = d.picker;
  const choosing = !g.hasConversion || (picker?.actions != null);
  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Send purchases to Google Ads</h2>
          <p className="mt-0.5 max-w-prose text-sm text-ink-soft">When a visitor from a Google ad places an order, we upload it to Google Ads from our server (no ad blocker can stop it), so Smart Bidding learns from real orders.</p>
        </div>
        {g.hasConversion && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-good"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />On · {g.conversionAction}</span>}
      </div>
      <div className="space-y-3 p-5">
        {picker?.error && <Notice tone="error">{picker.error}</Notice>}
        {choosing ? (
          <>
            {picker?.actions && picker.actions.length > 0 && (
              <Form method="post" className="flex flex-wrap items-end gap-2">
                <label className="block min-w-[240px] flex-1"><span className="label">Use an existing "import from clicks" conversion</span>
                  <select name="action" className="input" defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...picker.actions.map((a) => <option key={a.resource} value={a.resource}>{a.name}</option>)]}</select>
                </label>
                <SubmitButton intent="googleConversion" className="btn-secondary h-[42px]">Use this</SubmitButton>
              </Form>
            )}
            <Form method="post" className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-rule-strong p-3.5">
              <p className="min-w-0 flex-1 text-sm text-ink-soft"><span className="font-medium text-ink">Easiest:</span> we create a "Growpefy purchase" conversion in your Google Ads account and send orders to it.</p>
              <SubmitButton intent="googleCreateConversion" busyText="Creating">Create it for me</SubmitButton>
            </Form>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Link to="?ch=google&pick=conversion" className="btn-secondary text-sm">Change conversion</Link>
            <Form method="post"><button name="intent" value="googleStopConversion" className="btn-quiet text-sm">Stop sending</button></Form>
          </div>
        )}
        <p className="text-xs text-ink-faint">Only orders whose visitor came from a Google ad click (with a click ID) can be sent. Hashed phone and email are added to match more orders; nothing is sent in plain text.</p>
      </div>
    </section>
  );
}

function TagCard({ d }: { d: D }) {
  const g = d.google;
  return (
    <section className="panel">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Google purchase tag <span className="font-normal text-ink-faint">· optional</span></h2>
        <p className="mt-0.5 max-w-prose text-sm text-ink-soft">Fires your Google Ads conversion tag on the thank-you page, like your Meta pixel. Find both values in Google Ads → Goals → Conversions → your purchase action → Tag setup → "Install the tag yourself".</p>
      </div>
      <Form method="post" className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="block"><span className="label">Conversion ID</span><input name="tagId" defaultValue={g.tagId} placeholder="AW-123456789" className="input font-mono" /></label>
        <label className="block"><span className="label">Conversion label</span><input name="tagLabel" defaultValue={g.tagLabel} placeholder="AbC-D_efG-h12_34-567" className="input font-mono" /></label>
        <label className="flex items-start gap-3 sm:col-span-2">
          <input type="checkbox" name="fireCod" defaultChecked={g.fireCod} className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]" />
          <span><span className="block text-sm font-medium">Count COD orders as purchases</span><span className="block text-xs text-ink-faint">Applies to the tag and to server uploads. Off = only orders paid online.</span></span>
        </label>
        <div className="sm:col-span-2"><SubmitButton intent="googleTag" busyText="Saving">Save</SubmitButton></div>
        <p className="text-xs text-ink-faint sm:col-span-2">Using both this tag and server uploads? In Google Ads keep only one of the two conversions as "Primary" for bidding, so an order isn't counted twice.</p>
      </Form>
    </section>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// ---------------- shared ----------------

function ConnectCard({ logo, title, text, action, extra }: { logo: React.ReactNode; title: string; text: string; action?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <>
      <div className="panel flex flex-col items-center px-6 py-12 text-center">
        {logo}
        <p className="mt-5 font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-ink-soft">{text}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
      {extra}
    </>
  );
}

type CampaignRow = { id: string; name: string; channel?: string; spend: number; purchases: number; costPerPurchase: number | null; roas: number | null; ctr: number; cpc: number };
function CampaignTable({ rows, google = false }: { rows: CampaignRow[]; google?: boolean }) {
  return (
    <div className="panel overflow-x-auto">
      <h2 className="border-b border-rule px-5 py-4 text-[15px] font-semibold">Campaigns</h2>
      <table className="table num min-w-[760px]">
        <thead><tr><th>Campaign</th><th className="text-right">Spend</th><th className="text-right">{google ? "Conversions" : "Purchases"}</th><th className="text-right">{google ? "Cost per conversion" : "Cost per purchase"}</th><th className="text-right">ROAS</th><th className="text-right">CTR</th><th className="text-right">CPC</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-ink-faint">No spend in this period</td></tr>}
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="max-w-[300px]"><p className="truncate font-medium" title={c.name}>{c.name}</p>{c.channel && <p className="text-[11px] text-ink-faint">{c.channel}</p>}</td>
              <td className="text-right">{inr(c.spend)}</td><td className="text-right">{google ? (Math.round(c.purchases * 10) / 10).toLocaleString("en-IN") : n(c.purchases)}</td>
              <td className="text-right font-medium"><span className="inline-flex items-center justify-end gap-1.5">{inr(c.costPerPurchase)}<CostTag value={c.costPerPurchase} /></span></td>
              <td className="text-right">{x(c.roas)}</td><td className="text-right">{pct(c.ctr)}</td><td className="text-right">{inr(c.cpc, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, sub, tag }: { label: string; value: string; sub?: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="panel min-w-0 p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="num mt-1 flex flex-wrap items-center gap-1.5 text-xl font-semibold">{value}{tag}</p>
      {sub && <p className="mt-1 truncate text-xs text-ink-faint">{sub}</p>}
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

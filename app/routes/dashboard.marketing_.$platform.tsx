// Marketing → Meta / Google: Growpefy's own ad account on its own page — balance and recharges (Meta), performance and campaigns.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { and, eq, isNull } from "drizzle-orm";
import { AdIcon, PLATFORM_NAME, type AdPlatform } from "~/components/AdLogos";
import { Icon } from "~/components/Icons";
import { MarketingChart } from "~/components/MarketingChart";
import { RangePicker } from "~/components/Overview";
import { Notice, SubmitButton } from "~/components/ui";
import { db, metaRecharges } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { istToday, rangeLabel, resolveRange } from "~/lib/dates";
import { GST, withGst } from "~/lib/gst";
import { earliestLead, getMarketing, marketingReport, marketingView } from "~/lib/marketing.server";
import { fetchAccount } from "~/lib/meta.server";
import { creditFromGross, listRecharges, platformMetaStore, rechargeTotals, recordSnapshot, watchingSince } from "~/lib/recharges.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [{ title: `${data ? PLATFORM_NAME[data.platform] : "Ads"} · Growpefy marketing` }];

const platformOf = (p: string | undefined): AdPlatform => {
  if (p === "meta" || p === "google") return p;
  throw new Response("Not found", { status: 404 });
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const platform = platformOf(params.platform);
  const sp = new URLSearchParams(new URL(request.url).searchParams);
  if (!sp.get("range")) sp.set("range", "30d");
  const range = resolveRange(sp, await earliestLead());
  const m = await getMarketing();
  const view = marketingView(m);
  const report = await marketingReport(range);
  const rep = report[platform];

  let account: Awaited<ReturnType<typeof fetchAccount>> | null = null;
  let accountError: string | null = null;
  let recharges: { id: number; amount: number; credit: number; source: string; note: string | null; at: string }[] = [];
  let allTime = { count: 0, amount: 0 };
  let since: string | null = null;
  if (platform === "meta" && view.meta.connected) {
    try {
      account = await fetchAccount(platformMetaStore(m));
      await recordSnapshot({ id: null }, account).catch((e) => console.error("[recharges] Growpefy:", e));
    } catch (e) { accountError = e instanceof Error ? e.message : String(e); }
    const from = new Date(`${range.since}T00:00:00+05:30`);
    const to = new Date(new Date(`${range.until}T00:00:00+05:30`).getTime() + 86400_000);
    const [rows, t, w] = await Promise.all([listRecharges(null, from, to), rechargeTotals(null), watchingSince(null)]);
    recharges = rows.map((r) => ({ id: r.id, amount: r.amountPaise / 100, credit: r.creditPaise / 100, source: r.source, note: r.note, at: r.rechargedAt.toISOString() }));
    allTime = t; since = w;
  }
  return json({
    platform, range, rangeText: rangeLabel(range), today: istToday(),
    connected: platform === "meta" ? view.meta.connected : view.google.connected,
    accountName: platform === "meta" ? view.meta.accountName : view.google.accountName,
    accountId: platform === "meta" ? view.meta.adAccountId.replace(/\D/g, "") : view.google.customerId,
    rep, series: report.series, granularity: report.granularity,
    account, accountError, recharges, allTime, watchingSince: since,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request);
  if (platformOf(params.platform) !== "meta") return json({ ok: null, error: "Not supported" }, { status: 400 });
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "addRecharge") {
    const amount = Number(String(fd.get("amount") ?? "").replace(/[^\d.]/g, ""));
    const date = String(fd.get("date") ?? "");
    if (!Number.isFinite(amount) || amount <= 0) return json({ ok: null, error: "Enter the amount you paid, e.g. 1000" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > istToday()) return json({ ok: null, error: "Pick the recharge date (today or earlier)" }, { status: 400 });
    const paise = Math.round(amount * 100);
    await db.insert(metaRecharges).values({
      storeId: null, amountPaise: paise, creditPaise: creditFromGross(paise), source: "manual",
      note: String(fd.get("note") ?? "").trim().slice(0, 140) || null, rechargedAt: new Date(`${date}T12:00:00+05:30`),
    });
    return json({ ok: `Added a ₹${amount.toLocaleString("en-IN")} recharge`, error: null });
  }
  if (intent === "deleteRecharge") {
    await db.delete(metaRecharges).where(and(eq(metaRecharges.id, Number(fd.get("id"))), isNull(metaRecharges.storeId)));
    return json({ ok: "Recharge removed", error: null });
  }
  if (intent === "checkBalance") {
    try {
      const r = await recordSnapshot({ id: null }, await fetchAccount(platformMetaStore(await getMarketing())), true);
      return json({ ok: r ? `New recharge found: ₹${(r.amountPaise / 100).toLocaleString("en-IN")}` : "Balance checked. No new recharge since the last check.", error: null });
    } catch (e) { return json({ ok: null, error: e instanceof Error ? e.message : "Couldn't reach Meta" }, { status: 400 }); }
  }
  return json({ ok: null, error: "Unknown action" }, { status: 400 });
}

const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const int = (v: number) => Math.round(v).toLocaleString("en-IN");
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default function PlatformReport() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const p = d.platform;
  const rep = d.rep;
  const a = d.account;
  const low = a?.available != null && a.available < 500;
  const periodTotal = d.recharges.reduce((s, x) => s + x.amount, 0);
  const other: AdPlatform = p === "meta" ? "google" : "meta";

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/dashboard/marketing" className="text-sm text-ink-soft hover:text-ink">← Growpefy marketing</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-rule bg-surface"><AdIcon p={p} className="h-6 w-auto" /></span>
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{PLATFORM_NAME[p]} ads</h1>
            <p className="text-sm text-ink-soft">{d.accountName || "Growpefy"}{d.accountId ? ` · ${p === "meta" ? `act_${d.accountId}` : d.accountId}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/dashboard/marketing/${other}`} className="btn-secondary h-9 py-0"><AdIcon p={other} className="h-4 w-auto" />{PLATFORM_NAME[other]}</Link>
          <RangePicker current={d.range} align="right" />
        </div>
      </div>

      {!d.connected ? (
        <div className="panel px-6 py-12 text-center">
          <AdIcon p={p} className="mx-auto h-10 w-auto" />
          <h2 className="mt-3 font-semibold">{PLATFORM_NAME[p]} isn't connected</h2>
          <p className="mt-1 text-sm text-ink-soft">Connect Growpefy's {PLATFORM_NAME[p]} account at the bottom of the Marketing page.</p>
          <Link to="/dashboard/marketing" className="btn-primary mt-4">Open Marketing</Link>
        </div>
      ) : (
        <div className="space-y-6">
          {r?.ok && <Notice tone="success">{r.ok}</Notice>}
          {r?.error && <Notice tone="error">{r.error}</Notice>}
          {rep.error && <Notice tone="error">{rep.error}</Notice>}
          {d.accountError && <Notice tone="error">Couldn't load the ad account: {d.accountError}</Notice>}
          {low && <Notice tone="warning">Ad balance is low ({inr(a!.available, 2)}). Recharge soon so the lead ads don't stop.</Notice>}

          {a && (
            <section className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-4">
                <div className="min-w-0"><p className="truncate font-semibold">{a.name}</p><p className="text-xs text-ink-faint">{a.currency} · {a.isPrepaid ? "Prepaid" : "Postpaid"}{a.fundingSource ? ` · ${a.fundingSource}` : ""}</p></div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${a.status === "Active" ? "bg-emerald-50 text-good" : "bg-red-50 text-bad"}`}>{a.status}</span>
                  <a href={`https://business.facebook.com/billing_hub/payment_settings/?asset_id=${d.accountId}`} target="_blank" rel="noreferrer" className="btn-secondary h-8 py-0 text-xs"><Icon name="wallet" className="h-3.5 w-3.5" />Recharge on Meta</a>
                </div>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-rule">
                <Big label={a.available != null ? "Available balance" : "Amount due"} value={inr(a.available ?? a.balance, 2)} tone={low ? "text-bad" : undefined} />
                <Big label="Lifetime spend" value={inr(a.amountSpent)} sub="Without GST, as Meta shows it" />
                <Big label="Total invested" value={inr(withGst(a.amountSpent) + (a.available ?? 0))} sub={`Lifetime spend + ${GST * 100}% GST + balance`} highlight />
                <Big label="Spending limit" value={a.available != null ? inr(a.available / (1 + GST)) : a.spendCap ? inr(a.spendCap) : "None"} sub={a.available != null ? `Available balance without ${GST * 100}% GST` : undefined} />
              </dl>
            </section>
          )}

          <section className="panel p-5">
            <h2 className="mb-4 text-[15px] font-semibold">Performance · {d.rangeText}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Stat label="Spend" value={inr(rep.spend)} big />
              <Stat label="Leads" value={int(rep.leads)} big />
              <Stat label="Cost per lead" value={inr(rep.cpl)} big />
              <Stat label="Clicks" value={int(rep.clicks)} sub={`CTR ${rep.ctr == null ? "—" : `${rep.ctr.toFixed(2)}%`}`} big />
              <Stat label="Impressions" value={int(rep.impressions)} />
              <Stat label="Cost per click" value={inr(rep.cpc, 2)} />
              <Stat label="Campaigns with spend" value={String(rep.campaigns.length)} sub={`${rep.campaigns.filter((c) => c.status === "Active" || c.status === "Enabled").length} running now`} />
              <Stat label="Spend per day" value={inr(rep.spend / Math.max(1, d.series.length))} />
            </dl>
          </section>

          <section className="panel p-5">
            <h2 className="mb-4 text-[15px] font-semibold">Spend and leads · {d.granularity === "month" ? "by month" : "by day"}</h2>
            <MarketingChart points={d.series} showMeta={p === "meta"} showGoogle={p === "google"} />
          </section>

          <section className="panel overflow-hidden">
            <div className="border-b border-rule px-5 py-4"><h2 className="text-[15px] font-semibold">Campaigns</h2><p className="text-xs text-ink-faint">Campaigns that spent in this period, highest spend first</p></div>
            {rep.campaigns.length === 0 ? <p className="px-5 py-10 text-center text-sm text-ink-faint">No campaign spend in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="table num min-w-[720px]">
                  <thead><tr><th>Campaign</th><th className="text-right">Spend</th><th className="text-right">Impressions</th><th className="text-right">Clicks</th><th className="text-right">CTR</th><th className="text-right">Leads</th><th className="text-right">Cost / lead</th></tr></thead>
                  <tbody>
                    {[...rep.campaigns].sort((x, y) => y.spend - x.spend).map((c) => (
                      <tr key={c.id}>
                        <td><p className="max-w-[300px] truncate font-medium" title={c.name}>{c.name}</p><p className="text-[11px] text-ink-faint">{[c.kind, c.status].filter(Boolean).join(" · ")}</p></td>
                        <td className="text-right font-semibold">{inr(c.spend)}</td>
                        <td className="text-right">{int(c.impressions)}</td>
                        <td className="text-right">{int(c.clicks)}</td>
                        <td className="text-right">{c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "—"}</td>
                        <td className="text-right">{int(c.leads)}</td>
                        <td className="text-right">{inr(c.cpl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {p === "meta" && (
            <section className="panel">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
                <div>
                  <h2 className="text-[15px] font-semibold">Recharges</h2>
                  <p className="mt-0.5 max-w-prose text-sm text-ink-soft">
                    Spotted from the rise in the available balance (which already includes GST), rounded off. Add older recharges by hand.
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
              <Form method="post" className="grid gap-3 border-y border-rule bg-paper/50 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end" key={d.allTime.count}>
                <label className="block"><span className="label">Amount paid (₹, with GST)</span><input name="amount" inputMode="decimal" placeholder="1000" className="input num" required /></label>
                <label className="block"><span className="label">Date</span><input name="date" type="date" max={d.today} defaultValue={d.today} className="input" required /></label>
                <label className="block"><span className="label">Note (optional)</span><input name="note" maxLength={140} placeholder="UPI, invoice number…" className="input" /></label>
                <SubmitButton intent="addRecharge" busyText="Adding"><Icon name="plus" className="h-4 w-4" />Add recharge</SubmitButton>
              </Form>
              {d.recharges.length === 0 ? <p className="px-5 py-8 text-center text-sm text-ink-faint">No recharges in this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="table num min-w-[640px]">
                    <thead><tr><th>Date</th><th className="text-right">Recharge</th><th className="text-right">GST ({GST * 100}%)</th><th className="text-right">Ad credit</th><th>Source</th><th /></tr></thead>
                    <tbody>
                      {d.recharges.map((x) => (
                        <tr key={x.id}>
                          <td className="whitespace-nowrap">{when(x.at)}{x.note && <p className="max-w-[240px] truncate text-xs text-ink-faint" title={x.note}>{x.note}</p>}</td>
                          <td className="text-right font-semibold">{inr(x.amount)}</td>
                          <td className="text-right text-ink-soft">{inr(x.amount - x.credit, 2)}</td>
                          <td className="text-right">{inr(x.credit, 2)}</td>
                          <td><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${x.source === "auto" ? "bg-sky-50 text-sky-800" : "bg-paper-sunk text-ink-soft"}`}>{x.source === "auto" ? "Auto detected" : "Added by you"}</span></td>
                          <td className="text-right">
                            <Form method="post" onSubmit={(e) => { if (!window.confirm("Remove this recharge?")) e.preventDefault(); }}>
                              <input type="hidden" name="id" value={x.id} />
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
          )}
          {p === "google" && <p className="text-xs text-ink-faint">Google Ads charges the card on file automatically, so there are no recharges to track here. See invoices in Google Ads → Billing.</p>}
        </div>
      )}
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
  return <div className="bg-surface px-5 py-3"><p className="text-xs text-ink-soft">{label}</p><p className="num mt-0.5 font-semibold">{value}</p>{sub && <p className="text-[11px] text-ink-faint">{sub}</p>}</div>;
}
function Stat({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`num mt-1 font-semibold ${big ? "text-xl" : "text-base"}`}>{value}</dd>
      {sub && <dd className="mt-0.5 truncate text-xs text-ink-faint">{sub}</dd>}
    </div>
  );
}

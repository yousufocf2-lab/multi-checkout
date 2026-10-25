// Super admin → Growpefy marketing: our own Meta + Google ad results and where our leads (callbacks, signups) come from.
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import { AdIcon, AdLogo, PLATFORM_NAME, type AdPlatform } from "~/components/AdLogos";
import { Icon, type IconName } from "~/components/Icons";
import { MarketingChart } from "~/components/MarketingChart";
import { RangePicker } from "~/components/Overview";
import { CopyField, Notice, PageHeader, PasswordInput, SubmitButton } from "~/components/ui";
import { CHANNELS, type Channel } from "~/lib/attribution";
import { requireAdmin } from "~/lib/auth.server";
import { rangeLabel, resolveRange } from "~/lib/dates";
import { authUrl, googleAppReady, listAccounts, oauthState, revoke } from "~/lib/google-ads.server";
import { earliestLead, getMarketing, googleAccountName, marketingReport, marketingView, saveMarketing, testMetaAccount } from "~/lib/marketing.server";

export const meta: MetaFunction = () => [{ title: "Growpefy marketing · Growpefy" }];

type Picker = { accounts: Awaited<ReturnType<typeof listAccounts>>; error: string | null } | null;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const sp = new URLSearchParams(url.searchParams);
  if (!sp.get("range")) sp.set("range", "7d");
  const range = resolveRange(sp, await earliestLead());
  const m = await getMarketing();
  const view = marketingView(m);
  let picker: Picker = null;
  if (m.googleRefreshToken && (!view.google.connected || url.searchParams.get("pick") === "1")) {
    try { picker = { accounts: await listAccounts(m.googleRefreshToken), error: null }; }
    catch (e) { picker = { accounts: [], error: (e as Error).message }; }
  }
  return json({ range, rangeText: rangeLabel(range), view, picker, report: await marketingReport(range), gerr: url.searchParams.get("gerr") });
}

type ActionResult = { ok: boolean; message: string; form?: "meta" | "google" };

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const m = await getMarketing();

  if (intent === "metaSave") {
    const accountId = String(fd.get("adAccountId") ?? "").replace(/\D/g, "");
    const token = String(fd.get("token") ?? "").trim() || m.metaAccessToken || "";
    if (accountId.length < 5) return json<ActionResult>({ ok: false, form: "meta", message: "Enter the ad account ID (numbers only, from Ads Manager)." });
    if (!token) return json<ActionResult>({ ok: false, form: "meta", message: "Paste an access token with ads_read permission." });
    try {
      const a = await testMetaAccount(token, accountId);
      await saveMarketing({ metaAdAccountId: accountId, metaAccessToken: token, metaAccountName: a.name });
      return json<ActionResult>({ ok: true, form: "meta", message: `Connected to ${a.name || "your ad account"}.` });
    } catch (e) {
      return json<ActionResult>({ ok: false, form: "meta", message: (e as Error).message });
    }
  }
  if (intent === "metaDisconnect") {
    await saveMarketing({ metaAdAccountId: undefined, metaAccessToken: undefined, metaAccountName: undefined });
    return json<ActionResult>({ ok: true, form: "meta", message: "Meta disconnected." });
  }
  if (intent === "googleConnect") {
    if (!googleAppReady()) return json<ActionResult>({ ok: false, form: "google", message: "Add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in Railway first." });
    throw redirect(authUrl(oauthState(0, "admin")));
  }
  if (intent === "googlePick") {
    if (!m.googleRefreshToken) return json<ActionResult>({ ok: false, form: "google", message: "Connect with Google first." });
    const id = String(fd.get("customerId") ?? "").replace(/\D/g, "");
    try {
      const opt = (await listAccounts(m.googleRefreshToken)).find((a) => a.id === id && !a.manager);
      if (!opt) return json<ActionResult>({ ok: false, form: "google", message: "That account isn't available for this Google login." });
      const next = await saveMarketing({ googleCustomerId: opt.id, googleLoginCustomerId: opt.loginCustomerId, googleAccountName: opt.name });
      const name = await googleAccountName(next).catch(() => opt.name);
      if (name !== opt.name) await saveMarketing({ googleAccountName: name });
    } catch (e) {
      return json<ActionResult>({ ok: false, form: "google", message: (e as Error).message });
    }
    throw redirect("/dashboard/marketing");
  }
  if (intent === "googleDisconnect") {
    if (m.googleRefreshToken) await revoke(m.googleRefreshToken);
    await saveMarketing({ googleRefreshToken: undefined, googleEmail: undefined, googleCustomerId: undefined, googleLoginCustomerId: undefined, googleAccountName: undefined });
    return json<ActionResult>({ ok: true, form: "google", message: "Google disconnected." });
  }
  return json<ActionResult>({ ok: false, message: "Unknown action" }, { status: 400 });
}

// ---------------- UI ----------------

type D = ReturnType<typeof useLoaderData<typeof loader>>;
type Rep = D["report"];
type P = Rep["meta"];

const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const int = (v: number) => Math.round(v).toLocaleString("en-IN");
const leadsFmt = (v: number) => (Number.isInteger(v) ? int(v) : v.toFixed(1));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default function Marketing() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const r = d.report;
  const anyAds = d.view.meta.connected || d.view.google.connected;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Growpefy marketing"
        description="Growpefy's own ads on Meta and Google, and where our callbacks and signups come from."
        actions={<RangePicker current={d.range} align="right" />}
      />
      <div className="space-y-6">
        {d.gerr && <Notice tone="error">Google: {d.gerr}</Notice>}
        {a?.message && !a.form && <Notice tone={a.ok ? "success" : "error"}>{a.message}</Notice>}
        {r.meta.error && <Notice tone="error"><b>Meta:</b> {r.meta.error}</Notice>}
        {r.google.error && <Notice tone="error"><b>Google:</b> {r.google.error}</Notice>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon="ads" label="Ad spend" value={anyAds ? inr(r.totals.spend) : "—"} note={anyAds ? `${int(r.totals.clicks)} clicks` : "Connect your ad accounts below"} />
          <Kpi icon="target" label="Leads reported by ads" value={anyAds ? leadsFmt(r.totals.platformLeads) : "—"} note="Meta lead forms + Google conversions" />
          <Kpi icon="rupee" label="Cost per lead" value={inr(r.totals.cpl)} note={r.totals.cpl == null ? "Shows once ads bring leads" : "Ad spend ÷ leads reported"} />
          <Kpi icon="users" label="Website leads" value={int(r.totals.callbacks + r.totals.signups)} note={`${r.totals.callbacks} callbacks · ${r.totals.signups} signups · ${r.totals.fromAds} from ads`} />
        </div>

        <Versus r={r} view={d.view} />

        <section className="panel p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Spend and leads · {d.rangeText}</h2>
            <p className="text-xs text-ink-faint">{d.report.granularity === "month" ? "By month" : "By day"} · IST</p>
          </div>
          <MarketingChart points={r.series} showMeta={d.view.meta.connected} showGoogle={d.view.google.connected} />
        </section>

        <Campaigns r={r} />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
          <Sources r={r} />
          <RecentLeads r={r} />
        </div>

        <Connections d={d} a={a ?? null} />
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, note }: { icon: IconName; label: string; value: string; note: string }) {
  return (
    <div className="panel p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft"><Icon name={icon} className="h-3.5 w-3.5" />{label}</p>
      <p className="num mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-faint">{note}</p>
    </div>
  );
}

// ----- Meta vs Google -----

function Versus({ r, view }: { r: Rep; view: D["view"] }) {
  const total = r.meta.spend + r.google.spend;
  const share = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const w = r.winner.platform;
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <AdIcon p="meta" className="h-4 w-auto" /><span className="text-ink-faint">vs</span><AdIcon p="google" className="h-4 w-auto" />
          <span className="ml-1">Meta vs Google</span>
        </h2>
        {w ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-good"><Icon name="trend" className="h-3.5 w-3.5" />{PLATFORM_NAME[w]} is doing better · {r.winner.reason}</span>
        ) : <span className="rounded-full bg-paper-sunk px-3 py-1 text-xs font-medium text-ink-soft">{r.winner.reason}</span>}
      </div>
      {total > 0 && (
        <div className="px-5 pt-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-paper-sunk" role="img" aria-label={`Spend share: Meta ${share(r.meta.spend)}%, Google ${share(r.google.spend)}%`}>
            <div style={{ width: `${share(r.meta.spend)}%`, background: "#0866FF" }} />
            <div style={{ width: `${share(r.google.spend)}%`, background: "#F2A900" }} />
          </div>
          <p className="mt-1.5 flex justify-between text-[11px] text-ink-faint"><span>Meta {share(r.meta.spend)}% of spend</span><span>Google {share(r.google.spend)}% of spend</span></p>
        </div>
      )}
      <div className="grid gap-px bg-rule md:grid-cols-2">
        <PlatformCard p="meta" rep={r.meta} better={w === "meta"} site={r.site.meta} connected={view.meta.connected} name={view.meta.accountName} />
        <PlatformCard p="google" rep={r.google} better={w === "google"} site={r.site.google} connected={view.google.connected} name={view.google.accountName} />
      </div>
      <p className="border-t border-rule px-5 py-2.5 text-[11px] text-ink-faint">
        Leads reported by ads = Meta lead form submits and Google conversions (our callback form and signups). Website leads = what actually reached Growpefy with that platform as the source.
      </p>
    </section>
  );
}

function PlatformCard({ p, rep, better, site, connected, name }: { p: AdPlatform; rep: P; better: boolean; site: { callbacks: number; signups: number }; connected: boolean; name: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><AdLogo p={p} className="h-5 w-auto" />{name && <span className="truncate text-xs text-ink-faint">· {name}</span>}</div>
        {better && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Better</span>}
      </div>
      {!connected ? (
        <p className="mt-4 text-sm text-ink-faint">Not connected. <a href="#connections" className="font-medium text-pine underline underline-offset-2">Connect {PLATFORM_NAME[p]}</a></p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
            <Stat label="Spend" value={inr(rep.spend)} big />
            <Stat label="Leads" value={leadsFmt(rep.leads)} big />
            <Stat label="Cost per lead" value={inr(rep.cpl)} big />
            <Stat label="Impressions" value={int(rep.impressions)} />
            <Stat label="Clicks" value={`${int(rep.clicks)} · ${pct(rep.ctr)}`} />
            <Stat label="Cost per click" value={inr(rep.cpc, 2)} />
          </dl>
          <p className="mt-3 rounded-lg bg-paper-sunk/70 px-3 py-2 text-xs text-ink-soft">
            Reached our website: <b className="text-ink">{site.callbacks}</b> callback{site.callbacks === 1 ? "" : "s"}, <b className="text-ink">{site.signups}</b> signup{site.signups === 1 ? "" : "s"}
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return <div><dt className="text-[11px] text-ink-soft">{label}</dt><dd className={`num mt-0.5 font-semibold ${big ? "text-lg" : "text-sm"}`}>{value}</dd></div>;
}

// ----- sources -----

function Sources({ r }: { r: Rep }) {
  const max = Math.max(1, ...r.sources.map((s) => s.total));
  return (
    <section className="panel">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Where website leads came from</h2>
        <p className="text-xs text-ink-faint">Callbacks from the contact page and new signups</p>
      </div>
      {r.sources.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-faint">No callbacks or signups in this period yet.</p>
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {r.sources.map((s) => {
            const c = CHANNELS[s.channel as Channel | "untracked"];
            return (
              <li key={s.channel}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} /><span className="truncate">{c.label}</span>{c.paid && <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase text-amber-800">Paid</span>}</span>
                  <span className="num shrink-0 font-semibold">{s.total}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-sunk"><div className="h-full rounded-full" style={{ width: `${(s.total / max) * 100}%`, background: c.color }} /></div>
                <p className="mt-1 text-[11px] text-ink-faint">{s.callbacks} callback{s.callbacks === 1 ? "" : "s"} · {s.signups} signup{s.signups === 1 ? "" : "s"}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ----- campaigns -----

function Campaigns({ r }: { r: Rep }) {
  const rows = [
    ...r.meta.campaigns.map((c) => ({ ...c, p: "meta" as const })),
    ...r.google.campaigns.map((c) => ({ ...c, p: "google" as const })),
  ].sort((a, b) => b.spend - a.spend);
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Campaigns</h2>
        <p className="text-xs text-ink-faint">Campaigns that spent in this period</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-faint">No campaign spend in this period. New campaigns can take a few hours to show.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table num min-w-[640px]">
            <thead><tr><th>Campaign</th><th className="text-right">Spend</th><th className="text-right">Clicks</th><th className="text-right">CTR</th><th className="text-right">Leads</th><th className="text-right">Cost / lead</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.p}-${c.id}`}>
                  <td>
                    <div className="flex items-center gap-2">
                      <AdIcon p={c.p} className="h-4 w-auto shrink-0" />
                      <div className="min-w-0">
                        <p className="max-w-[260px] truncate font-medium" title={c.name}>{c.name}</p>
                        <p className="text-[11px] text-ink-faint">{[c.kind, c.status].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-right font-semibold">{inr(c.spend)}</td>
                  <td className="text-right">{int(c.clicks)}</td>
                  <td className="text-right">{c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "—"}</td>
                  <td className="text-right">{leadsFmt(c.leads)}</td>
                  <td className="text-right">{inr(c.cpl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ----- recent leads -----

function RecentLeads({ r }: { r: Rep }) {
  const [kind, setKind] = useState<"all" | "callback" | "signup">("all");
  const rows = r.recent.filter((l) => kind === "all" || l.kind === kind);
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Latest leads</h2>
          <p className="text-xs text-ink-faint">Newest first, with the source we saw when they arrived</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-paper-sunk p-1 text-xs font-medium">
          {(["all", "callback", "signup"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-2.5 py-1 ${kind === k ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}>
              {k === "all" ? "All" : k === "callback" ? "Callbacks" : "Signups"}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-faint">No leads in this period.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((l) => {
            const c = CHANNELS[l.channel as Channel | "untracked"];
            return (
              <li key={`${l.kind}-${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${l.kind === "callback" ? "bg-emerald-50 text-pine" : "bg-sky-50 text-sky-700"}`}>
                  <Icon name={l.kind === "callback" ? "phone" : "users"} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.name} <span className="font-normal text-ink-faint">· {l.contact}</span></p>
                  <p className="truncate text-xs text-ink-soft">{l.kind === "callback" ? "Callback" : "Signup"} · {l.detail}</p>
                </div>
                <div className="min-w-0 text-right">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[11px] font-medium"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}</span>
                  {l.via && <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-ink-faint" title={l.via}>{l.via}</p>}
                </div>
                <p className="w-full text-[11px] text-ink-faint sm:w-28 sm:text-right">{when(l.at)}</p>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule px-5 py-3 text-xs">
        <Link to="/dashboard/support?tab=callbacks" className="font-medium text-pine hover:underline">Open callbacks inbox</Link>
        <Link to="/dashboard/owners" className="font-medium text-pine hover:underline">Open store owners</Link>
      </div>
    </section>
  );
}

// ----- connections -----

function Connections({ d, a }: { d: D; a: ActionResult | null }) {
  const nav = useNavigation();
  const [params] = useSearchParams();
  const m = d.view.meta, g = d.view.google;
  const [editMeta, setEditMeta] = useState(!m.connected);
  return (
    <section id="connections" className="panel scroll-mt-24">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[15px] font-semibold">Growpefy's ad accounts</h2>
        <p className="text-xs text-ink-faint">Only the accounts that promote Growpefy. Store owners' ads stay in their own stores.</p>
      </div>
      <div className="grid gap-px bg-rule lg:grid-cols-2">
        {/* Meta */}
        <div className="bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <AdLogo p="meta" className="h-6 w-auto" />
            {m.connected && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-good">Connected</span>}
          </div>
          {a?.form === "meta" && <div className="mt-4"><Notice tone={a.ok ? "success" : "error"}>{a.message}</Notice></div>}
          {m.connected && !editMeta ? (
            <div className="mt-4 space-y-3 text-sm">
              <p><span className="text-ink-soft">Ad account:</span> <b>{m.accountName || "—"}</b> <span className="text-ink-faint">· act_{m.adAccountId}</span></p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={() => setEditMeta(true)}>Change account or token</button>
                <Form method="post" onSubmit={(e) => { if (!window.confirm("Disconnect Growpefy's Meta ad account?")) e.preventDefault(); }}>
                  <button name="intent" value="metaDisconnect" className="btn-quiet h-9 text-sm text-bad">Disconnect</button>
                </Form>
              </div>
            </div>
          ) : (
            <Form method="post" className="mt-4 space-y-3">
              <label className="block"><span className="label">Ad account ID</span>
                <input name="adAccountId" defaultValue={m.adAccountId} inputMode="numeric" placeholder="Numbers from Ads Manager, e.g. 1234567890" className="input num" required />
              </label>
              <label className="block"><span className="label">Access token {m.hasToken && <span className="font-normal text-ink-faint">(leave empty to keep the saved one)</span>}</span>
                <PasswordInput name="token" placeholder={m.hasToken ? "••••••••  saved" : "System user token with ads_read"} autoComplete="off" />
              </label>
              <p className="text-xs leading-relaxed text-ink-faint">Business settings → Users → System users → add the Growpefy ad account → Generate token with <b>ads_read</b>. Use a token that never expires.</p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton intent="metaSave" busyText="Checking">Save and connect</SubmitButton>
                {m.connected && <button type="button" className="btn-quiet" onClick={() => setEditMeta(false)}>Cancel</button>}
              </div>
            </Form>
          )}
          <details className="mt-5 rounded-lg border border-rule bg-paper/60 px-3 py-2 text-xs text-ink-soft">
            <summary className="cursor-pointer font-medium text-ink">Ads that send people to growpefy.com</summary>
            <p className="mt-2">Add these URL parameters to the ad (Ad → Tracking → URL parameters), so those visitors show as <b>Meta Ads</b> here:</p>
            <div className="mt-2"><CopyField label="URL parameters" value="utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}" /></div>
            <p className="mt-2">Instant Form leads stay inside Facebook, so they show in "Leads reported by ads", not as website leads.</p>
          </details>
        </div>

        {/* Google */}
        <div className="bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <AdLogo p="google" className="h-6 w-auto" />
            {g.connected && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-good">Connected</span>}
          </div>
          {a?.form === "google" && <div className="mt-4"><Notice tone={a.ok ? "success" : "error"}>{a.message}</Notice></div>}
          {!g.appReady ? (
            <div className="mt-4 space-y-2 text-sm text-ink-soft">
              <p>Google needs Growpefy's Google Cloud app first (the same one store owners will use).</p>
              <p className="text-xs text-ink-faint">Add <code className="rounded bg-paper-sunk px-1">GOOGLE_ADS_CLIENT_ID</code> and <code className="rounded bg-paper-sunk px-1">GOOGLE_ADS_CLIENT_SECRET</code> in Railway → Variables, then come back here.</p>
            </div>
          ) : !g.signedIn ? (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-ink-soft">Sign in with the Google account that owns the Growpefy ad account (248-674-1619).</p>
              <Form method="post" reloadDocument><SubmitButton intent="googleConnect" busyText="Opening Google">Connect with Google</SubmitButton></Form>
            </div>
          ) : d.picker ? (
            <div className="mt-4">
              <p className="text-sm font-medium">Pick Growpefy's ad account</p>
              <p className="text-xs text-ink-faint">Signed in as {g.email || "your Google account"}</p>
              {d.picker.error && <div className="mt-3"><Notice tone="error">{d.picker.error}</Notice></div>}
              {d.picker.accounts.length === 0 && !d.picker.error && <p className="mt-3 text-sm text-ink-faint">No Google Ads accounts found for this login.</p>}
              <ul className="mt-3 divide-y divide-rule rounded-lg border border-rule">
                {d.picker.accounts.map((acc) => (
                  <li key={`${acc.id}-${acc.loginCustomerId ?? ""}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{acc.name}</p>
                      <p className="text-[11px] text-ink-faint">{cid(acc.id)}{acc.currency ? ` · ${acc.currency}` : ""}{acc.via ? ` · via ${acc.via}` : ""}{acc.manager ? " · Manager account" : ""}</p>
                    </div>
                    {!acc.manager && (
                      <Form method="post"><input type="hidden" name="customerId" value={acc.id} />
                        <button name="intent" value="googlePick" className="btn-primary h-8 px-3 text-xs" disabled={nav.state !== "idle"}>Use this</button>
                      </Form>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {g.connected && params.get("pick") === "1" && <Link to="/dashboard/marketing" className="btn-quiet text-sm">Cancel</Link>}
                <Form method="post"><button name="intent" value="googleDisconnect" className="btn-quiet text-sm">Use another Google login</button></Form>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              <p><span className="text-ink-soft">Ad account:</span> <b>{g.accountName || "—"}</b> <span className="text-ink-faint">· {g.customerId}</span></p>
              <p className="text-xs text-ink-faint">Signed in as {g.email || "Google account"}</p>
              <div className="flex flex-wrap gap-2">
                <Link to="/dashboard/marketing?pick=1#connections" className="btn-secondary h-9 px-3 text-sm">Change account</Link>
                <Form method="post" onSubmit={(e) => { if (!window.confirm("Disconnect Growpefy's Google Ads account?")) e.preventDefault(); }}>
                  <button name="intent" value="googleDisconnect" className="btn-quiet h-9 text-sm text-bad">Disconnect</button>
                </Form>
              </div>
            </div>
          )}
          <p className="mt-5 rounded-lg border border-rule bg-paper/60 px-3 py-2 text-xs text-ink-soft">
            Google Ads visitors are recognised automatically from the ad click (auto-tagging), no extra setup needed.
          </p>
        </div>
      </div>
    </section>
  );
}

const cid = (id: string) => (id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

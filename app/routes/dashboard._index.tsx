import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Icon } from "~/components/Icons";
import { RangePicker } from "~/components/Overview";
import { HomeView } from "~/components/HomeView";
import { homeTasks, setupGuide } from "~/lib/home.server";
import { StoreFilter } from "~/components/StoreFilter";
import { EmptyState } from "~/components/ui";
import { can, requireViewer, viewerStores, type Viewer } from "~/lib/auth.server";
import { AdminOverview, type AdminData } from "~/components/AdminOverview";
import { platformOrders } from "~/lib/admin.server";
import { funnel, listClients } from "~/lib/clients.server";
import { listLeads, syncMetaLeads, upcomingDemos } from "~/lib/leads.server";
import { earliestLead, marketingReport } from "~/lib/marketing.server";
import { selectedStore } from "~/lib/selection.server";
import { lastSnapshot, listRecharges } from "~/lib/recharges.server";
import { selectedStoreIds } from "~/components/StoreFilter";
import type { Store } from "~/db.server";
import type { Range } from "~/lib/dates";
import { resolveRange } from "~/lib/dates";
import { dashboardScope } from "~/lib/selection.server";
import { earliestDate, loadLeaderboard, loadOverview } from "~/lib/stats.server";
import { storePath } from "~/lib/store-code";

const greet = () => {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

/** Admin home: Growpefy's own ads, leads, orders across stores and onboarding. Each part needs its permission. */
async function adminHome(request: Request, viewer: Viewer & { role: "admin" }, all: Store[]): Promise<AdminData> {
  const params = new URL(request.url).searchParams;
  const range: Range = resolveRange(params, await earliestLead());
  const picked = selectedStoreIds(params).filter((id) => all.some((s) => s.id === id));
  const scope = picked.length ? all.filter((s) => picked.includes(s.id)) : all;
  const since = new Date(`${range.since}T00:00:00+05:30`).getTime();
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const [ads, leads, orders, clients] = await Promise.all([
    can(viewer, "marketing") ? marketingReport(range).then((r) => {
      const card = (p: typeof r.meta, live: string) => ({
        connected: p.connected, error: p.error, spend: p.spend, leads: p.leads, cpl: p.cpl, clicks: p.clicks,
        campaigns: p.campaigns.length, active: p.campaigns.filter((c) => c.status === live).length,
      });
      const top = [...r.meta.campaigns.map((c) => ({ ...c, p: "meta" as const })), ...r.google.campaigns.map((c) => ({ ...c, p: "google" as const }))]
        .sort((x, y) => y.leads - x.leads || y.spend - x.spend).slice(0, 4)
        .map((c) => ({ id: `${c.p}-${c.id}`, p: c.p, name: c.name, status: c.status, spend: c.spend, leads: c.leads, cpl: c.cpl }));
      return {
        meta: card(r.meta, "Active"), google: card(r.google, "Enabled"), spend: r.totals.spend, leads: r.totals.platformLeads, cpl: r.totals.cpl,
        top, daily: r.series.slice(-14).map((x) => ({ label: x.longLabel, spend: x.meta + x.google, leads: x.adLeads })),
      };
    }).then(async (ads) => {
      if (!ads) return ads;
      // Growpefy's Meta balance (last reading) and what we recharged this month
      const monthStart = new Date(`${todayIst.slice(0, 8)}01T00:00:00+05:30`);
      const [snap, month] = await Promise.all([lastSnapshot(null), listRecharges(null, monthStart)]);
      return { ...ads, balance: snap ? snap.availablePaise / 100 : null, monthRecharged: month.reduce((a, x) => a + x.amountPaise, 0) / 100, monthRecharges: month.length };
    }).catch(() => null) : null,
    can(viewer, "leads") ? (async () => {
      await syncMetaLeads();
      const [list, upcoming] = await Promise.all([listLeads(), upcomingDemos(3)]);
      const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
      return {
        inRange: list.filter((l) => new Date(l.createdAt).getTime() >= since).length,
        today: list.filter((l) => day(l.createdAt) === todayIst).length,
        toCall: list.filter((l) => l.status === "new").length,
        demos: list.filter((l) => l.status === "demo_scheduled").length,
        customers: list.filter((l) => l.status === "customer").length,
        recent: list.slice(0, 7).map((l) => ({ key: l.key, kind: l.kind, name: l.name, phone: l.phone, source: l.source, status: l.status, detail: l.detail, createdAt: l.createdAt })),
        upcoming: upcoming.map((u) => ({ key: u.key, name: u.name, demoAt: u.demoAt })),
      };
    })() : null,
    can(viewer, "stores") ? platformOrders(scope, range).then((o) => ({ ...o, allStores: all.map((s) => ({ id: s.id, name: s.name })), picked })) : null,
    can(viewer, "clients") ? listClients().then((list) => ({
      funnel: funnel(list),
      recent: list.slice(0, 6).map((c) => ({ id: c.id, name: c.name, next: c.next?.label ?? null, reached: c.reached, createdAt: c.createdAt, urgency: c.signup?.urgency ?? null })),
    })) : null,
  ]);
  return { greeting: greet(), who: viewer.staff?.name.split(" ")[0] ?? "Yusuf", range, ads, leads, orders, clients };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  // Admin's own panel unless a client's store is open (then the store's overview, as the owner sees it)
  if (viewer.role === "admin" && !(await selectedStore(request))) {
    return json({ admin: await adminHome(request, viewer, all) } as const);
  }
  // A store employee without access to orders starts on the first page they can use
  if (viewer.role === "owner" && viewer.member && !can(viewer, "orders")) {
    const first = ([["inbox", "/dashboard/stores?next=inbox"], ["ads", "/dashboard/ads"], ["offers", "/dashboard/stores?next=promotions"], ["rto", "/dashboard/stores?next=shipping"],
      ["billing", "/dashboard/stores?next=wallet"], ["settings", "/dashboard/stores?next=settings"], ["team", "/dashboard/team"]] as const).find(([p]) => can(viewer, p));
    throw redirect(first?.[1] ?? "/dashboard/support");
  }
  const { scope, picked, locked } = await dashboardScope(request, all);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate(scope));
  const one = scope.length === 1 ? scope[0] : null;
  const [overview, leaders, tasks, setup] = await Promise.all([
    loadOverview(scope, range), loadLeaderboard(scope, range), homeTasks(scope),
    one ? setupGuide(one, storePath(one.id)).catch(() => null) : Promise.resolve(null),
  ]);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  return json({
    admin: null,
    overview, leaders, picked, locked, tasks, setup,
    stores: all.map((s) => ({ id: s.id, name: s.name })),
    single: one ? {
      id: one.id, name: one.name, base: storePath(one.id), storefront: one.storefrontEnabled,
      liveUrl: one.storefrontEnabled ? (one.storefrontDomain ? `https://${one.storefrontDomain}` : `/s/${one.slug}`) : null,
    } : null,
    greeting: hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    viewerName: viewer.role === "admin" ? (viewer.staff?.name ?? "Admin").split(" ")[0] : (viewer.member?.name ?? viewer.name).split(" ")[0],
    isAdmin: viewer.role === "admin",
  });
}

export default function DashboardHome() {
  const data = useLoaderData<typeof loader>();
  if (data.admin) return <AdminOverview d={data.admin as AdminData} />;
  return <StoreHome />;
}

function StoreHome() {
  const { overview, leaders, stores, picked, locked, single, greeting, viewerName, tasks, setup } = useLoaderData<typeof loader>() as Extract<ReturnType<typeof useLoaderData<typeof loader>>, { admin: null }>;

  if (stores.length === 0) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Welcome, {viewerName}</h1>
        <EmptyState title="Let's set up your store" action={<Link to="/dashboard/stores/create" className="btn-primary">Create your store</Link>}>
          Your website, checkout, COD and payments in one place. It takes 2 minutes. Need help? <Link to="/dashboard/support" className="font-semibold text-pine underline">Talk to our team</Link>.
        </EmptyState>
      </>
    );
  }

  const scopeName = single ? single.name
    : picked.length ? picked.map((id) => stores.find((s) => s.id === id)?.name).filter(Boolean).join(", ")
    : `All ${stores.length} stores`;

  return (
    <>
      <div className="mb-3 flex min-h-[32px] flex-wrap items-center gap-2">
        <div className="mr-auto min-w-[180px]">
          <p className="text-xs font-medium text-ink-soft">{greeting}, {viewerName}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Store overview</h1>
        </div>
        <RangePicker current={overview.range} />
        {stores.length > 1 && !locked && <StoreFilter stores={stores} selected={picked} />}
        {!single && <span className="hidden h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-soft sm:inline-flex"><Icon name="stores" className="h-3.5 w-3.5" />{scopeName}</span>}
        {single ? <LiveChip base={single.base} /> : tasks.liveCheckouts > 0 && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12.5px] font-medium shadow-[0_0_0_1px_rgba(0,0,0,.08)]" title="Checkouts active in the last 5 minutes">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#29845a] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#29845a]" /></span>
            {tasks.liveCheckouts} in checkout now
          </span>
        )}
        {single?.liveUrl && <a href={single.liveUrl} target="_blank" rel="noreferrer" className="btn-secondary btn"><Icon name="eye" className="h-3.5 w-3.5" />View store</a>}
      </div>
      <HomeView data={overview} tasks={tasks} setup={setup} leaders={leaders} single={single} showStoreColumn={!single} />
    </>
  );
}

/** "12 live now" chip on a store's overview: polls the Live view numbers and opens the Live view. */
function LiveChip({ base }: { base: string }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try { const r = await fetch(`${base}/live/data`, { cache: "no-store" }); if (r.ok) { const d = (await r.json()) as { total: number }; if (alive) setN(d.total); } } catch { /* keep last */ }
    };
    void pull();
    const t = setInterval(pull, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [base]);
  if (n == null) return null;
  return (
    <Link to={`${base}/live`} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12.5px] font-medium shadow-[0_0_0_1px_rgba(0,0,0,.08)] hover:bg-black/[.02]" title="Visitors on your website and checkout right now">
      <span className="relative flex h-2 w-2">{n > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#29845a] opacity-60" />}<span className={`relative inline-flex h-2 w-2 rounded-full ${n > 0 ? "bg-[#29845a]" : "bg-black/20"}`} /></span>
      <span className="num">{n}</span> live now
    </Link>
  );
}

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { OverviewView, RangePicker } from "~/components/Overview";
import { StoreFilter } from "~/components/StoreFilter";
import { EmptyState } from "~/components/ui";
import { can, requireViewer, viewerStores, type Viewer } from "~/lib/auth.server";
import { AdminOverview, type AdminData } from "~/components/AdminOverview";
import { platformOrders } from "~/lib/admin.server";
import { funnel, listClients } from "~/lib/clients.server";
import { listLeads, syncMetaLeads, upcomingDemos } from "~/lib/leads.server";
import { earliestLead, marketingReport } from "~/lib/marketing.server";
import { selectedStore } from "~/lib/selection.server";
import { selectedStoreIds } from "~/components/StoreFilter";
import type { Store } from "~/db.server";
import type { Range } from "~/lib/dates";
import { resolveRange } from "~/lib/dates";
import { dashboardScope } from "~/lib/selection.server";
import { earliestDate, loadLeaderboard, loadOverview } from "~/lib/stats.server";

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
      return { meta: card(r.meta, "Active"), google: card(r.google, "Enabled"), spend: r.totals.spend, leads: r.totals.platformLeads, cpl: r.totals.cpl };
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
    const first = ([["inbox", "/dashboard/stores?next=inbox"], ["ads", "/dashboard/ads"], ["offers", "/dashboard/stores?next=discounts"], ["rto", "/dashboard/stores?next=shipping"],
      ["billing", "/dashboard/stores?next=wallet"], ["settings", "/dashboard/stores?next=settings"], ["team", "/dashboard/team"]] as const).find(([p]) => can(viewer, p));
    throw redirect(first?.[1] ?? "/dashboard/support");
  }
  const { scope, picked, locked } = await dashboardScope(request, all);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate(scope));
  const [overview, leaders] = await Promise.all([loadOverview(scope, range), loadLeaderboard(scope, range)]);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  return json({
    admin: null,
    overview, leaders, picked, locked,
    stores: all.map((s) => ({ id: s.id, name: s.name })),
    single: scope.length === 1 ? { id: scope[0].id, name: scope[0].name } : null,
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
  const { overview, leaders, stores, picked, locked, single, greeting, viewerName, isAdmin } = useLoaderData<typeof loader>() as Extract<ReturnType<typeof useLoaderData<typeof loader>>, { admin: null }>;

  if (stores.length === 0) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Welcome, {viewerName}</h1>
        <EmptyState title="No stores yet" action={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>}>
          You'll need your store's .myshopify.com domain and a Shopify app's Client ID and secret. It takes about 10 minutes.
        </EmptyState>
      </>
    );
  }

  const scopeName = single ? single.name
    : picked.length ? picked.map((id) => stores.find((s) => s.id === id)?.name).filter(Boolean).join(", ")
    : `All ${stores.length} stores`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-soft">{greeting}, {viewerName} {isAdmin && <span aria-hidden>👋</span>}</p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            Overview
            <span className="inline-flex items-center gap-1 rounded-full bg-pine-tint px-2.5 py-0.5 text-xs font-medium text-pine"><Icon name="stores" className="h-3.5 w-3.5" />{scopeName}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker current={overview.range} align="right" />
          {stores.length > 1 && !locked && <StoreFilter stores={stores} selected={picked} />}
        </div>
      </div>
      <OverviewView data={overview} leaders={leaders} showStoreColumn={!single}
        adsHref={single ? `/dashboard/stores/${single.id}/ads` : undefined} />
    </>
  );
}

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { OverviewView, RangePicker } from "~/components/Overview";
import { StoreFilter } from "~/components/StoreFilter";
import { EmptyState } from "~/components/ui";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { resolveRange } from "~/lib/dates";
import { dashboardScope } from "~/lib/selection.server";
import { earliestDate, loadLeaderboard, loadOverview } from "~/lib/stats.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const all = await viewerStores(viewer);
  const { scope, picked, locked } = await dashboardScope(request, all);
  const range = resolveRange(new URL(request.url).searchParams, await earliestDate(scope));
  const [overview, leaders] = await Promise.all([loadOverview(scope, range), loadLeaderboard(scope, range)]);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  return json({
    overview, leaders, picked, locked,
    stores: all.map((s) => ({ id: s.id, name: s.name })),
    single: scope.length === 1 ? { id: scope[0].id, name: scope[0].name } : null,
    greeting: hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    viewerName: viewer.role === "admin" ? "Admin" : viewer.name.split(" ")[0],
    isAdmin: viewer.role === "admin",
  });
}

export default function DashboardHome() {
  const { overview, leaders, stores, picked, locked, single, greeting, viewerName, isAdmin } = useLoaderData<typeof loader>();

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

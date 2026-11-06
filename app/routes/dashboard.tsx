import type { HeadersFunction, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, NavLink, Outlet, useLoaderData, useLocation, useNavigate, useNavigation, type ShouldRevalidateFunction } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { BrandIcon, BrandLockup, BusyOverlay } from "~/components/Brand";
import { Icon, type IconName } from "~/components/Icons";
import { IDLE_MS, can, loginStamp, needsKyc, requireViewer, touchSession, viewerStores } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { startRechargeWatcher } from "~/lib/recharges.server";
import { startShipmentWatcher } from "~/lib/logistics.server";
import { dropshipAlertCount, startDropshipWatcher } from "~/lib/dropship.server";
import { startRecoveryWatcher } from "~/lib/recovery.server";
import { startWelcomeWatcher } from "~/lib/welcome.server";
import { startNativeOrdersWatcher } from "~/lib/native-orders.server";
import { db, stores as storesTable, storeThemes } from "~/db.server";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { selectCookie, selectedStore } from "~/lib/selection.server";
import { rupees } from "~/lib/wallet";
import { stateOf, walletsFor } from "~/lib/wallet.server";
import { supportBadge } from "~/lib/support.server";
import { upcomingDemos } from "~/lib/leads.server";
import { adminUnread } from "~/lib/admin-inbox.server";
import { packOf } from "~/lib/business-types";
import { listPasskeys } from "~/lib/passkeys.server";
import { PasskeyPrompt } from "~/components/Passkey";
import { startPaymentRecheck } from "~/lib/gateways/index.server";
import { pendingConnectCount } from "~/lib/connect.server";
import { DemoBar, type NextDemo } from "~/components/DemoBar";
import { storeIdFromCode, storePath } from "~/lib/store-code";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;650;700&display=swap" },
];

export const meta: MetaFunction = () => [{ title: "Dashboard · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  startRechargeWatcher();
  startShipmentWatcher();
  startDropshipWatcher();
  startRecoveryWatcher();
  startWelcomeWatcher();
  startNativeOrdersWatcher();
  startPaymentRecheck();
  const viewer = await requireViewer(request);
  const list = await viewerStores(viewer);
  // Opening a store page focuses the dashboard on that store
  let selected = await selectedStore(request);
  const inUrl = storeIdFromCode(new URL(request.url).pathname.match(/^\/store\/([^/]+)/)?.[1]) ?? 0;
  const headers = new Headers();
  if (inUrl && inUrl !== selected && list.some((s) => s.id === inUrl)) {
    selected = inUrl;
    headers.append("Set-Cookie", await selectCookie(inUrl));
  }
  const touched = await touchSession(request);
  if (touched) headers.append("Set-Cookie", touched);
  const ws = await walletsFor(list.map((s) => s.id)).catch(() => []);
  // Growpefy Store websites count as "live" once the design is published or their domain is connected; till then no wallet alerts
  const own = list.filter((s) => s.platform === "growpefy");
  const published = new Set(own.length
    ? await db.select({ id: storeThemes.storeId }).from(storeThemes).where(and(inArray(storeThemes.storeId, own.map((s) => s.id)), isNotNull(storeThemes.publishedAt))).then((r) => r.map((x) => x.id)).catch(() => [])
    : []);
  const isLive = (s: (typeof list)[number]) => s.platform !== "growpefy" || published.has(s.id) || s.storefrontDomainStatus === "live";
  const admin = viewer.role === "admin";
  const dropshipAlerts = admin && can(viewer, "fulfilment") ? await dropshipAlertCount().catch(() => 0) : 0;
  const waPending = admin && can(viewer, "clients")
    ? await db.select({ n: sql<number>`count(*)::int` }).from(storesTable).where(sql`${storesTable.waVerify}->>'status' = 'submitted'`).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0)
    : 0;
  const connectPending = admin && can(viewer, "stores") ? await pendingConnectCount().catch(() => 0) : 0;
  // Growpefy's own WhatsApp inbox: super admin only
  const adminWa = admin && !viewer.staff ? await adminUnread().catch(() => 0) : null;
  const hasPasskey = await listPasskeys(viewer).then((l) => l.length > 0).catch(() => true);
  const support = can(viewer, "support") || viewer.role === "owner" ? await supportBadge(viewer).catch(() => 0) : 0;
  // Nearest scheduled sales demo → reminder card on every page (admin side, with access to leads)
  const demos = admin && can(viewer, "leads") ? await upcomingDemos(5).catch(() => []) : [];
  const nextDemo: NextDemo | null = demos[0] ? { ...demos[0], more: demos.length - 1 } : null;
  const team = viewer.role === "admin" ? viewer.staff : viewer.member;
  return json({
    kycPending: needsKyc(viewer),
    dropshipAlerts, waPending, connectPending, support, nextDemo, adminWa, hasPasskey, login: nextDemo ? await loginStamp(request) : "",
    viewer: {
      role: viewer.role, name: viewer.name, email: viewer.email,
      person: team?.name ?? (admin ? "Super admin" : viewer.name),
      perms: team ? team.perms : null, // null = everything (super admin / store owner)
      isTeam: Boolean(team),
    },
    idleMs: IDLE_MS,
    wallets: ws.map((w) => ({ storeId: w.storeId, balance: w.balancePaise, state: stateOf(w), limit: w.negativeLimitPaise })),
    stores: list.map((s) => ({ id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl, domain: s.shopDomain, profitEnabled: s.profitEnabled, storefront: s.storefrontEnabled, platform: s.platform, businessType: s.businessType, live: isLive(s) })),
    selected,
  }, { headers });
}

export const headers: HeadersFunction = ({ loaderHeaders, actionHeaders }) => {
  const h = new Headers();
  for (const src of [loaderHeaders, actionHeaders]) for (const c of src?.getSetCookie?.() ?? []) h.append("Set-Cookie", c);
  return h;
};

// Cheap loader; re-run on every navigation so the store switcher always shows the current focus
export const shouldRevalidate: ShouldRevalidateFunction = () => true;

type StoreItem = ReturnType<typeof useLoaderData<typeof loader>>["stores"][number];

/** Pages that belong to one store's tools (admin enters "store mode" on these when a store is picked). */
const STORE_TOOL = /^\/dashboard(\/?$|\/orders|\/ads$|\/compare$)|^\/store\//;

export default function DashboardLayout() {
  const { kycPending, viewer, stores, selected, wallets, idleMs, dropshipAlerts, waPending, connectPending, support, nextDemo, login, adminWa, hasPasskey } = useLoaderData<typeof loader>();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); setPalette(false); }, [location.pathname, location.search]);

  const isAdmin = viewer.role === "admin";
  const may = (perm: string) => viewer.perms == null || viewer.perms.includes(perm);
  const urlStore = storeIdFromCode(location.pathname.match(/^\/store\/([^/]+)/)?.[1]);
  const current = stores.find((s) => s.id === (urlStore ?? selected)) ?? null;
  const only = !isAdmin && stores.length === 1 ? stores[0] : null;
  const focus = current ?? only;
  // Admin sees its own panel; a client's store tools only after opening that store
  const storeMode = !isAdmin || (Boolean(current) && STORE_TOOL.test(location.pathname));
  const storeHref = (section: string) => (focus ? `${storePath(focus.id)}/${section}` : `/dashboard/stores?next=${section}`);
  const adsHref = focus ? `${storePath(focus.id)}/ads` : "/dashboard/ads";
  const here = location.pathname + location.search;
  const adminHome = "/dashboard/select?store=all&to=%2Fdashboard";
  const RANK = { ok: 0, low: 1, negative: 2, locked: 3 } as const;
  const focusWallet = focus ? wallets.find((w) => w.storeId === focus.id) ?? null : null;
  const liveIds = new Set(stores.filter((s) => s.live).map((s) => s.id));
  const worst = [...wallets].filter((w) => liveIds.has(w.storeId)).sort((a, b) => RANK[b.state] - RANK[a.state])[0] ?? null;
  const alertWallet = !may("billing") ? null : focus ? (focus.live ? focusWallet : null) : isAdmin ? null : worst;
  const alertStore = alertWallet ? stores.find((s) => s.id === alertWallet.storeId) ?? null : null;
  const own = focus?.platform === "growpefy";
  const storefront = Boolean(isAdmin || focus?.storefront);
  const site = storefront && may("settings");

  // ---- main menu (store tools) ----
  const storeMain: NavNode[] = [
    { label: "Home", to: "/dashboard", icon: "home", end: true, show: may("orders") },
    { label: "Orders", to: "/dashboard/orders", icon: "inbox", match: /^\/dashboard\/orders|\/to-ship$|next=to-ship|\/drafts(\/|$)|next=drafts/, show: may("orders"), children: [
      { label: "Drafts", to: storeHref("drafts"), match: /\/drafts(\/|$)|next=drafts/, show: Boolean(focus) || !isAdmin },
      { label: "Abandoned checkouts", to: "/dashboard/orders/abandoned", show: true },
      { label: "Orders to ship", to: storeHref("to-ship"), match: /\/to-ship$|next=to-ship/, show: storefront },
    ] },
    { label: packOf(focus?.businessType).items, to: storeHref("catalog"), icon: "tag", match: /\/(catalog|collections|inventory)(\/|$)|next=(catalog|collections|inventory)\b/, show: storefront && may("products"), children: [
      { label: "Collections", to: storeHref("collections"), match: /\/collections$|next=collections/, show: true },
      { label: "Inventory", to: storeHref("inventory"), match: /\/inventory$|next=inventory/, show: true },
    ] },
    { label: "Discounts", to: storeHref("promotions"), icon: "discounts", match: /\/(promotions|discounts|coupons|offers|gifts)$|next=(promotions|discounts|coupons|offers|gifts)\b/, show: may("offers") },
    { label: "Marketing", to: adsHref, icon: "ads", match: /\/ads$|\/profit$|\/compare$/, show: may("ads"), children: [
      { label: "Ads", to: adsHref, match: /\/ads$/, show: true },
      { label: "Profit share", to: storeHref("profit"), match: /\/profit$/, show: isAdmin || Boolean(focus?.profitEnabled) },
      { label: "Compare stores", to: "/dashboard/compare", show: !isAdmin && stores.length > 1 },
    ] },
    { label: "Shipping & RTO", to: storeHref("logistics"), icon: "shipping", match: /\/(logistics|rto-shield|rto)$|next=(logistics|rto-shield|rto)\b/, show: may("rto"), children: [
      { label: "Shipments", to: storeHref("logistics"), match: /\/logistics$|next=logistics/, show: true },
      { label: "RTO Shield", to: storeHref("rto-shield"), match: /\/rto-shield$|next=rto-shield/, show: true },
      { label: "RTO Suite", to: storeHref("rto"), match: /\/rto$|next=rto\b/, show: true },
    ] },
    { label: "Analytics", to: storeHref("funnel"), icon: "chart", match: /\/(funnel|diagnostics)$|next=(funnel|diagnostics)\b/, show: may("analytics"), children: [
      { label: "Checkout funnel", to: storeHref("funnel"), match: /\/funnel$|next=funnel/, show: true },
      { label: "Checkout diagnostics", to: storeHref("diagnostics"), match: /\/diagnostics$|next=diagnostics/, show: isAdmin },
    ] },
  ];
  const storeChannels: NavNode[] = [
    { label: "Online Store", to: storeHref("themes"), icon: "stores", match: /\/(themes|pages(\/\d+)?)$|next=(themes|pages)\b/, show: storefront && may("online_store"), children: [
      { label: "Themes", to: storeHref("themes"), match: /\/themes$|next=themes/, show: true },
      { label: "Pages", to: storeHref("pages"), match: /\/pages(\/|$)|next=pages/, show: true },
    ] },
  ];
  // ---- settings (opens its own menu, like Shopify) ----
  const storeSettings: NavNode[] = [
    { label: "Store profile", to: storeHref("settings"), icon: "stores", match: /\/settings$|next=settings\b/, show: may("settings") },
    { label: "Plan & wallet", to: storeHref("wallet"), icon: "wallet", match: /\/wallet$|next=wallet/, show: may("billing"), badge: focusWallet && focus?.live && focusWallet.state !== "ok" ? "Low" : undefined },
    { label: "Team & access", to: "/dashboard/team", icon: "users", show: !isAdmin && may("team") },
    { label: "Payments", to: storeHref("payments"), icon: "rupee", match: /\/payments$|next=payments/, show: may("settings") },
    { label: "Checkout", to: storeHref("design"), icon: "cart", match: /\/design$|next=design/, show: may("settings") },
    { label: "Shipping & delivery", to: storeHref("shipping"), icon: "shipping", match: /\/shipping$|next=shipping\b/, show: may("rto") },
    { label: "Warehouses & locations", to: storeHref("locations"), icon: "box", match: /\/locations$|next=locations\b/, show: may("settings") },
    { label: "WhatsApp", to: storeHref("whatsapp"), icon: "chat", match: /\/whatsapp$|next=whatsapp/, show: may("inbox") || may("settings") },
    { label: "WhatsApp inbox", to: storeHref("inbox"), icon: "inbox", match: /\/inbox$|next=inbox/, show: may("inbox") },
    { label: "Domains", to: storeHref("website"), icon: "globe", match: /\/website$|next=website/, show: may("settings") },
    { label: "Integrations", to: storeHref("integrations"), icon: "plug", match: /\/integrations$|next=integrations/, show: storefront && may("developer") },
    { label: "Store connection", to: storeHref("install"), icon: "setup", match: /\/install$|next=install/, show: may("developer") && !own },
    { label: "Stores", to: "/dashboard/stores", icon: "layers", match: (p, q) => (p === "/dashboard/stores" && !q.includes("next=")) || p === "/dashboard/stores/new" || p === "/dashboard/stores/create", show: !isAdmin },
    { label: "Login & security", to: "/dashboard/security", icon: "lock", show: true },
    { label: "My account", to: "/dashboard/account", icon: "user", show: viewer.isTeam },
  ];

  // ---- Growpefy admin panel ----
  const adminMain: NavNode[] = [
    { label: "Home", to: adminHome, icon: "home", match: (p) => p === "/dashboard", show: true },
    { label: "Leads", to: "/dashboard/leads", icon: "target", show: may("leads") },
    { label: "Clients", to: "/dashboard/clients", icon: "users", show: may("clients") },
    { label: "Support inbox", to: "/dashboard/support", icon: "help", show: may("support"), badge: support || undefined },
    { label: "WhatsApp inbox", to: "/dashboard/whatsapp-inbox", icon: "chat", show: adminWa !== null, badge: adminWa || undefined },
    { label: "Marketing", to: "/dashboard/marketing", icon: "trend", show: may("marketing") },
    { label: "Client stores", to: "/dashboard/stores", icon: "stores", match: (p) => p === "/dashboard/stores", show: may("stores") },
    { label: "Connect requests", to: "/dashboard/connect-requests", icon: "plus", show: may("stores"), badge: connectPending || undefined },
    { label: "Wallets", to: "/dashboard/wallets", icon: "rupee", show: may("billing") },
    { label: "WhatsApp approvals", to: "/dashboard/wa-verify", icon: "shield", show: may("clients"), badge: waPending || undefined },
    { label: "Dropshipping", to: "/dashboard/dropship", icon: "box", show: may("fulfilment"), badge: dropshipAlerts || undefined },
  ];
  const adminSettings: NavNode[] = [
    { label: "Team", to: "/dashboard/team", icon: "users", show: may("team") },
    { label: "Owner accounts", to: "/dashboard/owners", icon: "lock", show: may("clients") },
    { label: "Store domains", to: "/dashboard/cloudflare", icon: "globe", show: !viewer.isTeam },
    { label: "Login & security", to: "/dashboard/security", icon: "shield", show: true },
    { label: "My account", to: "/dashboard/account", icon: "user", show: viewer.isTeam },
  ];

  const settingsList = (storeMode ? storeSettings : adminSettings).filter((n) => n.show);
  const inSettings = settingsList.some((n) => isActive(n, location.pathname, location.search));
  const mainList = (storeMode ? storeMain : adminMain).filter((n) => n.show);
  const channelList = storeMode ? storeChannels.filter((n) => n.show) : [];
  const settingsHome = settingsList[0]?.to ?? "/dashboard/security";

  // Ctrl/Cmd + K opens search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const searchable = [
    ...mainList.flatMap((n) => [{ label: n.label, to: n.to, group: "Menu" }, ...(n.children ?? []).filter((c) => c.show).map((c) => ({ label: c.label, to: c.to, group: n.label }))]),
    ...channelList.flatMap((n) => [{ label: n.label, to: n.to, group: "Sales channels" }, ...(n.children ?? []).filter((c) => c.show).map((c) => ({ label: c.label, to: c.to, group: n.label }))]),
    ...settingsList.map((n) => ({ label: n.label, to: n.to, group: "Settings" })),
  ];

  const nav = (
    <nav className="gp-nav flex h-full flex-col bg-[#1a1a1a] text-[#e3e3e3]">
      {inSettings ? (
        <div className="px-3 pb-2 pt-3">
          <Link to={storeMode ? (may("orders") ? "/dashboard" : storeHref("catalog")) : adminHome} className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-white hover:bg-white/[.06]">
            <Icon name="arrow" className="h-4 w-4 rotate-180 text-[#b5b5b5]" />Settings
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <Link to={isAdmin && !storeMode ? adminHome : "/dashboard"} aria-label="Growpefy home" className="inline-flex"><BrandLockup tone="light" className="h-[22px]" /></Link>
          {isAdmin && <span className="rounded-md bg-white/[.08] px-1.5 py-0.5 text-[10.5px] font-medium text-[#b5b5b5]">{viewer.isTeam ? "Team" : "Admin"}</span>}
        </div>
      )}

      <div className="px-3 pb-2">
        <button type="button" onClick={() => setPalette(true)} className="flex h-8 w-full items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.06] px-2.5 text-[13px] text-[#a6a6a6] transition hover:bg-white/[.09]">
          <Icon name="search" className="h-4 w-4" /><span className="flex-1 text-left">{inSettings ? "Search settings" : "Search"}</span>
          <kbd className="font-sans text-[11px] text-[#8a8a8a]">Ctrl K</kbd>
        </button>
      </div>

      {inSettings && storeMode && focus && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2.5 rounded-lg bg-white/[.06] px-2 py-2">
            <Avatar store={focus} />
            <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-white">{focus.name}</span><span className="block truncate text-[11px] text-[#8a8a8a]">{focus.domain}</span></span>
          </div>
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {isAdmin && storeMode && !inSettings && (
          <Link to={adminHome} className="mb-1 flex h-[30px] items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-[#8fd6b5] hover:bg-white/[.06]">
            <Icon name="arrow" className="h-3.5 w-3.5 rotate-180" />Back to admin panel
          </Link>
        )}
        {inSettings ? (
          <NavList items={settingsList} />
        ) : (
          <>
            <NavList items={mainList} />
            {channelList.length > 0 && (
              <>
                <p className="mb-1 mt-4 px-2 text-[12px] font-medium text-[#8a8a8a]">Sales channels</p>
                <NavList items={channelList} />
              </>
            )}
          </>
        )}
      </div>

      <div className="space-y-0.5 px-3 pb-2">
        {!inSettings && settingsList.length > 0 && <NavList items={[{ label: "Settings", to: settingsHome, icon: "settings", show: true, match: () => false }]} />}
        {!isAdmin && !inSettings && <NavList items={[{ label: "Help & support", to: "/dashboard/support", icon: "help", show: true, badge: support || undefined }]} />}
      </div>
      <AccountMenu stores={stores} current={storeMode ? current ?? only : null} here={here} isAdmin={isAdmin} viewer={viewer} />
    </nav>
  );

  return (
    <div className="admin min-h-screen bg-[#1a1a1a] lg:grid lg:h-screen lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="hidden lg:block"><div className="h-screen">{nav}</div></aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 bg-[#1a1a1a] px-3 text-white lg:hidden">
        <button type="button" className="rounded-lg p-1.5 text-[#e3e3e3] hover:bg-white/10" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Open menu"><Icon name="menu" className="h-5 w-5" /></button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{!storeMode ? (viewer.isTeam ? "Team panel" : "Admin panel") : current?.name ?? (only ? only.name : `All stores (${stores.length})`)}</span>
        <button type="button" className="rounded-lg p-1.5 text-[#e3e3e3] hover:bg-white/10" onClick={() => setPalette(true)} aria-label="Search"><Icon name="search" className="h-5 w-5" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[82%] max-w-[280px] animate-fadein shadow-lift">{nav}</aside>
        </div>
      )}

      <main className="relative min-h-[calc(100vh-48px)] min-w-0 bg-[#f1f1f1] lg:my-2 lg:mr-2 lg:min-h-0 lg:overflow-y-auto lg:rounded-xl">
        <ActionLoader stores={stores} />
        {nextDemo && <DemoBar demo={nextDemo} login={login} />}
        <IdleLogout idleMs={idleMs} />
        <div className={`mx-auto px-4 pb-24 pt-4 sm:px-6 lg:pb-12 lg:pt-5 ${inSettings ? "max-w-[920px]" : "max-w-[1200px]"}`}>
          {alertWallet && alertStore && alertWallet.state !== "ok" && !location.pathname.endsWith("/wallet") && (
            <WalletBanner state={alertWallet.state} balance={alertWallet.balance} store={alertStore.name} showStore={stores.length > 1} to={`${storePath(alertStore.id)}/wallet`} />
          )}
          {kycPending && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-[#fff1e3] px-4 py-2.5 text-[13px] text-[#5e4200] shadow-[0_0_0_1px_rgba(178,132,0,.25)]">
              <Icon name="alert" className="h-4 w-4 shrink-0" />
              <span className="flex-1">Complete your KYC to go live: connect your domain, add payment gateways and recharge your wallet.</span>
              <Link to="/onboarding" className="btn-primary">Complete KYC</Link>
            </div>
          )}
          {!location.pathname.startsWith("/dashboard/security") && <PasskeyPrompt has={hasPasskey} />}
          <Outlet />
        </div>
      </main>

      {palette && <CommandPalette items={searchable} onClose={() => setPalette(false)} />}
    </div>
  );
}

type NavNode = {
  label: string; to: string; icon?: IconName; end?: boolean; show: boolean; badge?: number | string;
  match?: RegExp | ((pathname: string, search: string) => boolean); children?: NavNode[];
};

function isActive(n: NavNode, pathname: string, search: string) {
  const path = n.to.split("?")[0];
  if (typeof n.match === "function") return n.match(pathname, search);
  if (n.match) return n.match.test(pathname) || n.match.test(search);
  return n.end ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

function NavList({ items }: { items: NavNode[] }) {
  const { pathname, search } = useLocation();
  return (
    <ul className="space-y-px">
      {items.map((n) => {
        const kids = (n.children ?? []).filter((c) => c.show);
        const on = isActive(n, pathname, search);
        const kidOn = kids.some((c) => isActive(c, pathname, search));
        return (
          <li key={n.label}>
            <NavLink to={n.to} preventScrollReset
              className={`flex h-[30px] items-center gap-2 rounded-lg px-2 text-[13px] font-medium transition ${on && !kidOn ? "bg-[#303030] text-white" : on ? "text-white" : "text-[#e3e3e3] hover:bg-white/[.06] hover:text-white"}`}>
              {n.icon && <Icon name={n.icon} className={`h-4 w-4 ${on ? "text-white" : "text-[#b5b5b5]"}`} strokeWidth={1.9} />}
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
              {n.badge != null && n.badge !== 0 && <span className="num rounded-md bg-white/[.12] px-1.5 text-[11px] font-semibold leading-[18px] text-white">{n.badge}</span>}
            </NavLink>
            {on && kids.length > 0 && (
              <ul className="mt-px space-y-px">
                {kids.map((c) => {
                  const cOn = isActive(c, pathname, search);
                  return (
                    <li key={c.label}>
                      <NavLink to={c.to} preventScrollReset className={`flex h-[28px] items-center rounded-lg pl-8 pr-2 text-[13px] transition ${cOn ? "bg-[#303030] font-semibold text-white" : "text-[#b5b5b5] hover:bg-white/[.06] hover:text-white"}`}>
                        <span className="truncate">{c.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Ctrl/Cmd + K: jump to any page by typing. */
function CommandPalette({ items, onClose }: { items: { label: string; to: string; group: string }[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const seen = new Set<string>();
  const list = items.filter((x) => {
    const key = `${x.label}|${x.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const t = q.trim().toLowerCase();
    return !t || x.label.toLowerCase().includes(t) || x.group.toLowerCase().includes(t);
  }).slice(0, 12);
  useEffect(() => setI(0), [q]);
  const go = (to: string) => { onClose(); navigate(to); };
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Search">
      <div className="w-full max-w-[560px] animate-fadein overflow-hidden rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08),0_24px_48px_-12px_rgba(0,0,0,.35)]">
        <div className="flex items-center gap-2 border-b border-[#ebebeb] px-3.5">
          <Icon name="search" className="h-4 w-4 text-[#8a8a8a]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages and settings"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(v + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
              else if (e.key === "Enter" && list[i]) go(list[i].to);
            }}
            className="h-11 flex-1 border-0 bg-transparent text-[14px] outline-none placeholder:text-[#8a8a8a]" aria-label="Search pages and settings" />
          <kbd className="rounded border border-[#e3e3e3] px-1.5 font-sans text-[11px] text-[#8a8a8a]">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {list.map((x, n) => (
            <li key={`${x.label}|${x.to}`}>
              <button type="button" onMouseEnter={() => setI(n)} onClick={() => go(x.to)} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] ${n === i ? "bg-[#f1f1f1]" : ""}`}>
                <span className="flex-1 font-medium text-[#303030]">{x.label}</span>
                <span className="text-[12px] text-[#8a8a8a]">{x.group}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-[#8a8a8a]">Nothing found for “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Growpefy loader only for actions that take a moment: connecting APIs, Meta balance, switching store. */
const BUSY_INTENTS: Record<string, string> = {
  saveStore: "Saving and connecting your store",
  testShopify: "Connecting to Shopify",
  testGateways: "Checking payment gateways",
  testMeta: "Connecting to Meta ads",
  checkBalance: "Fetching your Meta balance",
};

function ActionLoader({ stores }: { stores: StoreItem[] }) {
  const nav = useNavigation();
  if (nav.state === "idle") return null;
  const intent = nav.formData?.get("intent");
  if (typeof intent === "string" && BUSY_INTENTS[intent] && nav.state === "submitting") {
    return <BusyOverlay title={BUSY_INTENTS[intent]} note="This can take a few seconds. Please keep this page open." />;
  }
  if (nav.location?.pathname === "/dashboard/select") {
    const id = new URLSearchParams(nav.location.search).get("store");
    const name = stores.find((s) => String(s.id) === id)?.name;
    return <BusyOverlay title={name ? `Switching to ${name}` : "Showing all stores"} />;
  }
  return null;
}

const WARN_MS = 60 * 1000;
const ACTIVE_KEY = "gp:lastActive";

/** Logs out after 10 minutes without activity, across all open tabs. Server enforces the same limit. */
function IdleLogout({ idleMs: IDLE_MS }: { idleMs: number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    let lastPing = Date.now();
    const read = () => { try { return Number(localStorage.getItem(ACTIVE_KEY)) || Date.now(); } catch { return Date.now(); } };
    const mark = () => {
      const now = Date.now();
      try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch { /* private mode */ }
      if (now - lastPing > 60_000) { lastPing = now; fetch("/session/ping", { method: "POST", credentials: "same-origin" }).catch(() => {}); }
    };
    let throttle = 0;
    const onActivity = () => { const n = Date.now(); if (n - throttle > 5000) { throttle = n; mark(); setLeft(null); } };
    const check = () => {
      const idle = Date.now() - read();
      if (idle >= IDLE_MS) {
        fetch("/logout", { method: "POST", body: new URLSearchParams({ reason: "idle" }), credentials: "same-origin" })
          .finally(() => { window.location.href = "/login?expired=1"; });
      } else if (idle >= IDLE_MS - WARN_MS) setLeft(Math.ceil((IDLE_MS - idle) / 1000));
      else setLeft(null);
    };
    mark();
    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(check, 1000);
    return () => { events.forEach((e) => window.removeEventListener(e, onActivity)); document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [IDLE_MS]);
  if (left === null) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 px-4" role="alertdialog" aria-modal="true" aria-labelledby="idle-title">
      <div className="w-full max-w-sm animate-fadein rounded-2xl bg-surface p-6 text-center shadow-lift">
        <BrandIcon className="mx-auto h-10 w-10" />
        <h2 id="idle-title" className="mt-3 text-lg font-semibold">Still there?</h2>
        <p className="mt-1 text-sm text-ink-soft">For your security, you'll be logged out in <b className="num text-ink">{left}s</b> because there's been no activity.</p>
        <div className="mt-5 flex gap-2">
          <Form method="post" action="/logout" className="flex-1"><input type="hidden" name="reason" value="idle" /><button className="btn-secondary w-full">Log out</button></Form>
          <button type="button" className="btn-primary flex-1" onClick={() => { try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch { /* */ } fetch("/session/ping", { method: "POST" }).catch(() => {}); setLeft(null); }}>Stay logged in</button>
        </div>
      </div>
    </div>
  );
}

function WalletBanner({ state, balance, store, showStore, to }: { state: "low" | "negative" | "locked"; balance: number; store: string; showStore: boolean; to: string }) {
  const who = showStore ? `${store} wallet` : "Wallet";
  const copy = {
    low: { tone: "bg-[#fff1e3] text-[#5e4200] shadow-[0_0_0_1px_rgba(178,132,0,.25)]", text: `${who} balance is low (${rupees(balance)}). Recharge soon to keep everything running.` },
    negative: { tone: "bg-[#ffeedd] text-[#6a3200] shadow-[0_0_0_1px_rgba(200,90,0,.25)]", text: `${who} is below ₹0 (${rupees(balance)}). Checkout keeps working, but recharge before you reach the limit.` },
    locked: { tone: "bg-[#fee9e8] text-[#8e1f0b] shadow-[0_0_0_1px_rgba(200,40,20,.25)]", text: `${who} has crossed its limit (${rupees(balance)}). Promo and tracking messages are paused and some features are locked. Checkout, OTP and order confirmations still work.` },
  }[state];
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] ${copy.tone}`} role="status">
      <Icon name="wallet" className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{copy.text}</p>
      <Link to={to} className="btn-primary">Recharge</Link>
    </div>
  );
}

/** Bottom of the menu: the store (switch, connect another) and the person (account, security, log out). */
function AccountMenu({ stores, current, here, isAdmin, viewer }: { stores: StoreItem[]; current: StoreItem | null; here: string; isAdmin: boolean; viewer: { person: string; email: string; isTeam: boolean } }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const to = (id: number | "all") => `/dashboard/select?store=${id}&to=${encodeURIComponent(here)}`;
  const list = stores.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const showStores = !isAdmin || Boolean(current);
  const title = current ? current.name : isAdmin ? (viewer.isTeam ? "Growpefy team" : "Growpefy admin") : stores.length === 1 ? stores[0].name : `All stores (${stores.length})`;

  return (
    <div className="relative border-t border-white/[.08] p-2" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-white/[.06]">
        {current || !isAdmin ? <Avatar store={current ?? (stores.length === 1 ? stores[0] : null)} /> : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#2dd496] text-[12px] font-bold text-[#0b1513]">G</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight text-white">{title}</span>
          <span className="block truncate text-[11px] leading-tight text-[#8a8a8a]">{viewer.person}</span>
        </span>
        <Icon name="chevron" className={`h-3.5 w-3.5 shrink-0 text-[#8a8a8a] transition ${open ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-40 mb-1 animate-fadein overflow-hidden rounded-xl bg-white text-[#303030] shadow-[0_0_0_1px_rgba(0,0,0,.08),0_16px_40px -12px_rgba(0,0,0,.45)]" role="menu">
          {showStores && stores.length > 0 && (
            <>
              {stores.length > 6 && (
                <div className="border-b border-[#ebebeb] p-1.5">
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a store" aria-label="Find a store"
                    className="h-8 w-full rounded-md border border-[#e3e3e3] px-2 text-[13px] outline-none focus:border-[#005bd3]" />
                </div>
              )}
              <div className="max-h-60 overflow-y-auto p-1">
                {!isAdmin && stores.length > 1 && (
                  <Link to={to("all")} preventScrollReset className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-[#f1f1f1]">
                    <Avatar store={null} /><span className="flex-1">All stores</span>{!current && <Icon name="check" className="h-4 w-4" />}
                  </Link>
                )}
                {list.map((s) => (
                  <Link key={s.id} to={to(s.id)} preventScrollReset className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-[#f1f1f1]">
                    <Avatar store={s} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.name}</span><span className="block truncate text-[11px] text-[#8a8a8a]">{s.domain}</span></span>
                    {current?.id === s.id && <Icon name="check" className="h-4 w-4" />}
                  </Link>
                ))}
              </div>
              {!isAdmin && (
                <Link to="/dashboard/stores/new" className="flex items-center gap-2 border-t border-[#ebebeb] px-3 py-2 text-[13px] font-medium hover:bg-[#f7f7f7]"><Icon name="plus" className="h-4 w-4" />Add a store</Link>
              )}
            </>
          )}
          <div className="border-t border-[#ebebeb] p-1">
            <p className="px-2 pb-1 pt-1.5 text-[11.5px] text-[#8a8a8a]">{viewer.email}</p>
            {viewer.isTeam && <MenuLink to="/dashboard/account" icon="user">My account</MenuLink>}
            <MenuLink to="/dashboard/security" icon="lock">Login & security</MenuLink>
            <Form method="post" action="/logout">
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[#f1f1f1]"><Icon name="logout" className="h-4 w-4 text-[#616161]" />Log out</button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, children }: { to: string; icon: IconName; children: React.ReactNode }) {
  return <Link to={to} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-[#f1f1f1]"><Icon name={icon} className="h-4 w-4 text-[#616161]" />{children}</Link>;
}

function Avatar({ store }: { store: StoreItem | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-sm font-semibold text-ink">
      {store?.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-contain p-1" /> : store ? store.name.slice(0, 1).toUpperCase() : <Icon name="stores" className="h-4 w-4 text-pine" />}
    </span>
  );
}

function Tab({ to, end, icon, label }: { to: string; end?: boolean; icon: IconName; label: string }) {
  const location = useLocation();
  const active = end ? location.pathname === to : location.pathname.startsWith(to.split("?")[0]) || (label === "Ads" && location.pathname.endsWith("/ads"));
  return (
    <NavLink to={to} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "font-medium text-pine" : "text-ink-soft"}`}>
      <Icon name={icon} className="h-5 w-5" />{label}
    </NavLink>
  );
}

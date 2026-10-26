import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, NavLink, Outlet, useLoaderData, useLocation, useNavigation, type ShouldRevalidateFunction } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { BrandIcon, BrandLockup, BusyOverlay } from "~/components/Brand";
import { Icon, type IconName } from "~/components/Icons";
import { IDLE_MS, can, needsKyc, requireViewer, touchSession, viewerStores } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { startRechargeWatcher } from "~/lib/recharges.server";
import { startShipmentWatcher } from "~/lib/logistics.server";
import { dropshipAlertCount, startDropshipWatcher } from "~/lib/dropship.server";
import { startRecoveryWatcher } from "~/lib/recovery.server";
import { db, stores as storesTable } from "~/db.server";
import { sql } from "drizzle-orm";
import { selectCookie, selectedStore } from "~/lib/selection.server";
import { rupees } from "~/lib/wallet";
import { stateOf, walletsFor } from "~/lib/wallet.server";
import { supportBadge } from "~/lib/support.server";
import { upcomingDemos } from "~/lib/leads.server";
import { DemoBar, type NextDemo } from "~/components/DemoBar";

export const meta: MetaFunction = () => [{ title: "Dashboard · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  startRechargeWatcher();
  startShipmentWatcher();
  startDropshipWatcher();
  startRecoveryWatcher();
  const viewer = await requireViewer(request);
  // New owners finish the 3-step KYC before anything else
  if (needsKyc(viewer)) throw redirect("/onboarding");
  const list = await viewerStores(viewer);
  // Opening a store page focuses the dashboard on that store
  let selected = await selectedStore(request);
  const inUrl = Number(new URL(request.url).pathname.match(/^\/dashboard\/stores\/(\d+)/)?.[1]);
  const headers = new Headers();
  if (inUrl && inUrl !== selected && list.some((s) => s.id === inUrl)) {
    selected = inUrl;
    headers.append("Set-Cookie", await selectCookie(inUrl));
  }
  const touched = await touchSession(request);
  if (touched) headers.append("Set-Cookie", touched);
  const ws = await walletsFor(list.map((s) => s.id)).catch(() => []);
  const admin = viewer.role === "admin";
  const dropshipAlerts = admin && can(viewer, "fulfilment") ? await dropshipAlertCount().catch(() => 0) : 0;
  const waPending = admin && can(viewer, "clients")
    ? await db.select({ n: sql<number>`count(*)::int` }).from(storesTable).where(sql`${storesTable.waVerify}->>'status' = 'submitted'`).then((r) => Number(r[0]?.n ?? 0)).catch(() => 0)
    : 0;
  const support = can(viewer, "support") || viewer.role === "owner" ? await supportBadge(viewer).catch(() => 0) : 0;
  // Nearest scheduled sales demo → reminder card on every page (admin side, with access to leads)
  const demos = admin && can(viewer, "leads") ? await upcomingDemos(5).catch(() => []) : [];
  const nextDemo: NextDemo | null = demos[0] ? { ...demos[0], more: demos.length - 1 } : null;
  const team = viewer.role === "admin" ? viewer.staff : viewer.member;
  return json({
    dropshipAlerts, waPending, support, nextDemo,
    viewer: {
      role: viewer.role, name: viewer.name, email: viewer.email,
      person: team?.name ?? (admin ? "Super admin" : viewer.name),
      perms: team ? team.perms : null, // null = everything (super admin / store owner)
      isTeam: Boolean(team),
    },
    idleMs: IDLE_MS,
    wallets: ws.map((w) => ({ storeId: w.storeId, balance: w.balancePaise, state: stateOf(w), limit: w.negativeLimitPaise })),
    stores: list.map((s) => ({ id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl, domain: s.checkoutDomain ?? s.shopDomain })),
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
const STORE_TOOL = /^\/dashboard(\/?$|\/orders|\/ads$|\/compare$|\/stores\/\d+)/;

export default function DashboardLayout() {
  const { viewer, stores, selected, wallets, idleMs, dropshipAlerts, waPending, support, nextDemo } = useLoaderData<typeof loader>();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const isAdmin = viewer.role === "admin";
  const may = (perm: string) => viewer.perms == null || viewer.perms.includes(perm);
  const urlStore = Number(location.pathname.match(/^\/dashboard\/stores\/(\d+)/)?.[1]) || null;
  const current = stores.find((s) => s.id === (urlStore ?? selected)) ?? null;
  const only = !isAdmin && stores.length === 1 ? stores[0] : null;
  const focus = current ?? only;
  // Admin sees its own panel; a client's store tools only after opening that store
  const storeMode = !isAdmin || (Boolean(current) && STORE_TOOL.test(location.pathname));
  const storeHref = (section: string) => (focus ? `/dashboard/stores/${focus.id}/${section}` : `/dashboard/stores?next=${section}`);
  const adsHref = focus ? `/dashboard/stores/${focus.id}/ads` : "/dashboard/ads";
  const here = location.pathname + location.search;
  const adminHome = "/dashboard/select?store=all&to=%2Fdashboard";
  const RANK = { ok: 0, low: 1, negative: 2, locked: 3 } as const;
  const focusWallet = focus ? wallets.find((w) => w.storeId === focus.id) ?? null : null;
  const worst = [...wallets].sort((a, b) => RANK[b.state] - RANK[a.state])[0] ?? null;
  const alertWallet = !may("billing") ? null : focus ? focusWallet : isAdmin ? null : worst;
  const alertStore = alertWallet ? stores.find((s) => s.id === alertWallet.storeId) ?? null : null;

  const settingsPaths = ["/settings", "/design", "/install", "/payments", "/dashboard/stores/new", "/dashboard/team"];
  const inSettings = settingsPaths.some((p) => location.pathname.endsWith(p)) || location.pathname === "/dashboard/stores";
  const [settingsOpen, setSettingsOpen] = useState(inSettings);
  useEffect(() => { if (inSettings) setSettingsOpen(true); }, [inSettings]);

  const badge = (n: number, tone = "bg-emerald-400/20 text-emerald-200") => n > 0 && <span className={`num rounded-md px-1.5 py-px text-[11px] font-semibold ${tone}`}>{n}</span>;
  const labelled = (text: string, n: React.ReactNode) => <span className="flex flex-1 items-center justify-between gap-2">{text}{n}</span>;

  // ---- one store's tools (store owners, their team, and admin inside a client's store) ----
  const storeNav = (
    <>
      <Group label="Analytics">
        {may("orders") && <Item to="/dashboard" end icon="overview">Overview</Item>}
        {may("orders") && <Item to="/dashboard/orders" icon="orders">Orders</Item>}
        {may("ads") && <Item to={adsHref} icon="ads" match={/\/ads$/}>Ads</Item>}
        {!isAdmin && may("ads") && stores.length > 1 && <Item to="/dashboard/compare" icon="compare">Compare stores</Item>}
      </Group>
      {(may("inbox") || may("settings") || may("offers") || may("rto")) && (
        <Group label="Sell more">
          {may("inbox") && <Item to={storeHref("inbox")} icon="chat" match={/\/inbox$|\/whatsapp$|next=inbox/}>WhatsApp inbox</Item>}
          {may("settings") && <Item to={storeHref("payments")} icon="rupee" match={/\/payments$|next=payments/}>Payment methods</Item>}
          {may("offers") && <Item to={storeHref("discounts")} icon="discounts" match={/\/discounts$|next=discounts/}>Discounts</Item>}
          {may("offers") && <Item to={storeHref("coupons")} icon="coupons" match={/\/coupons$|next=coupons/}>Coupons</Item>}
          {may("offers") && <Item to={storeHref("offers")} icon="offers" match={/\/offers$|next=offers/}>Bank offers</Item>}
          {may("offers") && <Item to={storeHref("gifts")} icon="gift" match={/\/gifts$|next=gifts/}>Free gifts</Item>}
          {may("rto") && <Item to={storeHref("shipping")} icon="shipping" match={/\/shipping$|next=shipping/}>Shipping</Item>}
        </Group>
      )}
      {may("rto") && (
        <Group label="Protect">
          <Item to={storeHref("logistics")} icon="shipping" match={/\/logistics$|next=logistics/}>Logistics</Item>
          <Item to={storeHref("rto-shield")} icon="shield" match={/\/rto-shield$|next=rto-shield/}>RTO Shield</Item>
          <Item to={storeHref("rto")} icon="shield" match={/\/rto$|next=rto/}>RTO Suite</Item>
        </Group>
      )}
      {may("billing") && (
        <Group label="Billing">
          <Item to={storeHref("wallet")} icon="wallet" match={/\/wallet$|next=wallet/}>
            {labelled("Wallet", focusWallet && <span className={`num rounded-md px-1.5 py-px text-[11px] font-semibold ${focusWallet.state === "ok" ? "bg-white/10 text-night-text" : focusWallet.state === "low" ? "bg-amber-400/20 text-amber-200" : "bg-red-400/20 text-red-200"}`}>{rupees(focusWallet.balance, 0)}</span>)}
          </Item>
        </Group>
      )}
      {(may("settings") || (!isAdmin && may("team"))) && (
        <div>
          <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition hover:bg-white/5 hover:text-white ${inSettings ? "text-white" : ""}`}>
            <Icon name="settings" />
            <span className="flex-1 text-left">Settings</span>
            <Icon name="chevron" className={`h-4 w-4 transition ${settingsOpen ? "rotate-180" : ""}`} />
          </button>
          {settingsOpen && (
            <div className="ml-[21px] mt-0.5 space-y-0.5 border-l border-night-line pl-2.5">
              {may("settings") && <Item to={storeHref("settings")} icon="stores" match={/\/settings$|next=settings/} small>Store settings</Item>}
              {may("settings") && <Item to={storeHref("design")} icon="design" match={/\/design$|next=design/} small>Checkout design</Item>}
              {may("settings") && <Item to={storeHref("install")} icon="setup" match={/\/install$|next=install/} small>Setup</Item>}
              {!isAdmin && may("settings") && <Item to="/dashboard/stores/new" icon="plus" small>Connect store</Item>}
              {!isAdmin && <Item to="/dashboard/stores" icon="stores" match={(p, q) => p === "/dashboard/stores" && !q.includes("next=")} small>All stores</Item>}
              {!isAdmin && may("team") && <Item to="/dashboard/team" icon="users" small>Team</Item>}
            </div>
          )}
        </div>
      )}
    </>
  );

  // ---- Growpefy admin panel ----
  const adminNav = (
    <>
      <Group label="Growpefy">
        <Item to={adminHome} icon="overview" match={(p) => p === "/dashboard"}>Overview</Item>
        {may("leads") && <Item to="/dashboard/leads" icon="target">Leads</Item>}
        {may("clients") && <Item to="/dashboard/clients" icon="users">Clients</Item>}
        {may("support") && <Item to="/dashboard/support" icon="help">{labelled("Support inbox", badge(support))}</Item>}
        {may("marketing") && <Item to="/dashboard/marketing" icon="trend">Marketing</Item>}
      </Group>
      {(may("stores") || may("billing") || may("clients") || may("fulfilment")) && (
        <Group label="Operations">
          {may("stores") && <Item to="/dashboard/stores" icon="stores" match={(p) => p === "/dashboard/stores"}>Client stores</Item>}
          {may("billing") && <Item to="/dashboard/wallets" icon="rupee">Wallets</Item>}
          {may("clients") && <Item to="/dashboard/wa-verify" icon="shield">{labelled("WhatsApp approvals", badge(waPending, "bg-amber-400/20 text-amber-200"))}</Item>}
          {may("fulfilment") && <Item to="/dashboard/dropship" icon="box">{labelled("Dropshipping", badge(dropshipAlerts, "bg-red-400/20 text-red-200"))}</Item>}
        </Group>
      )}
      {(may("team") || may("clients")) && (
        <Group label="Settings">
          {may("team") && <Item to="/dashboard/team" icon="users">Team</Item>}
          {may("clients") && <Item to="/dashboard/owners" icon="lock">Owner accounts</Item>}
        </Group>
      )}
    </>
  );

  const nav = (
    <nav className="flex h-full flex-col bg-night text-night-text">
      <div className="px-5 pb-4 pt-5">
        <Link to={isAdmin ? adminHome : "/dashboard"} aria-label="Growpefy home" className="inline-block"><BrandLockup tone="light" className="h-[30px]" /></Link>
        <div className="mt-2">
          {isAdmin
            ? <p className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-400/20 to-sky-400/20 px-2 py-px text-[11px] font-medium text-emerald-200"><Icon name="sparkle" className="h-3 w-3" />{viewer.isTeam ? "Growpefy team" : "Super admin"}</p>
            : <p className="text-[11px] text-night-faint">Store dashboard</p>}
        </div>
      </div>

      {storeMode && (
        <div className="px-3 pb-3">
          {isAdmin && (
            <Link to={adminHome} className="mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-white/5">
              <Icon name="arrow" className="h-3.5 w-3.5 rotate-180" />Back to admin panel
            </Link>
          )}
          <StoreSwitcher stores={stores} current={current} here={here} allowAll={!isAdmin} />
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {storeMode ? storeNav : adminNav}
      </div>

      {!isAdmin && (
        <div className="border-t border-night-line px-3 py-2">
          <Item to="/dashboard/support" icon="help">{labelled("Help & support", badge(support))}</Item>
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-night-line px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 text-sm font-semibold text-white">{viewer.person.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{viewer.person}</p>
          {viewer.isTeam
            ? <Link to="/dashboard/account" className="block truncate text-xs text-night-faint hover:text-white">{viewer.email} · My account</Link>
            : <p className="truncate text-xs text-night-faint">{viewer.email}</p>}
        </div>
        <Form method="post" action="/logout">
          <button className="rounded-lg p-2 text-night-faint hover:bg-white/5 hover:text-white" aria-label="Log out" title="Log out"><Icon name="logout" /></button>
        </Form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden bg-night lg:block"><div className="sticky top-0 h-screen">{nav}</div></aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-rule bg-paper/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <BrandIcon className="h-8 w-8" />
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="min-w-0">
            <span className="block text-[11px] leading-tight text-ink-faint">{storeMode ? "Showing" : "Growpefy"}</span>
            <span className="block truncate text-sm font-semibold leading-tight">{!storeMode ? (viewer.isTeam ? "Team panel" : "Admin panel") : current?.name ?? (only ? only.name : `All stores (${stores.length})`)}</span>
          </span>
          <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
        <button type="button" className="rounded-lg border border-rule-strong bg-surface p-2" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Open menu"><Icon name="menu" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[86%] max-w-[300px] animate-fadein shadow-lift">
            {nav}
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-lg p-1.5 text-night-faint hover:text-white" aria-label="Close menu"><Icon name="close" /></button>
          </aside>
        </div>
      )}

      <main className="min-w-0 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">
        <ActionLoader stores={stores} />
        <IdleLogout idleMs={idleMs} />
        <div className="mx-auto max-w-[1180px]">
          {nextDemo && <DemoBar demo={nextDemo} />}
          {alertWallet && alertStore && alertWallet.state !== "ok" && !location.pathname.endsWith("/wallet") && (
            <WalletBanner state={alertWallet.state} balance={alertWallet.balance} store={alertStore.name} showStore={stores.length > 1} to={`/dashboard/stores/${alertStore.id}/wallet`} />
          )}
          <Outlet />
        </div>
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-rule bg-surface/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Quick links">
        {storeMode ? (
          <>
            <Tab to="/dashboard" end icon="overview" label="Overview" />
            {may("orders") ? <Tab to="/dashboard/orders" icon="orders" label="Orders" /> : <Tab to={storeHref("inbox")} icon="chat" label="Inbox" />}
            {may("ads") ? <Tab to={adsHref} icon="ads" label="Ads" /> : <Tab to="/dashboard/support" icon="help" label="Help" />}
          </>
        ) : (
          <>
            <Tab to={adminHome} end icon="overview" label="Overview" />
            {may("leads") ? <Tab to="/dashboard/leads" icon="target" label="Leads" /> : <Tab to="/dashboard/support" icon="help" label="Support" />}
            {may("clients") ? <Tab to="/dashboard/clients" icon="users" label="Clients" /> : <Tab to="/dashboard/stores" icon="stores" label="Stores" />}
          </>
        )}
        <button type="button" onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-soft"><Icon name="menu" className="h-5 w-5" />More</button>
      </nav>
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
    low: { tone: "border-amber-200 bg-amber-50 text-amber-900", text: `${who} balance is low (${rupees(balance)}). Recharge soon to keep everything running.` },
    negative: { tone: "border-orange-200 bg-orange-50 text-orange-900", text: `${who} is below ₹0 (${rupees(balance)}). Checkout keeps working, but recharge before you reach the limit.` },
    locked: { tone: "border-red-200 bg-red-50 text-red-900", text: `${who} has crossed its limit (${rupees(balance)}). Promo and tracking messages are paused and some features are locked. Checkout, OTP and order confirmations still work.` },
  }[state];
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${copy.tone}`} role="status">
      <Icon name="wallet" className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1">{copy.text}</p>
      <Link to={to} className="btn-primary px-3 py-1.5 text-xs">Recharge</Link>
    </div>
  );
}

function StoreSwitcher({ stores, current, here, allowAll = true }: { stores: StoreItem[]; current: StoreItem | null; here: string; allowAll?: boolean }) {
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
  const single = stores.length === 1 ? stores[0] : null;
  const shown = current ?? single;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox"
        className="flex w-full items-center gap-2.5 rounded-xl border border-night-line bg-night-soft px-2.5 py-2 text-left transition hover:border-white/20">
        <Avatar store={shown} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] leading-tight text-night-faint">Store</span>
          <span className="block truncate text-sm font-medium leading-tight text-white">{shown ? shown.name : `All stores (${stores.length})`}</span>
        </span>
        <Icon name="chevron" className={`h-4 w-4 shrink-0 text-night-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 z-40 mt-1.5 animate-fadein overflow-hidden rounded-xl border border-night-line bg-night-soft shadow-lift" role="listbox">
          {stores.length > 6 && (
            <div className="border-b border-night-line p-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a store" aria-label="Find a store"
                className="w-full rounded-lg border border-night-line bg-night px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-night-faint focus:border-white/30" />
            </div>
          )}
          <div className="scroll-thin max-h-72 overflow-y-auto p-1.5">
            {allowAll && stores.length > 1 && (
              <Link to={to("all")} preventScrollReset className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-white/5 ${!current ? "text-white" : ""}`}>
                <Avatar store={null} /><span className="flex-1">All stores</span>{!current && <Icon name="check" className="h-4 w-4 text-emerald-300" />}
              </Link>
            )}
            {list.map((s) => (
              <Link key={s.id} to={to(s.id)} preventScrollReset className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-white/5 ${current?.id === s.id ? "text-white" : ""}`}>
                <Avatar store={s} />
                <span className="min-w-0 flex-1"><span className="block truncate">{s.name}</span><span className="block truncate text-[11px] text-night-faint">{s.domain}</span></span>
                {current?.id === s.id ? <Icon name="check" className="h-4 w-4 text-emerald-300" /> : <span className={`h-1.5 w-1.5 rounded-full ${s.active ? "bg-emerald-400" : "bg-night-faint"}`} aria-label={s.active ? "Live" : "Off"} />}
              </Link>
            ))}
          </div>
          {allowAll && <Link to="/dashboard/stores/new" className="flex items-center gap-2 border-t border-night-line px-3.5 py-2.5 text-sm text-emerald-300 hover:bg-white/5"><Icon name="plus" className="h-4 w-4" />Connect a store</Link>}
        </div>
      )}
    </div>
  );
}

function Avatar({ store }: { store: StoreItem | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-sm font-semibold text-ink">
      {store?.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-contain p-1" /> : store ? store.name.slice(0, 1).toUpperCase() : <Icon name="stores" className="h-4 w-4 text-pine" />}
    </span>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-night-faint">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Item({ to, end, icon, match, small, children }: {
  to: string; end?: boolean; icon: IconName; match?: RegExp | ((pathname: string, search: string) => boolean); small?: boolean; children: React.ReactNode;
}) {
  const { pathname, search } = useLocation();
  const path = to.split("?")[0];
  const active = typeof match === "function" ? match(pathname, search)
    : match ? match.test(pathname) || match.test(search)
    : end ? pathname === path : pathname.startsWith(path);
  return (
    <NavLink to={to} preventScrollReset
      className={`group flex items-center gap-3 rounded-lg px-2.5 ${small ? "py-1.5 text-[13px]" : "py-2 text-sm"} transition ${active ? "bg-white/10 font-medium text-white shadow-[inset_2px_0_0_0_#34d399]" : "hover:bg-white/5 hover:text-white"}`}>
      <Icon name={icon} className={`${small ? "h-4 w-4" : "h-[18px] w-[18px]"} ${active ? "text-emerald-300" : "text-night-faint group-hover:text-night-text"}`} />
      {children}
    </NavLink>
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

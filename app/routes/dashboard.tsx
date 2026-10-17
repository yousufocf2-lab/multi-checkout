import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, NavLink, Outlet, useLoaderData, useLocation, type ShouldRevalidateFunction } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Mark } from "~/components/AuthShell";
import { Icon, type IconName } from "~/components/Icons";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";
import { startRechargeWatcher } from "~/lib/recharges.server";
import { selectCookie, selectedStore } from "~/lib/selection.server";

export const meta: MetaFunction = () => [{ title: "Dashboard | Multi Checkout" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  startRechargeWatcher();
  const viewer = await requireViewer(request);
  const list = await viewerStores(viewer);
  // Opening a store page focuses the dashboard on that store
  let selected = await selectedStore(request);
  const inUrl = Number(new URL(request.url).pathname.match(/^\/dashboard\/stores\/(\d+)/)?.[1]);
  const headers = new Headers();
  if (inUrl && inUrl !== selected && list.some((s) => s.id === inUrl)) {
    selected = inUrl;
    headers.append("Set-Cookie", await selectCookie(inUrl));
  }
  return json({
    viewer: { role: viewer.role, name: viewer.name, email: viewer.email },
    stores: list.map((s) => ({ id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl, domain: s.checkoutDomain ?? s.shopDomain })),
    selected,
  }, { headers });
}

export const headers: HeadersFunction = ({ loaderHeaders, actionHeaders }) => {
  const h = new Headers();
  for (const src of [loaderHeaders, actionHeaders]) { const c = src?.get("Set-Cookie"); if (c) h.append("Set-Cookie", c); }
  return h;
};

// Cheap loader; re-run on every navigation so the store switcher always shows the current focus
export const shouldRevalidate: ShouldRevalidateFunction = () => true;

type StoreItem = ReturnType<typeof useLoaderData<typeof loader>>["stores"][number];

export default function DashboardLayout() {
  const { viewer, stores, selected } = useLoaderData<typeof loader>();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const urlStore = Number(location.pathname.match(/^\/dashboard\/stores\/(\d+)/)?.[1]) || null;
  const current = stores.find((s) => s.id === (urlStore ?? selected)) ?? null;
  const only = stores.length === 1 ? stores[0] : null;
  const focus = current ?? only;
  const storeHref = (section: string) => (focus ? `/dashboard/stores/${focus.id}/${section}` : `/dashboard/stores?next=${section}`);
  const adsHref = focus ? `/dashboard/stores/${focus.id}/ads` : "/dashboard/ads";
  const here = location.pathname + location.search;

  const settingsPaths = ["/settings", "/design", "/install", "/dashboard/stores/new", "/dashboard/owners"];
  const inSettings = settingsPaths.some((p) => location.pathname.endsWith(p)) || location.pathname === "/dashboard/stores";
  const [settingsOpen, setSettingsOpen] = useState(inSettings);
  useEffect(() => { if (inSettings) setSettingsOpen(true); }, [inSettings]);

  const nav = (
    <nav className="flex h-full flex-col bg-night text-night-text">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <Mark className="h-8 w-8" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight tracking-tight text-white">Multi Checkout</p>
          {viewer.role === "admin"
            ? <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-400/20 to-sky-400/20 px-2 py-px text-[11px] font-medium text-emerald-200"><Icon name="sparkle" className="h-3 w-3" />Super admin</p>
            : <p className="text-[11px] text-night-faint">Store dashboard</p>}
        </div>
      </div>

      <div className="px-3 pb-3">
        <StoreSwitcher stores={stores} current={current} here={here} />
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        <Group label="Analytics">
          <Item to="/dashboard" end icon="overview">Overview</Item>
          <Item to="/dashboard/orders" icon="orders">Orders</Item>
          <Item to={adsHref} icon="ads" match={/\/ads$/}>Ads</Item>
          {stores.length > 1 && <Item to="/dashboard/compare" icon="compare">Compare stores</Item>}
        </Group>
        <Group label="Sell more">
          <Item to={storeHref("discounts")} icon="discounts" match={/\/discounts$|next=discounts/}>Discounts</Item>
          <Item to={storeHref("coupons")} icon="coupons" match={/\/coupons$|next=coupons/}>Coupons</Item>
          <Item to={storeHref("offers")} icon="offers" match={/\/offers$|next=offers/}>Bank offers</Item>
          <Item to={storeHref("gifts")} icon="gift" match={/\/gifts$|next=gifts/}>Free gifts</Item>
          <Item to={storeHref("shipping")} icon="shipping" match={/\/shipping$|next=shipping/}>Shipping</Item>
        </Group>
        <div>
          <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition hover:bg-white/5 hover:text-white ${inSettings ? "text-white" : ""}`}>
            <Icon name="settings" />
            <span className="flex-1 text-left">Settings</span>
            <Icon name="chevron" className={`h-4 w-4 transition ${settingsOpen ? "rotate-180" : ""}`} />
          </button>
          {settingsOpen && (
            <div className="ml-[21px] mt-0.5 space-y-0.5 border-l border-night-line pl-2.5">
              <Item to={storeHref("settings")} icon="stores" match={/\/settings$|next=settings/} small>Store settings</Item>
              <Item to={storeHref("design")} icon="design" match={/\/design$|next=design/} small>Checkout design</Item>
              <Item to={storeHref("install")} icon="setup" match={/\/install$|next=install/} small>Setup</Item>
              <Item to="/dashboard/stores/new" icon="plus" small>Connect store</Item>
              <Item to="/dashboard/stores" icon="stores" match={(p, q) => p === "/dashboard/stores" && !q.includes("next=")} small>All stores</Item>
              {viewer.role === "admin" && <Item to="/dashboard/owners" icon="users" small>Store owners</Item>}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-night-line px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 text-sm font-semibold text-white">{viewer.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{viewer.name}</p>
          <p className="truncate text-xs text-night-faint">{viewer.email}</p>
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
        <Mark className="h-7 w-7 shrink-0" />
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="min-w-0">
            <span className="block text-[11px] leading-tight text-ink-faint">Showing</span>
            <span className="block truncate text-sm font-semibold leading-tight">{current?.name ?? (only ? only.name : `All stores (${stores.length})`)}</span>
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
        <div className="mx-auto max-w-[1180px]">
          <Outlet />
        </div>
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-rule bg-surface/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Quick links">
        <Tab to="/dashboard" end icon="overview" label="Overview" />
        <Tab to="/dashboard/orders" icon="orders" label="Orders" />
        <Tab to={adsHref} icon="ads" label="Ads" />
        <button type="button" onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-soft"><Icon name="menu" className="h-5 w-5" />More</button>
      </nav>
    </div>
  );
}

function StoreSwitcher({ stores, current, here }: { stores: StoreItem[]; current: StoreItem | null; here: string }) {
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
            {stores.length > 1 && (
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
          <Link to="/dashboard/stores/new" className="flex items-center gap-2 border-t border-night-line px-3.5 py-2.5 text-sm text-emerald-300 hover:bg-white/5"><Icon name="plus" className="h-4 w-4" />Connect a store</Link>
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

import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, NavLink, Outlet, useLoaderData, useLocation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Mark } from "~/components/AuthShell";
import { requireViewer, viewerStores } from "~/lib/auth.server";
import { requireAppHost } from "~/lib/host.server";

export const meta: MetaFunction = () => [{ title: "Dashboard | Multi Checkout" }, { name: "robots", content: "noindex" }];

export async function loader({ request }: LoaderFunctionArgs) {
  requireAppHost(request);
  const viewer = await requireViewer(request);
  const list = await viewerStores(viewer);
  return json({
    viewer: { role: viewer.role, name: viewer.name, email: viewer.email },
    stores: list.map((s) => ({ id: s.id, name: s.name, active: s.active, logoUrl: s.logoUrl })),
  });
}

export default function DashboardLayout() {
  const { viewer, stores } = useLoaderData<typeof loader>();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Mark />
        <span className="text-[15px] font-semibold tracking-tight">Multi Checkout</span>
      </div>
      <div className="space-y-0.5 px-3">
        <Item to="/dashboard" end>Overview</Item>
        <Item to="/dashboard/orders">Orders</Item>
        <Item to="/dashboard/stores" end>Stores</Item>
        {stores.length > 1 && <Item to="/dashboard/compare">Compare stores</Item>}
        {viewer.role === "admin" && <Item to="/dashboard/owners">Store owners</Item>}
      </div>
      <p className="mt-7 px-5 pb-2 text-xs font-medium text-ink-faint">Your stores</p>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {stores.map((s) => (
          <NavLink key={s.id} to={`/dashboard/stores/${s.id}`}
            className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${isActive ? "bg-white font-medium text-ink shadow-sm ring-1 ring-rule" : "text-ink-soft hover:bg-white/70 hover:text-ink"}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.active ? "bg-good" : "bg-rule-strong"}`} aria-label={s.active ? "Live" : "Off"} />
            <span className="truncate">{s.name}</span>
          </NavLink>
        ))}
        <NavLink to="/dashboard/stores/new" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-soft hover:bg-white/70 hover:text-ink">
          <span aria-hidden className="text-base leading-none">+</span> Connect a store
        </NavLink>
      </div>
      <div className="border-t border-rule px-5 py-4">
        <p className="truncate text-sm font-medium">{viewer.name}</p>
        <p className="truncate text-xs text-ink-faint">{viewer.role === "admin" ? "Super admin" : viewer.email}</p>
        <Form method="post" action="/logout" className="mt-3">
          <button className="text-sm text-ink-soft underline-offset-2 hover:text-ink hover:underline">Log out</button>
        </Form>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-rule bg-paper-sunk/60 lg:block">{nav}</aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2"><Mark className="h-6 w-6" /><span className="text-sm font-semibold">Multi Checkout</span></div>
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Open menu">Menu</button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink/30" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] animate-fadein bg-paper shadow-lift">{nav}</aside>
        </div>
      )}

      <main className="min-w-0 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Item({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => `block rounded-lg px-2.5 py-2 text-sm transition ${isActive ? "bg-white font-medium text-ink shadow-sm ring-1 ring-rule" : "text-ink-soft hover:bg-white/70 hover:text-ink"}`}>
      {children}
    </NavLink>
  );
}

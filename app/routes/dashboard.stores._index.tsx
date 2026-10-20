import type { LoaderFunctionArgs } from "@remix-run/node";
import { orderValueSql } from "~/lib/order-value.server";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { Icon } from "~/components/Icons";
import { inArray, sql } from "drizzle-orm";
import { EmptyState, PageHeader, StatusBadge } from "~/components/ui";
import { db, orders, users } from "~/db.server";
import { requireViewer, viewerStores } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const list = await viewerStores(viewer);
  const ids = list.map((s) => s.id);
  const [stats, owners] = await Promise.all([
    ids.length
      ? db.select({
          storeId: orders.storeId,
          count: sql<number>`count(*)::int`,
          revenue: sql<string>`coalesce(sum(${orderValueSql} - ${orders.refunded}), 0)`,
        }).from(orders).where(sql`${inArray(orders.storeId, ids)} and ${orders.status} in ('paid','cod_placed')`).groupBy(orders.storeId)
      : [],
    viewer.role === "admin" ? db.select({ id: users.id, name: users.name }).from(users) : [],
  ]);
  const by = new Map(stats.map((s) => [s.storeId, s]));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  return json({
    isAdmin: viewer.role === "admin",
    stores: list.map((s) => ({
      id: s.id, name: s.name, domain: s.checkoutDomain ?? s.shopDomain, active: s.active, logoUrl: s.logoUrl,
      shopifyReady: Boolean(s.adminToken), payuReady: Boolean(s.payuKey && s.payuSalt), adsReady: Boolean(s.metaAdAccountId && s.metaAccessToken),
      orders: by.get(s.id)?.count ?? 0, revenue: Number(by.get(s.id)?.revenue ?? 0) / 100,
      owner: s.ownerId ? ownerName.get(s.ownerId) ?? null : null,
    })),
  });
}

const SECTIONS: Record<string, string> = {
  discounts: "discounts", coupons: "coupons", offers: "bank offers", gifts: "free gifts", shipping: "shipping",
  settings: "settings", design: "checkout design", install: "setup", wallet: "wallet", rto: "RTO Suite",
  logistics: "logistics", "rto-shield": "RTO Shield",
};

export default function StoresList() {
  const { stores, isAdmin } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  const picking = Boolean(SECTIONS[next]);
  const open = (id: number) => (picking ? `/dashboard/stores/${id}/${next}` : `/dashboard/select?store=${id}&to=/dashboard`);
  return (
    <>
      <PageHeader title={picking ? "Choose a store" : "All stores"}
        description={picking ? `Pick the store whose ${SECTIONS[next]} you want to manage. You can switch any time from the store menu.` : "Every Shopify store connected to your checkout."}
        actions={!picking && <Link to="/dashboard/stores/new" className="btn-primary"><Icon name="plus" className="h-4 w-4" />Connect a store</Link>} />
      {stores.length === 0 ? (
        <EmptyState title="No stores connected" action={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>}>
          Add your first store to start taking orders.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stores.map((s) => (
            <div key={s.id} className="panel flex flex-col p-4 transition hover:shadow-lift">
              <Link to={open(s.id)} className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rule bg-surface text-base font-semibold">
                  {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain p-1" /> : s.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.name}</span>
                  <span className="block truncate text-xs text-ink-faint">{s.domain}</span>
                </span>
                <StatusBadge status={s.active ? "live" : "off"} />
              </Link>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <Check ok={s.shopifyReady} label="Shopify" /><Check ok={s.payuReady} label="PayU" /><Check ok={s.adsReady} label="Meta ads" />
              </div>
              <dl className="num mt-4 grid grid-cols-2 gap-3 border-t border-rule pt-3 text-sm">
                <div><dt className="text-xs text-ink-faint">Orders</dt><dd className="font-semibold">{s.orders.toLocaleString("en-IN")}</dd></div>
                <div><dt className="text-xs text-ink-faint">Revenue</dt><dd className="font-semibold">₹{Math.round(s.revenue).toLocaleString("en-IN")}</dd></div>
              </dl>
              {isAdmin && <p className="mt-2 text-xs text-ink-faint">Owner: {s.owner ?? "You"}</p>}
              <div className="mt-4 flex gap-2">
                <Link to={open(s.id)} className="btn-primary flex-1 py-2">{picking ? `Open ${SECTIONS[next]}` : "Open dashboard"}</Link>
                {!picking && <Link to={`/dashboard/stores/${s.id}/settings`} className="btn-secondary py-2">Settings</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${ok ? "bg-emerald-50 text-good" : "bg-paper-sunk text-ink-faint"}`}>
      <span aria-hidden>{ok ? "✓" : "–"}</span>{label}<span className="sr-only">{ok ? "connected" : "not connected"}</span>
    </span>
  );
}

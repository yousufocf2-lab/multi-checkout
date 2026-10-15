import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
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
          revenue: sql<string>`coalesce(sum(coalesce(${orders.amountPaid}, ${orders.total})), 0)`,
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

export default function StoresList() {
  const { stores, isAdmin } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHeader title="Stores" description="Every Shopify store connected to your checkout." actions={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>} />
      {stores.length === 0 ? (
        <EmptyState title="No stores connected" action={<Link to="/dashboard/stores/new" className="btn-primary">Connect a store</Link>}>
          Add your first store to start taking orders.
        </EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead><tr><th>Store</th><th>Setup</th><th>Status</th>{isAdmin && <th>Owner</th>}<th className="text-right">Orders</th><th className="text-right">Revenue</th></tr></thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="hover:bg-paper/60">
                  <td>
                    <Link to={`/dashboard/stores/${s.id}`} className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-rule bg-white text-sm font-semibold">
                        {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain p-1" /> : s.name.slice(0, 1)}
                      </span>
                      <span><span className="block font-medium">{s.name}</span><span className="block text-xs text-ink-faint">{s.domain}</span></span>
                    </Link>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Check ok={s.shopifyReady} label="Shopify" /><Check ok={s.payuReady} label="PayU" /><Check ok={s.adsReady} label="Meta ads" />
                    </div>
                  </td>
                  <td><StatusBadge status={s.active ? "live" : "off"} /></td>
                  {isAdmin && <td className="text-ink-soft">{s.owner ?? "You"}</td>}
                  <td className="num text-right">{s.orders.toLocaleString("en-IN")}</td>
                  <td className="num text-right font-medium">₹{Math.round(s.revenue).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { desc, inArray, sql } from "drizzle-orm";
import { db, orders, stores } from "~/db.server";
import { requireAdmin } from "~/lib/auth.server";
import { formatINR } from "~/lib/pricing";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const list = await db.select().from(stores).orderBy(desc(stores.createdAt));
  const stats = await db
    .select({
      storeId: orders.storeId,
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(coalesce(${orders.amountPaid}, ${orders.total})), 0)::int`,
    })
    .from(orders)
    .where(inArray(orders.status, ["paid", "cod_placed"]))
    .groupBy(orders.storeId);
  const byStore = new Map(stats.map((s) => [s.storeId, s]));
  return json({
    stores: list.map((s) => ({
      id: s.id, name: s.name, slug: s.slug, shopDomain: s.shopDomain, active: s.active,
      prepaid: s.prepaidDiscountPct, cod: s.codDiscountPct,
      orders: byStore.get(s.id)?.count ?? 0, revenue: byStore.get(s.id)?.revenue ?? 0,
    })),
  });
}

export default function AdminHome() {
  const { stores } = useLoaderData<typeof loader>();
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Stores</h1>
        <Link to="/admin/stores/new" className="btn-primary">+ Connect store</Link>
      </div>
      {stores.length === 0 ? (
        <div className="card text-center text-gray-600">Abhi koi store connect nahi hai. “Connect store” se shuru karein.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <Link key={s.id} to={`/admin/stores/${s.id}`} className="card block hover:border-gray-400">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{s.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs ${s.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>
                  {s.active ? "Live" : "Off"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{s.shopDomain}</p>
              <p className="mt-3 text-sm">Prepaid {s.prepaid}% · COD {s.cod}%</p>
              <p className="mt-1 text-sm text-gray-600">{s.orders} orders · {formatINR(s.revenue)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useSearchParams, useSubmit } from "@remix-run/react";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { EmptyState, Notice, StatusBadge, SubmitButton } from "~/components/ui";
import { db, orders } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { pushToShopify } from "~/lib/orders.server";

const PAGE = 50;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const p = new URL(request.url).searchParams;
  const status = p.get("status") ?? "";
  const q = (p.get("q") ?? "").trim();
  const page = Math.max(1, Number(p.get("page")) || 1);

  const where: SQL[] = [eq(orders.storeId, store.id)];
  if (status === "paid" || status === "cod_placed" || status === "failed") where.push(eq(orders.status, status));
  if (status === "pending") where.push(sql`${orders.status} in ('pending_payment','cod_placing')`);
  if (status === "not_synced") where.push(sql`${orders.status} in ('paid','cod_placed') and ${orders.shopifyOrderId} is null`);
  if (q) {
    const like = `%${q}%`;
    where.push(or(
      ilike(orders.id, like),
      ilike(orders.shopifyOrderName, like),
      sql`${orders.customer}->>'phone' ilike ${like}`,
      sql`(${orders.customer}->>'firstName') || ' ' || (${orders.customer}->>'lastName') ilike ${like}`,
    )!);
  }
  const rows = await db.select().from(orders).where(and(...where)).orderBy(desc(orders.createdAt)).limit(PAGE + 1).offset((page - 1) * PAGE);
  return json({ orders: rows.slice(0, PAGE), hasMore: rows.length > PAGE, page });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const [o] = await db.select().from(orders).where(and(eq(orders.id, String(fd.get("orderId"))), eq(orders.storeId, store.id)));
  if (!o || !["paid", "cod_placed"].includes(o.status)) return json({ ok: null, error: "This order can't be sent to Shopify" });
  const r = await pushToShopify(store, o);
  return r.shopifyOrderId ? json({ ok: `Created ${r.shopifyOrderName} in Shopify`, error: null }) : json({ ok: null, error: r.error ?? "Shopify rejected the order" });
}

const FILTERS = [
  { id: "", label: "All" }, { id: "paid", label: "Paid online" }, { id: "cod_placed", label: "COD" },
  { id: "failed", label: "Failed payment" }, { id: "pending", label: "Awaiting payment" }, { id: "not_synced", label: "Not in Shopify" },
];

const inr = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function Orders() {
  const { orders: list, hasMore, page } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [params] = useSearchParams();
  const submit = useSubmit();
  const status = params.get("status") ?? "";
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    return `?${p}`;
  };

  return (
    <div className="space-y-4">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      {res?.error && <Notice tone="error">{res.error}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {FILTERS.map((f) => (
            <Link key={f.id} to={link({ status: f.id, page: "" })} preventScrollReset
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm ${status === f.id ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink-soft hover:text-ink"}`}>{f.label}</Link>
          ))}
        </div>
        <Form method="get" className="w-full sm:w-72" onChange={(e) => submit(e.currentTarget, { replace: true, preventScrollReset: true })}>
          {status && <input type="hidden" name="status" value={status} />}
          <input type="search" name="q" defaultValue={params.get("q") ?? ""} placeholder="Search name, phone or order" className="input py-2" aria-label="Search orders" />
        </Form>
      </div>

      {list.length === 0 ? (
        <EmptyState title="No orders found">{params.get("q") || status ? "Try a different filter or search." : "Orders placed on your checkout will show up here."}</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead><tr><th>Order</th><th>Customer</th><th className="text-right">Amount</th><th>Discounts</th><th>Status</th><th>Shopify</th></tr></thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id}>
                  <td>
                    <p className="num font-medium">{o.shopifyOrderName ?? o.id}</p>
                    <p className="text-xs text-ink-faint">{new Date(o.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                  </td>
                  <td>
                    <p>{o.customer.firstName} {o.customer.lastName}</p>
                    <p className="num text-xs text-ink-faint">{o.customer.phone}, {o.customer.city}</p>
                  </td>
                  <td className="num text-right">
                    <p className="font-medium">{inr(o.amountPaid ?? o.total)}</p>
                    <p className="text-xs text-ink-faint">{o.items.reduce((n, l) => n + l.quantity, 0)} items</p>
                  </td>
                  <td className="num text-xs text-ink-soft">
                    {o.paymentDiscount > 0 && <p>{o.paymentMethod === "cod" ? "COD" : "Online"} −{inr(o.paymentDiscount)}</p>}
                    {o.couponCode && <p>{o.couponCode} −{inr(o.couponDiscount)}</p>}
                    {o.bankDiscount > 0 && <p>Bank −{inr(o.bankDiscount)}</p>}
                    {!o.paymentDiscount && !o.couponCode && !o.bankDiscount && <span className="text-ink-faint">None</span>}
                  </td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="text-xs">
                    {o.shopifyOrderName ? <span className="text-good">✓ {o.shopifyOrderName}</span>
                      : ["paid", "cod_placed"].includes(o.status) ? (
                        <Form method="post">
                          <input type="hidden" name="orderId" value={o.id} />
                          <SubmitButton intent="retry" className="btn-secondary px-2.5 py-1 text-xs" busyText="Sending">Send to Shopify</SubmitButton>
                        </Form>
                      ) : <span className="text-ink-faint">Not needed</span>}
                    {o.error && !o.shopifyOrderName && <p className="mt-1 max-w-[220px] break-words text-bad">{o.error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex justify-between">
          {page > 1 ? <Link to={link({ page: String(page - 1) })} className="btn-secondary">Newer</Link> : <span />}
          {hasMore && <Link to={link({ page: String(page + 1) })} className="btn-secondary">Older</Link>}
        </div>
      )}
    </div>
  );
}

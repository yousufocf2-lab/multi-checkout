import { Form, Link, useSearchParams, useSubmit } from "@remix-run/react";
import { useState } from "react";
import type { OrderCustomer, OrderLine } from "~/db/schema";
import { EmptyState, StatusBadge, SubmitButton } from "./ui";

import { formatINR as inr } from "~/lib/pricing";
const when = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export type OrderRow = {
  id: string; storeId: number; storeName: string; status: string; paymentMethod: string; customer: OrderCustomer; items: OrderLine[];
  subtotal: number; paymentDiscount: number; couponCode: string | null; couponDiscount: number; bankDiscount: number;
  shipping: number; shippingTitle: string | null; total: number; amountPaid: number | null; refunded: number; refundStatus: string | null;
  payuMihpayid: string | null; shopifyOrderId: string | null; shopifyOrderName: string | null; error: string | null; createdAt: string;
};

const FILTERS = [
  { id: "", label: "All" }, { id: "paid", label: "Paid online" }, { id: "cod_placed", label: "COD" },
  { id: "failed", label: "Failed payment" }, { id: "pending", label: "Awaiting payment" },
  { id: "refunded", label: "Refunds" }, { id: "not_synced", label: "Not in Shopify" },
];

function useLink() {
  const [params] = useSearchParams();
  return (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    return `?${p}`;
  };
}

export function PaymentTag({ method, status }: { method: string; status: string }) {
  if (status === "failed") return <StatusBadge status="failed" />;
  if (status === "pending_payment" || status === "cod_placing") return <StatusBadge status={status} />;
  return method === "cod"
    ? <span className="inline-flex items-center rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-warn">COD</span>
    : <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#1c5cab]">Paid</span>;
}

export function OrdersView({ orders, hasMore, page, showStore }: { orders: OrderRow[]; hasMore: boolean; page: number; showStore: boolean }) {
  const [params] = useSearchParams();
  const submit = useSubmit();
  const link = useLink();
  const status = params.get("status") ?? "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {FILTERS.map((f) => (
            <Link key={f.id} to={link({ status: f.id, page: "" })} preventScrollReset
              className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm ${status === f.id ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink-soft hover:text-ink"}`}>{f.label}</Link>
          ))}
        </div>
        <Form method="get" className="w-full sm:w-72" onChange={(e) => submit(e.currentTarget, { replace: true, preventScrollReset: true })}>
          {[...params.entries()].filter(([k]) => !["q", "page"].includes(k)).map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
          <input type="search" name="q" defaultValue={params.get("q") ?? ""} placeholder="Search name, phone or order" className="input py-2" aria-label="Search orders" />
        </Form>
      </div>

      {orders.length === 0 ? (
        <EmptyState title="No orders found">{params.get("q") || status ? "Try a different filter or search." : "Orders placed on your checkout show up here."}</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[880px]">
            <thead><tr><th>Order</th>{showStore && <th>Store</th>}<th>Customer</th><th>Payment</th><th className="text-right">Amount</th><th>Shopify</th><th /></tr></thead>
            <tbody>{orders.map((o) => <OrderRowView key={o.id} o={o} showStore={showStore} />)}</tbody>
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

function OrderRowView({ o, showStore }: { o: OrderRow; showStore: boolean }) {
  const [open, setOpen] = useState(false);
  const paid = o.amountPaid ?? o.total;
  const okStatus = o.status === "paid" || o.status === "cod_placed";
  return (
    <>
      <tr className={open ? "bg-paper/60" : undefined}>
        <td>
          <p className="num font-medium">{o.shopifyOrderName ?? o.id}</p>
          <p className="text-xs text-ink-faint">{when(o.createdAt)}</p>
        </td>
        {showStore && <td className="text-sm">{o.storeName}</td>}
        <td>
          <p>{o.customer.firstName} {o.customer.lastName}</p>
          <p className="num text-xs text-ink-faint">{o.customer.phone}, {o.customer.city}</p>
        </td>
        <td>
          <div className="flex flex-wrap items-center gap-1.5">
            <PaymentTag method={o.paymentMethod} status={o.status} />
            {o.refundStatus && <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-bad">{o.refundStatus === "full" ? "Refunded" : o.refundStatus === "partial" ? "Part refunded" : "Refund pending"}</span>}
          </div>
        </td>
        <td className="num text-right">
          <p className="font-medium">{inr(paid - o.refunded)}</p>
          <p className="text-xs text-ink-faint">{(() => { const n = o.items.reduce((a, l) => a + l.quantity, 0); return `${n} item${n === 1 ? "" : "s"}`; })()}</p>
        </td>
        <td className="text-xs">
          {o.shopifyOrderName ? <span className="text-good">✓ {o.shopifyOrderName}</span>
            : okStatus ? <span className="text-warn">Not created yet</span> : <span className="text-ink-faint">Not needed</span>}
        </td>
        <td className="text-right"><button type="button" className="btn-quiet text-xs" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? "Hide" : "Details"}</button></td>
      </tr>
      {open && (
        <tr className="bg-paper/60">
          <td colSpan={showStore ? 7 : 6}>
            <div className="grid gap-5 py-2 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-medium text-ink-soft">Items</p>
                <ul className="space-y-1.5 text-sm">
                  {o.items.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.title}{l.variantTitle ? `, ${l.variantTitle}` : ""} ×{l.quantity}</span><span className="num">{inr(l.pricePaise * l.quantity)}</span></li>)}
                </ul>
              </div>
              <dl className="num space-y-1 text-sm">
                <p className="mb-2 text-xs font-medium text-ink-soft">Payment</p>
                <div className="flex justify-between"><dt className="text-ink-soft">Items</dt><dd>{inr(o.subtotal)}</dd></div>
                {o.paymentDiscount > 0 && <div className="flex justify-between"><dt className="text-ink-soft">{o.paymentMethod === "cod" ? "COD" : "Online"} discount</dt><dd>−{inr(o.paymentDiscount)}</dd></div>}
                {o.couponCode && <div className="flex justify-between"><dt className="text-ink-soft">{o.couponCode}</dt><dd>−{inr(o.couponDiscount)}</dd></div>}
                {o.bankDiscount > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Bank offer</dt><dd>−{inr(o.bankDiscount)}</dd></div>}
                <div className="flex justify-between"><dt className="text-ink-soft">{o.shippingTitle ?? "Delivery"}</dt><dd>{o.shipping ? inr(o.shipping) : "Free"}</dd></div>
                <div className="flex justify-between border-t border-rule pt-1 font-medium"><dt>{o.paymentMethod === "cod" ? "To collect" : "Paid"}</dt><dd>{inr(paid)}</dd></div>
                {o.refunded > 0 && <div className="flex justify-between text-bad"><dt>Refunded</dt><dd>−{inr(o.refunded)}</dd></div>}
              </dl>
              <div className="space-y-2 text-sm">
                <p className="text-xs font-medium text-ink-soft">Delivery address</p>
                <p className="text-ink-soft">{o.customer.address1}{o.customer.address2 ? `, ${o.customer.address2}` : ""}, {o.customer.city}, {o.customer.state} {o.customer.pincode}</p>
                {o.payuMihpayid && <p className="text-xs text-ink-faint">PayU ID {o.payuMihpayid}, checkout ID {o.id}</p>}
                {o.error && <p className="break-words text-xs text-bad">{o.error}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {okStatus && !o.shopifyOrderId && (
                    <Form method="post"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
                      <SubmitButton intent="retry" className="btn-secondary px-3 py-1.5 text-xs" busyText="Sending">Send to Shopify</SubmitButton></Form>
                  )}
                  {o.paymentMethod === "prepaid" && (
                    <Form method="post"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
                      <SubmitButton intent="verify" className="btn-secondary px-3 py-1.5 text-xs" busyText="Checking">Check payment with PayU</SubmitButton></Form>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export type AbandonedItem = { id: string; storeName: string; name: string; phone: string; city: string; cart: { title: string; variantTitle: string | null; image: string | null; quantity: number; pricePaise: number }[]; value: number; stage: string; lastActive: string; link: string | null };

export function AbandonedView({ data, showStore }: { data: { items: AbandonedItem[]; count: number; value: number; withPhone: boolean; hasMore: boolean; page: number }; showStore: boolean }) {
  const link = useLink();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="num text-sm text-ink-soft"><b className="text-ink">{data.count.toLocaleString("en-IN")}</b> abandoned checkouts worth <b className="text-ink">₹{Math.round(data.value).toLocaleString("en-IN")}</b></p>
        <div className="flex gap-1.5">
          <Link to={link({ all: "", page: "" })} preventScrollReset className={`rounded-lg border px-3 py-1.5 text-sm ${data.withPhone ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink-soft"}`}>With phone number</Link>
          <Link to={link({ all: "1", page: "" })} preventScrollReset className={`rounded-lg border px-3 py-1.5 text-sm ${!data.withPhone ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink-soft"}`}>All</Link>
        </div>
      </div>
      {data.items.length === 0 ? (
        <EmptyState title="No abandoned checkouts">Checkouts that were left for more than 30 minutes without an order show up here.</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead><tr><th>Customer</th>{showStore && <th>Store</th>}<th>Cart</th><th className="text-right">Value</th><th>Where they left</th><th>Recover</th></tr></thead>
            <tbody>
              {data.items.map((a) => {
                const msg = `Hi${a.name ? " " + a.name.split(" ")[0] : ""}, you left items in your cart${a.storeName ? ` at ${a.storeName}` : ""}. Complete your order here: ${a.link ?? ""}`;
                return (
                  <tr key={a.id}>
                    <td>
                      <p className="font-medium">{a.name || <span className="text-ink-faint">No name</span>}</p>
                      <p className="num text-xs text-ink-faint">{a.phone || "No phone"}{a.city ? `, ${a.city}` : ""}</p>
                      <p className="text-xs text-ink-faint">{when(a.lastActive)}</p>
                    </td>
                    {showStore && <td className="text-sm">{a.storeName}</td>}
                    <td className="max-w-[280px] text-sm">
                      {a.cart.slice(0, 3).map((l, i) => <p key={i} className="truncate">{l.title} ×{l.quantity}</p>)}
                      {a.cart.length > 3 && <p className="text-xs text-ink-faint">+{a.cart.length - 3} more</p>}
                    </td>
                    <td className="num text-right font-medium">₹{Math.round(a.value).toLocaleString("en-IN")}</td>
                    <td className="text-sm text-ink-soft">{a.stage}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {a.phone && a.link && <a className="btn-secondary px-2.5 py-1 text-xs" href={`https://wa.me/91${a.phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                        {a.phone && <a className="btn-secondary px-2.5 py-1 text-xs" href={`tel:+91${a.phone}`}>Call</a>}
                        {a.link ? <CopyLink url={a.link} /> : <span className="text-xs text-ink-faint">Link expired</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-faint">Recovery links open the customer's saved cart and stay valid for 7 days from when they started checkout.</p>
      {(data.page > 1 || data.hasMore) && (
        <div className="flex justify-between">
          {data.page > 1 ? <Link to={link({ page: String(data.page - 1) })} className="btn-secondary">Newer</Link> : <span />}
          {data.hasMore && <Link to={link({ page: String(data.page + 1) })} className="btn-secondary">Older</Link>}
        </div>
      )}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => { navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

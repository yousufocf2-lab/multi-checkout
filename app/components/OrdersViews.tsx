import { gatewayName } from "~/lib/gateways/catalog";
import { courierById } from "~/lib/courier-catalog";
import { SHIP_STATUS_LABELS } from "~/lib/rto-shield";
import { DownloadLink } from "./DownloadLink";
import { orderValuePaise, toCollectPaise } from "~/lib/payment-methods";
import { Form, Link, useSearchParams, useSubmit } from "@remix-run/react";
import { useState } from "react";
import type { OrderCustomer, OrderLine } from "~/db/schema";
import { PRESETS } from "~/lib/dates";
import { INDIAN_STATES } from "~/lib/states";
import { Icon } from "./Icons";
import { RangePicker } from "./Overview";
import { EmptyState, StatusBadge, SubmitButton } from "./ui";

import { formatINR as inr } from "~/lib/pricing";
const when = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export type OrderRow = {
  id: string; storeId: number; storeName: string; status: string; paymentMethod: string; customer: OrderCustomer; items: OrderLine[];
  subtotal: number; paymentDiscount: number; couponCode: string | null; couponDiscount: number; bankDiscount: number; offerDiscount: number;
  shipping: number; shippingTitle: string | null; total: number; amountPaid: number | null; advance: number | null; paymentFee: number; confirmStatus: string | null; refunded: number; refundStatus: string | null;
  payuMihpayid: string | null; awb?: string | null; courier?: string | null; shipStatus?: string | null; gateway?: string | null; gatewayRef?: string | null; shopifyOrderId: string | null; shopifyOrderName: string | null; error: string | null; createdAt: string;
};

const STATUS_TABS = [
  { id: "", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "pending", label: "Awaiting payment" },
];
const METHODS = [{ id: "", label: "All payments" }, { id: "prepaid", label: "Prepaid" }, { id: "cod", label: "COD" }, { id: "partial", label: "Partial COD" }];
const TAGS = [
  { id: "", label: "Any" }, { id: "coupon", label: "Coupon used" }, { id: "bank", label: "Bank offer used" },
  { id: "refunded", label: "Refunded" }, { id: "not_synced", label: "Not in store" },
  { id: "paid_shipping", label: "Paid delivery" }, { id: "free_shipping", label: "Free delivery" },
];

function useLink() {
  const [params] = useSearchParams();
  return (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    p.delete("page");
    if (patch.page) p.set("page", patch.page);
    return `?${p}`;
  };
}

export function PaymentTag({ method, status }: { method: string; status: string }) {
  if (status === "failed") return <StatusBadge status="failed" />;
  if (status === "pending_payment" || status === "cod_placing") return <StatusBadge status={status} />;
  if (method === "partial") return <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">Partial COD</span>;
  return method === "cod"
    ? <span className="inline-flex items-center rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-warn">COD</span>
    : <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#1c5cab]">Paid</span>;
}

export type OrdersFilterState = { status: string; method: string; tag: string; product: string; state: string; q: string; min: string; max: string; range: { preset: string; since: string; until: string } };
export type OrdersSummary = { count: number; value: number; prepaid: number; cod: number; aov: number };

const rupee = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");

export function OrdersView({ orders, hasMore, page, showStore, filters: f, summary, products, exportHref }: {
  orders: OrderRow[]; hasMore: boolean; page: number; showStore: boolean;
  filters: OrdersFilterState; summary: OrdersSummary; products: string[]; exportHref: string;
}) {
  const [params] = useSearchParams();
  const submit = useSubmit();
  const link = useLink();
  const extra = [f.min || f.max, f.product, f.tag, f.state].filter(Boolean).length;
  const [panel, setPanel] = useState(false);

  const chips: { label: string; clear: Record<string, string> }[] = [];
  if (f.method) chips.push({ label: f.method === "cod" ? "COD" : f.method === "partial" ? "Partial COD" : "Prepaid", clear: { method: "" } });
  if (f.range.preset !== "max") chips.push({ label: f.range.preset === "custom" ? `${f.range.since} → ${f.range.until}` : PRESETS.find((p) => p.id === f.range.preset)?.label ?? "", clear: { range: "", from: "", to: "" } });
  if (f.min || f.max) chips.push({ label: f.min && f.max ? `₹${f.min} – ₹${f.max}` : f.min ? `₹${f.min} and above` : `Up to ₹${f.max}`, clear: { min: "", max: "" } });
  if (f.product) chips.push({ label: f.product, clear: { product: "" } });
  if (f.tag) chips.push({ label: TAGS.find((t) => t.id === f.tag)?.label ?? f.tag, clear: { tag: "" } });
  if (f.state) chips.push({ label: INDIAN_STATES.find((s) => s.code === f.state)?.name ?? f.state, clear: { state: "" } });
  if (f.q) chips.push({ label: `“${f.q}”`, clear: { q: "" } });
  const clearAll = link({ method: "", range: "", from: "", to: "", min: "", max: "", product: "", tag: "", state: "", q: "" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5" role="tablist" aria-label="Order status">
          {STATUS_TABS.map((t) => (
            <Link key={t.id} to={link({ status: t.id })} preventScrollReset role="tab" aria-selected={f.status === t.id}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${f.status === t.id ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{t.label}</Link>
          ))}
        </div>
        <Form method="get" className="w-full sm:w-72" onChange={(e) => submit(e.currentTarget, { replace: true, preventScrollReset: true })}>
          {[...params.entries()].filter(([k]) => !["q", "page"].includes(k)).map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
          <input type="search" name="q" defaultValue={f.q} placeholder="Search name, phone, city or order" className="input py-2" aria-label="Search orders" />
        </Form>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RangePicker current={f.range} />
        <div className="inline-flex h-9 items-center rounded-lg border border-rule-strong bg-surface p-0.5">
          {METHODS.map((m) => (
            <Link key={m.id} to={link({ method: m.id })} preventScrollReset
              className={`rounded-md px-2.5 py-1 text-sm ${f.method === m.id ? "bg-paper-sunk font-medium text-ink" : "text-ink-soft hover:text-ink"}`}>{m.label}</Link>
          ))}
        </div>
        <button type="button" onClick={() => setPanel((o) => !o)} aria-expanded={panel}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm ${panel || extra ? "border-ink bg-ink text-white" : "border-rule-strong bg-surface text-ink-soft hover:text-ink"}`}>
          <Icon name="filter" className="h-4 w-4" />More filters{extra > 0 && <span className="num rounded bg-white/20 px-1.5 text-xs">{extra}</span>}
        </button>
        <DownloadLink href={exportHref} title="Preparing your CSV" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rule-strong bg-surface px-3 text-sm text-ink-soft hover:text-ink sm:ml-auto">
          <Icon name="download" className="h-4 w-4" />Export CSV
        </DownloadLink>
      </div>

      {panel && (
        <Form method="get" preventScrollReset className="panel grid animate-fadein gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={() => setPanel(false)}>
          {[...params.entries()].filter(([k]) => !["min", "max", "product", "tag", "state", "page"].includes(k)).map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="label">Order amount (₹)</span>
            <div className="flex items-center gap-2">
              <input name="min" inputMode="numeric" defaultValue={f.min} placeholder="From" className="input num" aria-label="Minimum amount" />
              <span className="text-ink-faint">–</span>
              <input name="max" inputMode="numeric" defaultValue={f.max} placeholder="To" className="input num" aria-label="Maximum amount" />
            </div>
          </div>
          <label className="block lg:col-span-2">
            <span className="label">Product</span>
            <select name="product" defaultValue={f.product} className="input">
              <option value="">Any product</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Tag</span>
            <select name="tag" defaultValue={f.tag} className="input">{TAGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </label>
          <label className="block">
            <span className="label">State</span>
            <select name="state" defaultValue={f.state} className="input">
              <option value="">All states</option>
              {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
          <div className="flex items-center justify-end gap-2 sm:col-span-2 lg:col-span-5">
            <Link to={link({ min: "", max: "", product: "", tag: "", state: "" })} preventScrollReset className="btn-quiet" onClick={() => setPanel(false)}>Reset</Link>
            <button className="btn-primary">Apply filters</button>
          </div>
        </Form>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <Link key={c.label} to={link(c.clear)} preventScrollReset className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-rule-strong bg-surface py-0.5 pl-2.5 pr-1.5 text-xs text-ink hover:border-ink/40">
              <span className="truncate">{c.label}</span><Icon name="close" className="h-3.5 w-3.5 text-ink-faint" /><span className="sr-only">Remove filter</span>
            </Link>
          ))}
          <Link to={clearAll} preventScrollReset className="px-1.5 text-xs font-medium text-pine hover:underline">Clear all</Link>
        </div>
      )}

      <div className="num flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
        <span><b className="text-ink">{summary.count.toLocaleString("en-IN")}</b> orders</span>
        <span><b className="text-ink">{rupee(summary.value)}</b> total</span>
        <span>Prepaid <b className="text-ink">{summary.prepaid.toLocaleString("en-IN")}</b></span>
        <span>COD <b className="text-ink">{summary.cod.toLocaleString("en-IN")}</b></span>
        {summary.count > 0 && <span>Avg. <b className="text-ink">{rupee(summary.aov)}</b></span>}
      </div>

      {orders.length === 0 ? (
        <EmptyState title="No orders found">{chips.length || f.status ? "Try removing a filter." : "Orders placed on your checkout show up here."}</EmptyState>
      ) : (
        <>
          <ul className="space-y-2.5 sm:hidden">{orders.map((o) => <OrderCard key={o.id} o={o} showStore={showStore} />)}</ul>
          <div className="panel hidden overflow-x-auto sm:block">
            <table className="table min-w-[880px]">
              <thead><tr><th>Order</th>{showStore && <th>Store</th>}<th>Customer</th><th>Payment</th><th className="text-right">Amount</th><th>Store order</th><th /></tr></thead>
              <tbody>{orders.map((o) => <OrderRowView key={o.id} o={o} showStore={showStore} />)}</tbody>
            </table>
          </div>
        </>
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

const itemsLabel = (o: OrderRow) => { const n = o.items.reduce((a, l) => a + l.quantity, 0); return `${n} item${n === 1 ? "" : "s"}`; };

function ConfirmTag({ s }: { s: string | null }) {
  if (!s) return null;
  const v = s === "confirmed" ? ["bg-emerald-50 text-good", "✅ Confirmed"] : s === "cancelled" ? ["bg-red-50 text-bad", "❌ Cancelled"] : ["bg-paper-sunk text-ink-soft", "💬 Awaiting reply"];
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${v[0]}`} title="WhatsApp confirmation">{v[1]}</span>;
}

const SHIP_CHIP: Record<string, string> = {
  in_transit: "bg-sky-50 text-sky-800", delivered: "bg-emerald-50 text-good", rto_transit: "bg-amber-50 text-amber-800",
  rto: "bg-red-50 text-bad", returned: "bg-fuchsia-50 text-fuchsia-800", cancelled: "bg-paper-sunk text-ink-soft",
};
/** Shipment status once the order is fulfilled with an AWB. */
function ShipTag({ o }: { o: OrderRow }) {
  if (!o.awb && !o.shipStatus) return null;
  const s = o.shipStatus ?? "in_transit";
  const label = (SHIP_STATUS_LABELS as Record<string, string>)[s] ?? "Fulfilled";
  const courier = o.courier ? courierById(o.courier)?.name ?? o.courier : null;
  return <span title={[courier, o.awb ? `AWB ${o.awb}` : null].filter(Boolean).join(" · ")} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${SHIP_CHIP[s] ?? SHIP_CHIP.in_transit}`}><Icon name="shipping" className="h-3.5 w-3.5" />{label}</span>;
}

function RefundTag({ o }: { o: OrderRow }) {
  if (!o.refundStatus) return null;
  return <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-bad">{o.refundStatus === "full" ? "Refunded" : o.refundStatus === "partial" ? "Part refunded" : "Refund pending"}</span>;
}

function OrderCard({ o, showStore }: { o: OrderRow; showStore: boolean }) {
  const [open, setOpen] = useState(false);
  const paid = orderValuePaise(o);
  return (
    <li className="panel overflow-hidden">
      <button type="button" className="flex w-full items-start gap-3 p-3.5 text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5"><span className="num text-sm font-semibold">{o.shopifyOrderName ?? o.id}</span><PaymentTag method={o.paymentMethod} status={o.status} /><ConfirmTag s={o.confirmStatus} /><RefundTag o={o} /><ShipTag o={o} /></p>
          <p className="mt-1 truncate text-sm">{o.customer.firstName} {o.customer.lastName}<span className="text-ink-faint">, {o.customer.city}</span></p>
          <p className="truncate text-xs text-ink-faint">{showStore && `${o.storeName} · `}{when(o.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className="num font-semibold">{inr(paid - o.refunded)}</p>
          <p className="text-xs text-ink-faint">{itemsLabel(o)}</p>
        </div>
      </button>
      {open && <div className="border-t border-rule bg-paper/60 px-3.5 py-3"><OrderDetails o={o} /></div>}
    </li>
  );
}

function OrderRowView({ o, showStore }: { o: OrderRow; showStore: boolean }) {
  const [open, setOpen] = useState(false);
  const paid = orderValuePaise(o);
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
        <td><div className="flex flex-wrap items-center gap-1.5"><PaymentTag method={o.paymentMethod} status={o.status} /><ConfirmTag s={o.confirmStatus} /><RefundTag o={o} /><ShipTag o={o} /></div></td>
        <td className="num text-right">
          <p className="font-medium">{inr(paid - o.refunded)}</p>
          <p className="text-xs text-ink-faint">{itemsLabel(o)}</p>
        </td>
        <td className="text-xs">
          {o.shopifyOrderName ? <span className="text-good">✓ {o.shopifyOrderName}</span>
            : okStatus ? <span className="text-warn">Not created yet</span> : <span className="text-ink-faint">Not needed</span>}
        </td>
        <td className="text-right"><button type="button" className="btn-quiet text-xs" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? "Hide" : "Details"}</button></td>
      </tr>
      {open && (
        <tr className="bg-paper/60">
          <td colSpan={showStore ? 7 : 6}><div className="py-2"><OrderDetails o={o} /></div></td>
        </tr>
      )}
    </>
  );
}

function OrderDetails({ o }: { o: OrderRow }) {
  const paid = orderValuePaise(o);
  const okStatus = o.status === "paid" || o.status === "cod_placed";
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <div>
        <p className="mb-2 text-xs font-medium text-ink-soft">Items</p>
        <ul className="space-y-1.5 text-sm">
          {o.items.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.title}{l.variantTitle ? `, ${l.variantTitle}` : ""} ×{l.quantity}</span><span className="num">{l.free ? <b className="text-good">FREE</b> : inr(l.pricePaise * l.quantity)}</span></li>)}
        </ul>
      </div>
      <dl className="num space-y-1 text-sm">
        <p className="mb-2 text-xs font-medium text-ink-soft">Payment</p>
        <div className="flex justify-between"><dt className="text-ink-soft">Items</dt><dd>{inr(o.subtotal)}</dd></div>
        {o.paymentDiscount > 0 && <div className="flex justify-between"><dt className="text-ink-soft">{o.paymentMethod === "cod" ? "COD" : o.paymentMethod === "partial" ? "Partial COD" : "Online"} discount</dt><dd>−{inr(o.paymentDiscount)}</dd></div>}
        {o.couponCode && <div className="flex justify-between"><dt className="text-ink-soft">{o.couponCode}</dt><dd>−{inr(o.couponDiscount)}</dd></div>}
        {o.offerDiscount > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Mix & Match</dt><dd>−{inr(o.offerDiscount)}</dd></div>}
        {o.bankDiscount > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Bank offer</dt><dd>−{inr(o.bankDiscount)}</dd></div>}
        <div className="flex justify-between"><dt className="text-ink-soft">{o.shippingTitle ?? "Delivery"}</dt><dd>{o.shipping ? inr(o.shipping) : "Free"}</dd></div>
        {o.paymentFee > 0 && <div className="flex justify-between"><dt className="text-ink-soft">{o.paymentMethod === "prepaid" ? "Online payment" : o.paymentMethod === "partial" ? "Partial COD" : "COD"} fee</dt><dd>{inr(o.paymentFee)}</dd></div>}
        {o.paymentMethod === "partial" ? (
          <>
            <div className="flex justify-between border-t border-rule pt-1 font-medium"><dt>Advance paid</dt><dd>{inr(o.amountPaid ?? o.advance ?? 0)}</dd></div>
            <div className="flex justify-between font-medium"><dt>To collect</dt><dd>{inr(toCollectPaise(o))}</dd></div>
          </>
        ) : (
          <div className="flex justify-between border-t border-rule pt-1 font-medium"><dt>{o.paymentMethod === "cod" ? "To collect" : "Paid"}</dt><dd>{inr(paid)}</dd></div>
        )}
        {o.refunded > 0 && <div className="flex justify-between text-bad"><dt>Refunded</dt><dd>−{inr(o.refunded)}</dd></div>}
      </dl>
      <div className="space-y-2 text-sm">
        <p className="text-xs font-medium text-ink-soft">Delivery address</p>
        <p className="text-ink-soft">{o.customer.firstName} {o.customer.lastName}, <a className="num underline" href={`tel:+91${o.customer.phone}`}>{o.customer.phone}</a></p>
        <p className="text-ink-soft">{o.customer.address1}{o.customer.address2 ? `, ${o.customer.address2}` : ""}, {o.customer.city}, {o.customer.state} {o.customer.pincode}</p>
        {(o.gatewayRef || o.payuMihpayid) && <p className="text-xs text-ink-faint">{gatewayName(o.gateway ?? "payu")} ID {o.gatewayRef ?? o.payuMihpayid}, checkout ID {o.id}</p>}
        {o.error && <p className="break-words text-xs text-bad">{o.error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {okStatus && !o.shopifyOrderId && (
            <Form method="post"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
              <SubmitButton intent="retry" className="btn-secondary px-3 py-1.5 text-xs" busyText="Sending">Send to store</SubmitButton></Form>
          )}
          {o.paymentMethod !== "cod" && (
            <Form method="post"><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
              <SubmitButton intent="verify" className="btn-secondary px-3 py-1.5 text-xs" busyText="Checking">Check payment</SubmitButton></Form>
          )}
        </div>
      </div>
    </div>
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

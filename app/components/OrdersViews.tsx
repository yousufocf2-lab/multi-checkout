import { gatewayName } from "~/lib/gateways/catalog";
import { courierById } from "~/lib/courier-catalog";
import { SHIP_STATUS_LABELS } from "~/lib/rto-shield";
import { orderValuePaise, toCollectPaise } from "~/lib/payment-methods";
import { Form, Link, useLocation, useNavigation, useSearchParams, useNavigate } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { OrderCustomer, OrderLine } from "~/db/schema";
import { INDIAN_STATES } from "~/lib/states";
import { Icon } from "./Icons";
import { RangePicker } from "./Overview";
import { EmptyState, StatusBadge, SubmitButton } from "./ui";

import { formatINR as inr } from "~/lib/pricing";
const when = (d: string) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export type OrderRow = {
  id: string; storeId: number; storeName: string; status: string; paymentMethod: string; customer: OrderCustomer; items: OrderLine[];
  subtotal: number; paymentDiscount: number; couponCode: string | null; couponDiscount: number; bankDiscount: number; offerDiscount: number;
  shipping: number; shippingTitle: string | null; total: number; amountPaid: number | null; advance: number | null; paymentFee: number; tip?: number; confirmStatus: string | null; refunded: number; refundStatus: string | null;
  payuMihpayid: string | null; awb?: string | null; courier?: string | null; shipStatus?: string | null; shipStatusRaw?: string | null; shipError?: string | null; courierRef?: string | null; staffNote?: string | null; customerNote?: string | null; timeline?: { at: string; by: string; text: string }[]; gateway?: string | null; gatewayRef?: string | null; shopifyOrderId: string | null; shopifyOrderName: string | null; error: string | null; createdAt: string;
  manualTags: string[]; tags: string[]; channel: string;
};

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

export type OrdersFilterState = { status: string; method: string; tag: string; product: string; state: string; q: string; min: string; max: string; paymentStatus: string; fulfillment: string; deliveryStatus: string; returnStatus: string; labelStatus: string; deliveryMethod: string; range: { preset: string; since: string; until: string } };
export type OrdersSummary = { count: number; value: number; prepaid: number; cod: number; aov: number; items: number; fulfilled: number; delivered: number; returned: number };

const rupee = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");

export function OrdersView({ orders, hasMore, page, showStore, filters: f, summary, products, tagOptions = [], deliveryOptions = [] }: {
  orders: OrderRow[]; hasMore: boolean; page: number; showStore: boolean;
  filters: OrdersFilterState; summary: OrdersSummary; products: string[]; tagOptions?: string[]; deliveryOptions?: string[]; exportHref?: string;
}) {
  const link = useLink();
  const navigate = useNavigate();
  const extra = [f.status, f.method, f.min || f.max, f.product, f.tag, f.state, f.paymentStatus, f.fulfillment, f.deliveryStatus, f.returnStatus, f.labelStatus, f.deliveryMethod].filter(Boolean).length;
  const clearAll = link({ min: "", max: "", product: "", tag: "", state: "", q: "", status: "", status_not: "", method: "", payment_status: "", payment_status_not: "", fulfillment: "", fulfillment_not: "", delivery_status: "", delivery_status_not: "", return_status: "", return_status_not: "", label_status: "", label_status_not: "", delivery_method: "", delivery_method_not: "", state_not: "", product_not: "", tag_not: "" });
  const views = [
    { label: "All", patch: { status: "", method: "" }, on: !f.status && !f.method },
    { label: "Prepaid", patch: { status: "", method: "prepaid" }, on: !f.status && f.method === "prepaid" },
    { label: "COD", patch: { status: "", method: "cod" }, on: !f.status && f.method === "cod" },
    { label: "Partial COD", patch: { status: "", method: "partial" }, on: !f.status && f.method === "partial" },
    { label: "Awaiting payment", patch: { status: "pending", method: "" }, on: f.status === "pending" },
    { label: "Failed", patch: { status: "failed", method: "" }, on: f.status === "failed" },
  ];
  const n = (v: number) => v.toLocaleString("en-IN");

  return (
    <div className="space-y-3">
      {/* metrics */}
      <section className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-3 lg:grid-cols-[auto_repeat(6,minmax(0,1fr))]">
        <div className="col-span-2 flex items-center border-b border-rule px-3 py-2.5 sm:col-span-3 lg:col-span-1 lg:border-b-0 lg:border-r"><RangePicker current={f.range} /></div>
        <Metric label="Orders" value={n(summary.count)} />
        <Metric label="Items ordered" value={n(summary.items)} />
        <Metric label="Sales" value={rupee(summary.value)} />
        <Metric label="Returns" value={n(summary.returned)} />
        <Metric label="Orders fulfilled" value={n(summary.fulfilled)} />
        <Metric label="Orders delivered" value={n(summary.delivered)} />
      </section>

      <section className="panel relative">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
          <select aria-label="Order view" value={views.find((v) => v.on)?.label ?? "All"} onChange={(e) => { const v = views.find((x) => x.label === e.target.value); if (v) navigate(link(v.patch)); }} className="h-8 rounded-lg border border-rule bg-surface px-2 text-[12.5px] font-medium text-ink">
            {views.map((v) => <option key={v.label}>{v.label}</option>)}
          </select>
          <OrdersSearchFilter filters={f} products={products} tags={tagOptions} deliveryOptions={deliveryOptions} clearAll={clearAll} activeCount={extra} />
          <span className="num ml-auto hidden text-[12px] text-ink-faint sm:inline">{n(summary.prepaid)} prepaid · {n(summary.cod)} COD{summary.count > 0 && ` · avg ${rupee(summary.aov)}`}</span>
        </div>

        {orders.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-paper-sunk"><Icon name="inbox" className="h-6 w-6 text-ink-soft" /></span>
            <p className="mt-3 text-[14px] font-semibold">{extra || f.q || f.status || f.method ? "No orders match these filters" : "Your orders will show here"}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{extra || f.q ? "Try removing a filter or changing the dates." : "This is where you'll see orders, payments and deliveries."}</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-rule sm:hidden">{orders.map((o) => <OrderCard key={o.id} o={o} showStore={showStore} />)}</ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="table min-w-[1420px]">
                <thead><tr><th>Order</th><th>Date</th><th>Customer</th>{showStore && <th>Store</th>}<th>Fulfill by</th><th>Channel</th><th className="text-right">Total</th><th>Payment status</th><th>Fulfillment status</th><th>Items</th><th>Delivery status</th><th>Delivery method</th><th>Tags</th></tr></thead>
                <tbody>{orders.map((o) => <OrderRowView key={o.id} o={o} showStore={showStore} />)}</tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {(page > 1 || hasMore) && (
        <div className="flex justify-center">
          <div className="inline-flex items-center rounded-lg bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
            {page > 1 ? <Link to={link({ page: String(page - 1) })} className="flex h-8 w-8 items-center justify-center text-ink-soft hover:text-ink" aria-label="Newer"><Icon name="chevron" className="h-4 w-4 rotate-90" /></Link> : <span className="flex h-8 w-8 items-center justify-center text-ink-faint/50"><Icon name="chevron" className="h-4 w-4 rotate-90" /></span>}
            <span className="num px-2 text-[12.5px] text-ink-soft">{(page - 1) * 50 + 1}–{(page - 1) * 50 + orders.length}</span>
            {hasMore ? <Link to={link({ page: String(page + 1) })} className="flex h-8 w-8 items-center justify-center text-ink-soft hover:text-ink" aria-label="Older"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></Link> : <span className="flex h-8 w-8 items-center justify-center text-ink-faint/50"><Icon name="chevron" className="h-4 w-4 -rotate-90" /></span>}
          </div>
        </div>
      )}
    </div>
  );
}

function OrdersSearchFilter({ filters, products, tags, deliveryOptions, clearAll, activeCount }: { filters: OrdersFilterState; products: string[]; tags: string[]; deliveryOptions: string[]; clearAll: string; activeCount: number }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [operator, setOperator] = useState<"is" | "is_not">("is");
  const [query, setQuery] = useState(filters.q);
  const [range, setRange] = useState({ min: filters.min, max: filters.max });
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { setQuery(filters.q); }, [filters.q]);
  useEffect(() => {
    if (query === filters.q) return;
    const timer = setTimeout(() => { const p = new URLSearchParams(params); query ? p.set("q", query) : p.delete("q"); p.delete("page"); navigate(`${location.pathname}?${p}`, { replace: true, preventScrollReset: true }); }, 350);
    return () => clearTimeout(timer);
  }, [query, filters.q, params, navigate, location.pathname]);
  const fields = [
    { key: "status", label: "Order status", options: [["open", "Open"], ["pending", "Awaiting payment"], ["failed", "Failed"], ["refunded", "Refunded"]] },
    { key: "payment_status", label: "Payment status", options: [["paid", "Paid"], ["pending", "Payment pending"], ["partially_refunded", "Partially refunded"], ["refunded", "Refunded"], ["failed", "Failed"]] },
    { key: "fulfillment", label: "Fulfillment status", options: [["fulfilled", "Fulfilled"], ["unfulfilled", "Unfulfilled"]] },
    { key: "delivery_status", label: "Delivery status", options: [["in_transit", "In transit"], ["delivered", "Delivered"], ["rto_transit", "RTO in transit"], ["rto", "Returned to origin"], ["returned", "Returned"], ["cancelled", "Cancelled"]] },
    { key: "return_status", label: "Return status", options: [["returned", "Returned"], ["not_returned", "Not returned"]] },
    { key: "label_status", label: "Shipping label status", options: [["added", "Label added"], ["not_added", "No label"]] },
    { key: "total", label: "Order total", options: [] as string[][] },
    { key: "delivery_method", label: "Delivery method", options: deliveryOptions.map((x) => [x, x]) },
    { key: "state", label: "Destination", options: INDIAN_STATES.map((s) => [s.code, s.name]) },
    { key: "product", label: "Product", options: products.map((x) => [x, x]) },
    { key: "tag", label: "Tag", options: [...new Set([...tags, ...TAGS.filter((x) => x.id).map((x) => x.id)])].map((x) => [x, x === "Smart Checkout" ? x : x === "WhatsApp" ? x : TAGS.find((t) => t.id === x)?.label ?? x]) },
  ];
  const chosen = fields.find((x) => x.key === field);
  const apply = (key: string, value: string) => {
    const p = new URLSearchParams(params); p.set(key, value); p.delete("page");
    query ? p.set("q", query) : p.delete("q");
    if (operator === "is_not") p.set(`${key}_not`, "1"); else p.delete(`${key}_not`);
    setOpen(false); setField(null);
    navigate(`${location.pathname}?${p}`, { preventScrollReset: true });
  };
  const clearOne = (key: string) => {
    const p = new URLSearchParams(params); p.delete(key); p.delete(`${key}_not`); p.delete("page");
    if (key === "min" || key === "max") { p.delete("min"); p.delete("max"); }
    navigate(`${location.pathname}?${p}`, { preventScrollReset: true });
  };
  const active = [
    ["status", "Order status"], ["payment_status", "Payment status"], ["fulfillment", "Fulfillment status"], ["delivery_status", "Delivery status"], ["return_status", "Return status"], ["label_status", "Label status"], ["delivery_method", "Delivery method"], ["state", "Destination"], ["product", "Product"], ["tag", "Tag"],
  ].filter(([k]) => params.has(k)) as [string, string][];
  const valueLabel = (key: string, value: string) => fields.find((x) => x.key === key)?.options.find(([v]) => v === value)?.[1] ?? value;
  return <div className="relative min-w-[200px] flex-1">
    <Form method="get" className="flex min-h-8 min-w-0 items-center gap-2 rounded-lg border border-rule bg-surface px-2.5 focus-within:border-[#626873] focus-within:ring-2 focus-within:ring-black/5" onSubmit={(e) => { e.preventDefault(); const p = new URLSearchParams(params); query ? p.set("q", query) : p.delete("q"); p.delete("page"); navigate(`${location.pathname}?${p}`, { preventScrollReset: true }); }}>
      {[...params.entries()].filter(([k]) => !["q", "page"].includes(k)).map(([k, v], i) => <input key={k + i} type="hidden" name={k} value={v} />)}
      <Icon name="search" className="h-4 w-4 shrink-0 text-ink-faint" />
      <input type="search" name="q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search and filter" onFocus={() => setOpen(true)} className="h-8 min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-faint" aria-label="Search and filter orders" />
      {!!active.length && <span className="hidden items-center gap-1 lg:flex">{active.map(([k, label]) => { const summary = `${label} ${params.get(`${k}_not`) === "1" ? "is not" : "is"} ${valueLabel(k, params.get(k) ?? "")}`; return <button type="button" key={k} onClick={() => clearOne(k)} className="inline-flex max-w-40 items-center gap-1 rounded-md bg-paper-sunk px-1.5 py-0.5 text-[11px] text-ink" title={summary}><span className="truncate">{summary}</span><Icon name="close" className="h-3 w-3 shrink-0" /></button>; })}</span>}
      {(activeCount > 0 || filters.q) && <Link to={clearAll} preventScrollReset className="whitespace-nowrap text-[11px] font-medium text-ink-soft hover:text-ink">Clear</Link>}
    </Form>
    {open && <>
      <button type="button" aria-label="Close filters" onClick={() => { setOpen(false); setField(null); }} className="fixed inset-0 z-40 cursor-default bg-black/10 sm:bg-transparent" />
      <div className="absolute left-0 top-full z-50 mt-1 max-h-[68dvh] w-full min-w-[min(420px,calc(100vw-32px))] max-w-[560px] overflow-y-auto overscroll-contain rounded-xl border border-rule bg-surface p-2 shadow-[0_14px_40px_-16px_rgba(0,0,0,.3)]">
        {!chosen ? <>
          <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Add a filter</p>
          <input autoFocus value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Find a filter" className="input mb-1 text-[12px]" />
          <div className="space-y-0.5">{fields.filter((x) => x.label.toLowerCase().includes(filterText.toLowerCase())).map((x) => <button type="button" key={x.key} onClick={() => { setField(x.key); setOperator("is"); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink hover:bg-paper"><span>{x.label}</span><Icon name="chevron" className="h-3.5 w-3.5 -rotate-90 text-ink-faint" /></button>)}</div>
          {params.get("min") || params.get("max") ? <button type="button" onClick={() => { clearOne("min"); clearOne("max"); }} className="mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-paper">Order total: {params.get("min") ? `₹${params.get("min")}` : "Any"} – {params.get("max") ? `₹${params.get("max")}` : "Any"}<Icon name="close" className="h-3.5 w-3.5" /></button> : null}
        </> : <>
          <div className="flex items-center gap-2 border-b border-rule px-1 pb-2"><button type="button" onClick={() => setField(null)} className="rounded-md p-1 hover:bg-paper" aria-label="Back"><Icon name="arrow" className="h-4 w-4 rotate-180" /></button><p className="flex-1 text-[13px] font-semibold">{chosen.label}</p></div>
          {chosen.key === "total" ? <div className="space-y-2 p-2"><p className="text-[12px] text-ink-soft">Order total is between</p><div className="flex gap-2"><input inputMode="numeric" value={range.min} onChange={(e) => setRange((v) => ({ ...v, min: e.target.value.replace(/\D/g, "") }))} placeholder="From ₹" className="input num text-[12px]"/><input inputMode="numeric" value={range.max} onChange={(e) => setRange((v) => ({ ...v, max: e.target.value.replace(/\D/g, "") }))} placeholder="To ₹" className="input num text-[12px]"/></div><button type="button" className="btn-primary w-full" onClick={() => { const p = new URLSearchParams(params); range.min ? p.set("min", range.min) : p.delete("min"); range.max ? p.set("max", range.max) : p.delete("max"); p.delete("page"); navigate(`${location.pathname}?${p}`, { preventScrollReset: true }); }}>Apply</button></div> : <>
            <div className="flex gap-2 px-2 py-2">{(["is", "is_not"] as const).map((op) => <button key={op} type="button" onClick={() => setOperator(op)} className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${operator === op ? "bg-[#e7e9ed] text-ink" : "text-ink-soft hover:bg-paper"}`}>{op === "is" ? "Is" : "Is not"}</button>)}</div>
            <div className="max-h-[48dvh] space-y-0.5 overflow-y-auto overscroll-contain">{chosen.options.map(([value, label]) => <button type="button" key={value} onClick={() => apply(chosen.key, value)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink hover:bg-paper"><span className="flex h-4 w-4 items-center justify-center rounded border border-rule-strong" />{label}</button>)}</div>
          </>}
        </>}
      </div>
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-rule px-4 py-2.5 last:border-b-0 sm:border-r lg:border-b-0 lg:last:border-r-0">
      <p className="text-[12px] font-semibold text-ink-soft">{label}</p>
      <p className="num mt-0.5 text-[14px] font-semibold">{value}</p>
    </div>
  );
}

/** A filter chip with its own small dropdown (Shopify-style). Shows the chosen value; × clears it. */
function FilterPill({ label, value, clear, children }: { label: string; value: string; clear: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.search]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <span className={`inline-flex h-7 items-center rounded-lg text-[12.5px] ${value ? "bg-paper-sunk shadow-[inset_0_0_0_1px_rgb(var(--rule-strong))]" : "shadow-[inset_0_0_0_1px_rgb(var(--rule-strong))] border-dashed"}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-full items-center gap-1 pl-2.5 pr-2 text-ink-soft hover:text-ink">
          {label}{value && <b className="max-w-[160px] truncate font-medium text-ink">: {value}</b>}
          {!value && <Icon name="chevron" className="h-3.5 w-3.5" />}
        </button>
        {value && <Link to={clear} preventScrollReset className="flex h-full items-center pr-1.5 text-ink-faint hover:text-ink" aria-label={`Clear ${label}`}><Icon name="close" className="h-3.5 w-3.5" /></Link>}
      </span>
      {open && <div className="absolute left-0 z-30 mt-1 animate-fadein rounded-xl bg-white shadow-[0_0_0_1px_rgba(0,0,0,.08),0_12px_32px_-12px_rgba(0,0,0,.3)]">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function OptionList({ options, current, to, searchable }: { options: { id: string; label: string }[]; current: string; to: (id: string) => string; searchable?: boolean }) {
  const [q, setQ] = useState("");
  const list = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80);
  return (
    <div className="w-64 p-1">
      {searchable && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="input mb-1" aria-label="Search options" />}
      <div className="max-h-64 overflow-y-auto">
        {list.map((o) => (
          <Link key={o.id} to={to(o.id)} preventScrollReset className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-paper ${current === o.id ? "font-semibold" : ""}`}>
            <span className="truncate">{o.label}</span>{current === o.id && <Icon name="check" className="h-3.5 w-3.5" />}
          </Link>
        ))}
        {list.length === 0 && <p className="px-2 py-3 text-[12.5px] text-ink-faint">Nothing found.</p>}
      </div>
    </div>
  );
}

const itemsLabel = (o: OrderRow) => { const n = o.items.reduce((a, l) => a + l.quantity, 0); return `${n} item${n === 1 ? "" : "s"}`; };
const shortWhen = (d: string) => {
  const t = new Date(d);
  const now = new Date();
  const ist = (x: Date) => x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const time = t.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  if (ist(t) === ist(now)) return `Today at ${time}`;
  if (ist(t) === ist(new Date(now.getTime() - 864e5))) return `Yesterday at ${time}`;
  if (now.getTime() - t.getTime() < 6 * 864e5) return `${t.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" })} at ${time}`;
  return `${t.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} at ${time}`;
};

const PILL: Record<string, string> = {
  gray: "bg-[#eef0f2] text-[#354052]", orange: "bg-[#f5eee4] text-[#72542e]", yellow: "bg-[#f6f1df] text-[#6b5a27]",
  green: "bg-[#edf0f3] text-[#354052]", red: "bg-[#f5e9e9] text-[#7c3b3b]", blue: "bg-[#e9eef5] text-[#354d6c]",
};
function Pill({ tone, children, title }: { tone: keyof typeof PILL; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-[12px] font-medium ${PILL[tone]}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full border-[1.5px] border-current" />{children}</span>;
}
function PaymentPill({ o }: { o: OrderRow }) {
  if (o.status === "failed") return <Pill tone="red">Failed</Pill>;
  if (o.status === "pending_payment" || o.status === "cod_placing") return <Pill tone="gray">Awaiting payment</Pill>;
  if (o.refundStatus === "full") return <Pill tone="gray">Refunded</Pill>;
  if (o.refundStatus === "partial") return <Pill tone="orange">Partially refunded</Pill>;
  if (o.paymentMethod === "cod") return <Pill tone="orange" title="Cash on delivery">Payment pending</Pill>;
  if (o.paymentMethod === "partial") return <Pill tone="orange" title="Advance paid, rest on delivery">Partially paid</Pill>;
  return <Pill tone="gray">Paid</Pill>;
}
function FulfillPill({ o }: { o: OrderRow }) {
  const ok = o.status === "paid" || o.status === "cod_placed";
  if (!ok) return <span className="text-ink-faint">—</span>;
  const s = o.shipStatus;
  const courier = o.courier ? courierById(o.courier)?.name ?? o.courier : null;
  const title = [courier, o.awb ? `AWB ${o.awb}` : null].filter(Boolean).join(" · ") || undefined;
  if (s === "delivered") return <Pill tone="green" title={title}>Delivered</Pill>;
  if (s === "rto" || s === "rto_transit") return <Pill tone="red" title={title}>{s === "rto" ? "Returned to origin" : "RTO in transit"}</Pill>;
  if (s === "returned") return <Pill tone="gray" title={title}>Returned</Pill>;
  if (s === "cancelled") return <Pill tone="gray" title={title}>Cancelled</Pill>;
  // The courier's own words for where it is now ("Out for delivery", "Pickup scheduled", "New in Shiprocket")
  const live = o.shipStatusRaw ? o.shipStatusRaw.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()).slice(0, 28) : null;
  if (o.awb || s) return <Pill tone="blue" title={title}>{live ?? (SHIP_STATUS_LABELS as Record<string, string>)[s ?? "in_transit"] ?? "Fulfilled"}</Pill>;
  if (o.courierRef) return <Pill tone="blue" title={title}>{live ?? `Sent to ${courier ?? "courier"}`}</Pill>;
  if (o.shipError) return <Pill tone="red" title={o.shipError}>Courier error</Pill>;
  return <Pill tone="yellow">Unfulfilled</Pill>;
}
function FulfillmentStatusPill({ o }: { o: OrderRow }) {
  if (!["paid", "cod_placed"].includes(o.status)) return <span className="text-ink-faint">—</span>;
  return o.awb ? <Pill tone="gray">Fulfilled</Pill> : <Pill tone="yellow">Unfulfilled</Pill>;
}
function Tags({ o, compact = false }: { o: OrderRow; compact?: boolean }) {
  if (!o.tags.length) return <span className="text-ink-faint">—</span>;
  return <span className="flex max-w-[260px] flex-wrap gap-1">{o.tags.slice(0, compact ? 2 : 4).map((t) => <span key={t} className="rounded-md border border-rule bg-paper px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft">{t}</span>)}{o.tags.length > (compact ? 2 : 4) && <span className="text-[10.5px] text-ink-faint">+{o.tags.length - (compact ? 2 : 4)}</span>}</span>;
}
function FulfilledBy({ o }: { o: OrderRow }) {
  if (!o.courier) return <span className="text-ink-faint">—</span>;
  return <span className="whitespace-nowrap text-[12px] text-ink">{courierById(o.courier)?.name ?? o.courier}</span>;
}
function ConfirmIcon({ s }: { s: string | null }) {
  if (!s) return null;
  const v = s === "confirmed" ? ["text-good", "Confirmed on WhatsApp"] : s === "cancelled" ? ["text-bad", "Cancelled on WhatsApp"] : ["text-ink-faint", "Waiting for WhatsApp reply"];
  return <span title={v[1]} className={v[0]}><Icon name="chat" className="h-3.5 w-3.5" /><span className="sr-only">{v[1]}</span></span>;
}

function OrderCard({ o, showStore }: { o: OrderRow; showStore: boolean }) {
  const [open, setOpen] = useState(false);
  const paid = orderValuePaise(o);
  return (
    <li>
      <button type="button" className="flex w-full items-start gap-3 px-3.5 py-3 text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5"><span className="num text-[13px] font-semibold">{o.shopifyOrderName ?? o.id}</span><ConfirmIcon s={o.confirmStatus} /></p>
          <p className="mt-0.5 truncate text-[13px]">{o.customer.firstName} {o.customer.lastName}<span className="text-ink-faint"> · {o.customer.city}</span></p>
          <p className="truncate text-[12px] text-ink-faint">{showStore && `${o.storeName} · `}{shortWhen(o.createdAt)}</p>
          <div className="mt-1.5 flex flex-wrap gap-1"><PaymentPill o={o} /><FulfillPill o={o} /></div>
          <p className="mt-1 text-[11px] text-ink-faint">{o.channel} · {o.courier ? courierById(o.courier)?.name ?? o.courier : "Fulfillment not assigned"}</p>
          <div className="mt-1"><Tags o={o} compact /></div>
        </div>
        <div className="text-right"><p className="num text-[13px] font-semibold">{inr(paid - o.refunded)}</p><p className="text-[12px] text-ink-faint">{itemsLabel(o)}</p></div>
      </button>
      {open && <div className="border-t border-rule bg-paper px-3.5 py-3"><OrderDetails o={o} /></div>}
    </li>
  );
}

function OrderRowView({ o, showStore }: { o: OrderRow; showStore: boolean }) {
  const [open, setOpen] = useState(false);
  const paid = orderValuePaise(o);
  const gone = o.refundStatus === "full" || o.status === "failed";
  const strike = gone ? "text-ink-faint line-through" : "";
  return (
    <>
      <tr className={`cursor-pointer ${open ? "[&>td]:bg-paper" : ""}`} onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <td className="whitespace-nowrap"><span className={`num font-semibold ${strike}`}>{o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`}</span> <ConfirmIcon s={o.confirmStatus} /></td>
        <td className={`whitespace-nowrap ${strike}`}>{shortWhen(o.createdAt)}</td>
        <td className={`max-w-[200px] truncate ${strike}`} title={`${o.customer.phone}, ${o.customer.city}`}>{o.customer.firstName} {o.customer.lastName}</td>
        {showStore && <td className={`max-w-[160px] truncate ${strike}`}>{o.storeName}</td>}
        <td><FulfilledBy o={o} /></td>
        <td><span className="rounded-md border border-rule bg-paper px-1.5 py-0.5 text-[11px] text-ink-soft">{o.channel}</span></td>
        <td className={`num whitespace-nowrap text-right ${strike}`}>{inr(paid - o.refunded)}</td>
        <td><PaymentPill o={o} /></td>
        <td><FulfillmentStatusPill o={o} /></td>
        <td className={`whitespace-nowrap ${strike}`}>{itemsLabel(o)}</td>
        <td><FulfillPill o={o} /></td>
        <td className={`max-w-[160px] truncate ${strike}`}>{o.shipping ? o.shippingTitle ?? "Standard" : "Free delivery"}</td>
        <td><Tags o={o} compact /></td>
      </tr>
      {open && (
        <tr className="[&>td]:bg-paper"><td colSpan={showStore ? 13 : 12}><div className="py-2"><OrderDetails o={o} /></div></td></tr>
      )}
    </>
  );
}

function OrderDetails({ o }: { o: OrderRow }) {
  return (
    <div className="space-y-4">
      <OrderDetailsGrid o={o} />
      <div className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
        <NotesBlock o={o} />
        <Timeline o={o} />
      </div>
    </div>
  );
}

function OrderDetailsGrid({ o }: { o: OrderRow }) {
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
        {(o.tip ?? 0) > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Tip</dt><dd>{inr(o.tip ?? 0)}</dd></div>}
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
        <AddressBlock o={o} />
        <div><p className="mb-1 text-xs font-medium text-ink-soft">Tags</p><div className="flex flex-wrap gap-1"><Tags o={o} /></div></div>
        <Form method="post" className="flex gap-1.5"><input type="hidden" name="intent" value="tagAdd"/><input type="hidden" name="orderId" value={o.id}/><input type="hidden" name="storeId" value={o.storeId}/><input name="tag" maxLength={32} placeholder="Add a manual tag" className="input min-w-0 py-1.5 text-[12px]"/><button className="btn-secondary px-2.5 py-1.5 text-xs">Add</button></Form>
        {o.manualTags.map((tag) => <Form key={tag} method="post" className="inline-flex"><input type="hidden" name="intent" value="tagRemove"/><input type="hidden" name="orderId" value={o.id}/><input type="hidden" name="storeId" value={o.storeId}/><input type="hidden" name="tag" value={tag}/><button className="rounded-md border border-rule px-2 py-1 text-[11px] text-ink-soft hover:bg-paper">Remove “{tag}”</button></Form>)}
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

export function AbandonedView({ data, showStore }: { data: { items: AbandonedItem[]; count: number; value: number; withPhone: boolean; hasMore: boolean; page: number; range: { preset: string; since: string; until: string } }; showStore: boolean }) {
  const link = useLink();
  return (
    <div className="space-y-3">
      <section className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-[auto_repeat(2,minmax(0,1fr))]">
        <div className="col-span-2 flex items-center border-b border-rule px-3 py-2.5 sm:col-span-1 sm:border-b-0 sm:border-r"><RangePicker current={data.range} /></div>
        <Metric label="Abandoned checkouts" value={data.count.toLocaleString("en-IN")} />
        <Metric label="Value left in carts" value={rupee(data.value)} />
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-0.5 border-b border-rule px-2 py-1.5" role="tablist">
          {[{ l: "With phone number", on: data.withPhone, to: link({ all: "", page: "" }) }, { l: "All", on: !data.withPhone, to: link({ all: "1", page: "" }) }].map((t) => (
            <Link key={t.l} to={t.to} preventScrollReset role="tab" aria-selected={t.on} className={`h-7 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium leading-7 ${t.on ? "bg-paper-sunk text-ink" : "text-ink-soft hover:bg-paper hover:text-ink"}`}>{t.l}</Link>
          ))}
        </div>
        {data.items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-paper-sunk"><Icon name="cart" className="h-6 w-6 text-ink-soft" /></span>
            <p className="mt-3 text-[14px] font-semibold">No abandoned checkouts</p>
            <p className="mt-1 text-[13px] text-ink-soft">Checkouts left for more than 30 minutes without an order show up here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[960px]">
              <thead><tr><th>Checkout</th><th>Created</th><th>Customer</th>{showStore && <th>Store</th>}<th>Region</th><th>Left at</th><th>Recovery status</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {data.items.map((a) => {
                  const msg = `Hi${a.name ? " " + a.name.split(" ")[0] : ""}, you left items in your cart${a.storeName ? ` at ${a.storeName}` : ""}. Complete your order here: ${a.link ?? ""}`;
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">
                        <p className="num font-semibold">#{a.id.slice(-8).toUpperCase()}</p>
                        <p className="max-w-[180px] truncate text-[12px] text-ink-faint" title={a.cart.map((l) => `${l.title} ×${l.quantity}`).join(", ")}>{a.cart.length} item{a.cart.length === 1 ? "" : "s"} · {a.cart[0]?.title}</p>
                      </td>
                      <td className="whitespace-nowrap">{shortWhen(a.lastActive)}</td>
                      <td><p className="max-w-[180px] truncate">{a.name || <span className="text-ink-faint">No name</span>}</p><p className="num text-[12px] text-ink-faint">{a.phone || "No phone"}</p></td>
                      {showStore && <td className="max-w-[140px] truncate">{a.storeName}</td>}
                      <td>{a.city || "India"}</td>
                      <td className="text-ink-soft">{a.stage}</td>
                      <td><Pill tone="orange">Not recovered</Pill></td>
                      <td className="num whitespace-nowrap text-right">{rupee(a.value)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {a.phone && a.link && <a className="btn-secondary h-7 px-2 text-[12px]" href={`https://wa.me/91${a.phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                          {a.phone && <a className="btn-secondary h-7 px-2 text-[12px]" href={`tel:+91${a.phone}`}>Call</a>}
                          {a.link ? <CopyLink url={a.link} /> : <span className="text-[12px] text-ink-faint">Link expired</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[12px] text-ink-faint">Recovery links open the customer's saved cart and stay valid for 7 days from when they started checkout.</p>
      {(data.page > 1 || data.hasMore) && (
        <div className="flex justify-center gap-2">
          {data.page > 1 && <Link to={link({ page: String(data.page - 1) })} className="btn-secondary">Newer</Link>}
          {data.hasMore && <Link to={link({ page: String(data.page + 1) })} className="btn-secondary">Older</Link>}
        </div>
      )}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-secondary h-7 px-2 text-[12px]" onClick={() => { navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

function AddressBlock({ o }: { o: OrderRow }) {
  const [edit, setEdit] = useState(false);
  const c = o.customer;
  const nav = useNavigation();
  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "address" && nav.formData?.get("orderId") === o.id;
  useEffect(() => { if (nav.state === "idle") setEdit(false); }, [nav.state]);
  if (!edit) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-soft">Delivery address</p>
          <button type="button" onClick={() => setEdit(true)} className="text-[12px] font-medium text-ink underline-offset-2 hover:underline">Edit</button>
        </div>
        <p className="mt-1 text-ink-soft">{c.firstName} {c.lastName}, <a className="num underline" href={`tel:+91${c.phone}`}>{c.phone}</a>{c.email ? <>, {c.email}</> : null}</p>
        <p className="text-ink-soft">{c.address1}{c.address2 ? `, ${c.address2}` : ""}, {c.city}, {c.state} {c.pincode}</p>
      </div>
    );
  }
  return (
    <Form method="post" className="space-y-2 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,.08)]">
      <input type="hidden" name="intent" value="address" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
      <p className="text-[12.5px] font-semibold">Edit delivery address</p>
      <div className="grid grid-cols-2 gap-2">
        <AddrField name="firstName" label="First name" value={c.firstName} required />
        <AddrField name="lastName" label="Last name" value={c.lastName} />
        <AddrField name="phone" label="Mobile" value={c.phone} inputMode="numeric" required />
        <AddrField name="email" label="Email" value={c.email ?? ""} type="email" />
        <AddrField name="address1" label="Address" value={c.address1} wide required />
        <AddrField name="address2" label="Apartment, landmark" value={c.address2 ?? ""} wide />
        <AddrField name="city" label="City" value={c.city} required />
        <label className="block text-[11.5px] font-medium text-ink-soft">State
          <select name="state" defaultValue={c.state} className="input mt-1 py-1.5 text-[13px]">{INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
        </label>
        <AddrField name="pincode" label="Pincode" value={c.pincode} inputMode="numeric" maxLength={6} required />
      </div>
      {(o.awb || o.courierRef) && <p className="text-[11.5px] text-ink-soft">This order is already with {o.courier ? courierById(o.courier)?.name ?? o.courier : "the courier"}. We'll send the new address to them too (allowed until pickup).</p>}
      <div className="flex gap-2 pt-1">
        <button className="btn-primary px-3 py-1.5 text-xs" disabled={saving}>{saving ? "Saving…" : "Save address"}</button>
        <button type="button" onClick={() => setEdit(false)} className="btn-secondary px-3 py-1.5 text-xs">Cancel</button>
      </div>
    </Form>
  );
}

function NotesBlock({ o }: { o: OrderRow }) {
  const nav = useNavigation();
  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "notes" && nav.formData?.get("orderId") === o.id;
  return (
    <Form method="post" className="space-y-3">
      <input type="hidden" name="intent" value="notes" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-soft"><Icon name="lock" className="h-3.5 w-3.5" />Staff note <span className="font-normal text-ink-faint">· only you and your team see this</span></span>
        <textarea name="staffNote" defaultValue={o.staffNote ?? ""} rows={2} maxLength={2000} placeholder="e.g. Customer asked for evening delivery" className="input mt-1 py-1.5 text-[13px]" />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-soft"><Icon name="user" className="h-3.5 w-3.5" />Note for the customer <span className="font-normal text-ink-faint">· shown on their order page</span></span>
        <textarea name="customerNote" defaultValue={o.customerNote ?? ""} rows={2} maxLength={2000} placeholder="e.g. Your order ships tomorrow with a free gift" className="input mt-1 py-1.5 text-[13px]" />
      </label>
      <button className="btn-secondary px-3 py-1.5 text-xs" disabled={saving}>{saving ? "Saving…" : "Save notes"}</button>
    </Form>
  );
}

function Timeline({ o }: { o: OrderRow }) {
  const list = [...(o.timeline ?? [])].reverse();
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-soft">History</p>
      {list.length === 0 ? <p className="text-[12.5px] text-ink-faint">No changes since the order was placed.</p> : (
        <ol className="space-y-2.5 border-l border-rule pl-3">
          {list.slice(0, 12).map((e, i) => (
            <li key={i} className="relative text-[12.5px]">
              <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-ink-faint" />
              <p className="text-ink">{e.text}</p>
              <p className="text-[11px] text-ink-faint">{e.by} · {new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AddrField({ name, label, value, wide, ...rest }: { name: string; label: string; value: string; wide?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`block text-[11.5px] font-medium text-ink-soft ${wide ? "col-span-2" : ""}`}>{label}<input name={name} defaultValue={value} className="input mt-1 py-1.5 text-[13px]" {...rest} /></label>;
}

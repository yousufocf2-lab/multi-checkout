// The order page: Shopify-style two columns (order on the left, customer and details on the right), one column on phones.
import type { SerializeFrom } from "@remix-run/node";
import { Form, Link, useFetcher, useNavigate, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { loader } from "~/routes/dashboard.orders.$orderId";
import type { OrderCustomer, OrderLine } from "~/db/schema";
import { courierById } from "~/lib/courier-catalog";
import { gatewayName } from "~/lib/gateways/catalog";
import { flagOf, hasPoint, parseUa, placeOf } from "~/lib/geo";
import { orderValuePaise, toCollectPaise } from "~/lib/payment-methods";
import { formatINR as inr } from "~/lib/pricing";
import { SOURCE_META } from "~/lib/order-source";
import { stateName } from "~/lib/states";
import { ItemsEditor } from "./ItemsEditor";
import { Icon } from "./Icons";
import {
  AddressBlock, CancelButton, CancelDialog, canShip, FulfillPill, NotesBlock, OrderActions, OutsourceBadge, PaymentPill, ShipButton, Tags,
  isOutsource, type OrderActionsCtx, type OrderRow,
} from "./OrdersViews";
import { OUTSOURCE_TAG } from "~/lib/order-route";

type Data = SerializeFrom<typeof loader>;
type Result = { ok: string | null; error: string | null } | null;

const IST = { timeZone: "Asia/Kolkata" } as const;
const longDate = (d: string) => new Date(d).toLocaleString("en-IN", { ...IST, day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
const timeOnly = (d: string) => new Date(d).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" });
const dayLabel = (d: string) => {
  const day = (x: Date) => x.toLocaleDateString("en-IN", IST);
  const t = new Date(d), now = new Date();
  if (day(t) === day(now)) return "Today";
  if (day(t) === day(new Date(now.getTime() - 864e5))) return "Yesterday";
  return t.toLocaleDateString("en-IN", { ...IST, weekday: "long", day: "numeric", month: "long", year: t.getFullYear() === now.getFullYear() ? undefined : "numeric" });
};
const orderName = (o: { shopifyOrderName: string | null; id: string }) => o.shopifyOrderName ?? `#${o.id.slice(-6).toUpperCase()}`;

export function OrderPage({ data: d, result, search }: { data: Data; result: Result; search: string }) {
  const o = d.order as unknown as OrderRow & Data["order"];
  const navigate = useNavigate();
  const act = useFetcher<{ ok: string | null; error: string | null }>();
  const [msg, setMsg] = useState<Result>(null);
  const [cancelIds, setCancelIds] = useState<string[] | null>(null);
  useEffect(() => { if (result) setMsg(result); }, [result]);
  useEffect(() => { if (act.state === "idle" && act.data) setMsg(act.data); }, [act.state, act.data]);
  const ctx: OrderActionsCtx = {
    couriers: d.couriers, busy: act.state !== "idle", sel: new Set(), toggle: () => {},
    ship: (ids, courier) => { setMsg(null); act.submit({ intent: "ship", orderIds: ids.join(","), courier: courier ?? "" }, { method: "post" }); },
    cancel: (ids) => setCancelIds(ids),
  };
  const back = `/dashboard/orders${search}`;
  const to = (id: string) => `/dashboard/orders/${encodeURIComponent(id)}${search}`;

  // Keyboard: ← / → (or j / k) for the previous / next order, Esc back to the list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if ((e.key === "ArrowLeft" || e.key === "k") && d.nav.newer) navigate(to(d.nav.newer));
      else if ((e.key === "ArrowRight" || e.key === "j") && d.nav.older) navigate(to(d.nav.older));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <OrderActions.Provider value={ctx}>
      <div className="mx-auto max-w-[1180px] space-y-4 pb-10">
        {/* ---------- header ---------- */}
        <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <Link to={back} className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-black/[.05] hover:text-ink" aria-label="Back to orders"><Icon name="arrow" className="h-4 w-4 rotate-180" /></Link>
          <div className="min-w-0 flex-1 basis-[220px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="num text-[20px] font-semibold leading-tight tracking-tight">{orderName(o)}</h1>
              <PaymentPill o={o} /><FulfillPill o={o} /><OutsourceBadge o={o} />
            </div>
            <p className="mt-1 text-[12.5px] text-ink-soft">
              {longDate(o.createdAt)} from {o.channel === "Shopify History" ? "Shopify" : "Online Store"} · {o.storeName}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <CopyButton text={d.customerLink} label="Copy order link" />
            <MoreActions o={o} />
            <div className="ml-1 inline-flex overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_rgb(var(--rule-strong))]">
              <NavArrow to={d.nav.newer ? to(d.nav.newer) : null} label="Newer order (←)" dir="up" />
              <span className="w-px bg-rule" />
              <NavArrow to={d.nav.older ? to(d.nav.older) : null} label="Older order (→)" dir="down" />
            </div>
          </div>
        </header>

        {msg && (msg.ok || msg.error) && (
          <div className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px] ${msg.error ? "bg-[#fee9e8] text-[#8e1f0b]" : "bg-[#e3f1ea] text-[#0c5132]"}`}>
            <Icon name={msg.error ? "alert" : "check"} className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{msg.error ?? msg.ok}</span>
            <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss"><Icon name="close" className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {o.status === "cancelled" && (
          <div className="flex items-start gap-2 rounded-xl bg-[#f1f2f4] px-3.5 py-2.5 text-[13px] text-ink-soft">
            <Icon name="close" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Cancelled{o.cancelledAt ? ` on ${longDate(o.cancelledAt)}` : ""}{o.cancelledBy ? ` by ${o.cancelledBy}` : ""}{o.cancelReason ? `. Reason: ${o.cancelReason}` : ""}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ---------- main ---------- */}
          <div className="min-w-0 space-y-4">
            <ItemsCard o={o} trackUrl={d.trackUrl} canEdit={d.canEdit} />
            <PaymentCard o={o} />
            <div className="lg:hidden space-y-4"><SideCards d={d} o={o} /></div>
            <TimelineCard d={d} o={o} />
          </div>
          {/* ---------- side ---------- */}
          <aside className="hidden min-w-0 space-y-4 lg:block"><SideCards d={d} o={o} /></aside>
        </div>
      </div>
      {cancelIds && <CancelDialog ids={cancelIds} orders={[o]} reasons={d.cancelReasons} busy={ctx.busy}
        onClose={() => setCancelIds(null)} onConfirm={(reason, refund) => { setMsg(null); act.submit({ intent: "cancel", orderIds: cancelIds.join(","), reason, refund: refund ? "1" : "0" }, { method: "post" }); setCancelIds(null); }} />}
    </OrderActions.Provider>
  );
}

function SideCards({ d, o }: { d: Data; o: OrderRow & Data["order"] }) {
  return (
    <>
      <NotesCard o={o} />
      <CustomerCard d={d} o={o} />
      <SourceCard d={d} />
      <VisitCard d={d} />
      <TagsCard o={o} />
      {(d.assigned.confirm || d.assigned.ofd || o.callStatus || o.ofdCallStatus) && <TeamCard d={d} o={o} />}
    </>
  );
}

// ---------------- small pieces ----------------

function Card({ title, icon, right, children, className = "" }: { title?: React.ReactNode; icon?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel overflow-hidden p-0 ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
          <h2 className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">{icon && <Icon name={icon} className="h-4 w-4 shrink-0 text-ink-soft" />}{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function NavArrow({ to, label, dir }: { to: string | null; label: string; dir: "up" | "down" }) {
  const cls = "flex h-8 w-8 items-center justify-center bg-surface";
  const icon = <Icon name="chevron" className={`h-4 w-4 ${dir === "up" ? "rotate-180" : ""}`} />;
  return to ? <Link to={to} className={`${cls} text-ink-soft hover:bg-paper hover:text-ink`} aria-label={label} title={label} preventScrollReset>{icon}</Link>
    : <span className={`${cls} text-ink-faint/50`} aria-hidden>{icon}</span>;
}

function CopyButton({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); };
  if (small) return <button type="button" onClick={copy} title={label} aria-label={label} className="rounded p-0.5 text-ink-faint hover:bg-black/[.05] hover:text-ink"><Icon name={done ? "check" : "copy"} className="h-3.5 w-3.5" /></button>;
  return <button type="button" onClick={copy} className="btn-secondary btn hidden h-8 px-2.5 text-[12.5px] sm:inline-flex"><Icon name={done ? "check" : "copy"} className="h-3.5 w-3.5" />{done ? "Copied" : label}</button>;
}

function MoreActions({ o }: { o: OrderRow }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigation();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => { if (nav.state === "submitting") setOpen(false); }, [nav.state]);
  const ok = o.status === "paid" || o.status === "cod_placed";
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-paper";
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="btn-secondary btn h-8 px-2.5 text-[12.5px]">More actions<Icon name="chevron" className="h-3.5 w-3.5" /></button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-56 animate-fadein rounded-xl bg-white p-1 shadow-[0_0_0_1px_rgba(0,0,0,.08),0_12px_32px_-12px_rgba(0,0,0,.3)]">
          {ok && !o.shopifyOrderId && o.channel !== "Shopify History" && (
            <Form method="post"><input type="hidden" name="intent" value="retry" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
              <button className={item}><Icon name="send" className="h-4 w-4 text-ink-soft" />Send to Shopify store</button></Form>
          )}
          {o.paymentMethod !== "cod" && (
            <Form method="post"><input type="hidden" name="intent" value="verify" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
              <button className={item}><Icon name="refresh" className="h-4 w-4 text-ink-soft" />Check payment with gateway</button></Form>
          )}
          <a className={item} href={`tel:+91${o.customer.phone}`}><Icon name="phone" className="h-4 w-4 text-ink-soft" />Call customer</a>
          <a className={item} href={`https://wa.me/91${o.customer.phone}`} target="_blank" rel="noreferrer"><Icon name="chat" className="h-4 w-4 text-ink-soft" />WhatsApp customer</a>
          <Link className={item} to={`/dashboard/orders?q=${encodeURIComponent(o.customer.phone)}&range=max`}><Icon name="search" className="h-4 w-4 text-ink-soft" />All orders from this customer</Link>
        </div>
      )}
    </div>
  );
}

// ---------------- items + shipment ----------------

function ItemsCard({ o, trackUrl, canEdit }: { o: OrderRow & Data["order"]; trackUrl: string | null; canEdit: boolean }) {
  const ok = o.status === "paid" || o.status === "cod_placed";
  const courier = o.courier ? courierById(o.courier)?.name ?? o.courier : null;
  const shipped = Boolean(o.awb || o.courierRef);
  const count = o.items.reduce((a, l) => a + l.quantity, 0);
  const head = o.status === "cancelled" ? { label: "Cancelled", tone: "bg-[#eef0f2] text-[#354052]", icon: "close" }
    : o.shipStatus === "delivered" ? { label: "Delivered", tone: "bg-[#e3f1ea] text-[#0c5132]", icon: "check" }
    : shipped ? { label: "Fulfilled", tone: "bg-[#e9eef5] text-[#354d6c]", icon: "shipping" }
    : ok ? { label: "Unfulfilled", tone: "bg-[#fcf0c8] text-[#5e4200]", icon: "box" }
    : { label: "Not placed", tone: "bg-[#eef0f2] text-[#354052]", icon: "clock" };
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold ${head.tone}`}><Icon name={head.icon} className="h-3.5 w-3.5" />{head.label} <span className="font-normal opacity-70">({count})</span></span>
        <div className="flex items-center gap-1.5">
          {ok && canShip(o) && <ShipButton o={o} big />}
        </div>
      </div>
      <div className="mx-4 mb-4 mt-3 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgb(var(--rule))]">
        <div className="flex items-center gap-2 border-b border-rule bg-paper/60 px-3.5 py-2 text-[12px] text-ink-soft">
          <Icon name="shipping" className="h-3.5 w-3.5" />{o.shipping ? o.shippingTitle ?? "Standard" : "Free delivery"}
          {o.fulfilment && <span className="rounded bg-black/[.05] px-1.5 text-[11px] capitalize">{o.fulfilment.replace("_", " ")}{o.tableNo ? ` · Table ${o.tableNo}` : ""}</span>}
        </div>
        <ul className="divide-y divide-rule">
          {o.items.map((l, i) => <ItemRow key={i} l={l as OrderLine} />)}
        </ul>
        {(shipped || o.shipError) && (
          <div className="border-t border-rule px-3.5 py-3 text-[12.5px]">
            {shipped ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="flex items-center gap-1.5"><span className="text-ink-faint">Courier</span><b className="font-medium">{courier ?? "—"}</b></span>
                {o.awb && <span className="flex items-center gap-1"><span className="text-ink-faint">AWB</span><b className="num font-medium">{o.awb}</b><CopyButton text={o.awb} label="Copy AWB" small /></span>}
                {o.shipStatusRaw && <span className="text-ink-soft">{o.shipStatusRaw}</span>}
                {o.ofdAttempts > 0 && <span className="text-ink-soft">{o.ofdAttempts} delivery attempt{o.ofdAttempts === 1 ? "" : "s"}</span>}
                {o.ndrReason && <span className="text-bad">NDR: {o.ndrReason}</span>}
                {trackUrl && <a href={trackUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-[#005bd3] hover:underline">Track shipment<Icon name="external" className="h-3 w-3" /></a>}
              </div>
            ) : <p className="flex items-start gap-1.5 text-bad"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />Courier booking failed: {o.shipError}</p>}
          </div>
        )}
      </div>
      {o.status !== "cancelled" && canEdit && (
        <div className="border-t border-rule px-4 py-3">
          <ItemsEditor lines={o.items} total={o.total} subtotal={o.subtotal} shipping={o.shipping} hidden={{ orderId: o.id, storeId: String(o.storeId) }}
            blocked={o.paymentMethod !== "cod" || o.status !== "cod_placed" ? "Only cash on delivery orders can be changed (a paid order's amount is fixed)." : o.awb ? `Already booked with the courier (AWB ${o.awb}), so the amount to collect can't change now.` : null} compact />
        </div>
      )}
    </Card>
  );
}

function ItemRow({ l }: { l: OrderLine }) {
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-paper shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)]">
        {l.image ? <img src={l.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Icon name="box" className="m-3.5 h-5 w-5 text-ink-faint" />}
        {l.quantity > 1 && <span className="num absolute -right-0.5 -top-0.5 rounded-full bg-ink px-1.5 text-[10px] font-semibold leading-[16px] text-white">{l.quantity}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug">{l.title}</p>
        {l.variantTitle && <p className="mt-0.5 inline-block rounded-md bg-paper px-1.5 py-px text-[11.5px] text-ink-soft">{l.variantTitle}</p>}
      </div>
      <div className="num shrink-0 text-right text-[13px]">
        <p className="text-ink-soft">{l.free ? <b className="text-good">FREE</b> : <>{inr(l.pricePaise)} × {l.quantity}</>}</p>
        {!l.free && <p className="font-medium">{inr(l.pricePaise * l.quantity)}</p>}
      </div>
    </li>
  );
}

// ---------------- payment ----------------

function PaymentCard({ o }: { o: OrderRow & Data["order"] }) {
  const paid = orderValuePaise(o);
  const count = o.items.reduce((a, l) => a + l.quantity, 0);
  const label = o.status === "failed" ? "Payment failed" : o.status === "pending_payment" || o.status === "cod_placing" ? "Awaiting payment"
    : o.refundStatus === "full" ? "Refunded" : o.refundStatus === "partial" ? "Partially refunded"
    : o.paymentMethod === "cod" ? "Payment pending (COD)" : o.paymentMethod === "partial" ? "Partially paid" : "Paid";
  const tone = /failed/i.test(label) ? "bg-[#fee9e8] text-[#8e1f0b]" : /pending|Awaiting|Partially/i.test(label) ? "bg-[#fff1e3] text-[#7a4b00]" : "bg-[#eef0f2] text-[#354052]";
  const Row = ({ k, sub, v, strong, neg }: { k: string; sub?: string; v: number | string; strong?: boolean; neg?: boolean }) => (
    <div className={`grid grid-cols-[110px_minmax(0,1fr)_auto] gap-2 py-1 sm:grid-cols-[150px_minmax(0,1fr)_auto] ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-ink-soft"}>{k}</dt><dd className="truncate text-ink-faint">{sub}</dd>
      <dd className="num text-right">{typeof v === "number" ? `${neg ? "−" : ""}${inr(v)}` : v}</dd>
    </div>
  );
  const methodName = o.paymentMethod === "cod" ? "Cash on delivery" : o.paymentMethod === "partial" ? "Partial COD" : "Online";
  return (
    <Card>
      <div className="px-4 pt-3.5"><span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-semibold ${tone}`}><Icon name="rupee" className="h-3.5 w-3.5" />{label}</span></div>
      <dl className="mx-4 mb-4 mt-3 rounded-xl px-3.5 py-2.5 text-[13px] shadow-[inset_0_0_0_1px_rgb(var(--rule))]">
        <Row k="Subtotal" sub={`${count} item${count === 1 ? "" : "s"}`} v={o.subtotal} />
        {o.paymentDiscount > 0 && <Row k="Discount" sub={`${methodName} discount`} v={o.paymentDiscount} neg />}
        {o.couponCode && <Row k="Coupon" sub={o.couponCode} v={o.couponDiscount} neg />}
        {o.offerDiscount > 0 && <Row k="Offer" sub="Mix & Match" v={o.offerDiscount} neg />}
        <Row k="Shipping" sub={o.shippingTitle ?? (o.shipping ? "Standard" : "Free delivery")} v={o.shipping ? o.shipping : "Free"} />
        {o.paymentFee > 0 && <Row k="Fee" sub={`${methodName} fee`} v={o.paymentFee} />}
        {(o.tip ?? 0) > 0 && <Row k="Tip" v={o.tip ?? 0} />}
        <div className="my-1.5 border-t border-rule" />
        <Row k="Total" v={o.total} strong />
        {o.bankDiscount > 0 && <Row k="Bank offer" sub="Taken off at payment" v={o.bankDiscount} neg />}
        <div className="my-1.5 border-t border-rule" />
        {o.paymentMethod === "partial" ? (
          <>
            <Row k="Paid online" sub={o.gateway ? gatewayName(o.gateway) : undefined} v={o.amountPaid ?? o.advance ?? 0} />
            <Row k="To collect" sub="On delivery" v={toCollectPaise(o)} strong />
          </>
        ) : o.paymentMethod === "cod" ? (
          <Row k="To collect" sub="Cash on delivery" v={paid} strong />
        ) : (
          <Row k={o.status === "paid" ? "Paid" : "Amount"} sub={o.gateway ? `${gatewayName(o.gateway)}${o.gatewayRef || o.payuMihpayid ? ` · ${o.gatewayRef ?? o.payuMihpayid}` : ""}` : undefined} v={paid} strong={o.status === "paid"} />
        )}
        {o.refunded > 0 && <Row k="Refunded" v={o.refunded} neg />}
        {o.refunded > 0 && <Row k="Net" v={paid - o.refunded} strong />}
      </dl>
      {o.error && <p className="mx-4 -mt-2 mb-3 break-words text-[12px] text-bad">{o.error}</p>}
      {o.status !== "cancelled" && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-4 py-3"><CancelButton o={o} /></div>}
    </Card>
  );
}

// ---------------- timeline ----------------

type Ev = { at: string; text: string; sub?: string; by?: string; kind: "comment" | "event" | "good" | "bad" | "ship" };

function buildTimeline(d: Data, o: OrderRow & Data["order"]): Ev[] {
  const ev: Ev[] = [];
  const add = (at: string | null | undefined, text: string, kind: Ev["kind"] = "event", sub?: string, by?: string) => { if (at) ev.push({ at, text, kind, sub, by }); };
  const who = `${o.customer.firstName} ${o.customer.lastName}`.trim() || "The customer";
  const placed = d.source.channel !== "unknown" && d.source.channel !== "direct"
    ? `${who} placed this order on the website (came from ${d.source.label}${d.source.campaign ? ` · ${d.source.campaign}` : ""}).`
    : `${who} placed this order on the website.`;
  add(o.createdAt, placed);
  const amount = inr(orderValuePaise(o));
  if (o.status === "paid") add(o.createdAt, `${o.paymentMethod === "partial" ? "An advance" : `A ${amount}`} payment was processed${o.gateway ? ` by ${gatewayName(o.gateway)}` : ""}.`, "good", o.gatewayRef ?? o.payuMihpayid ?? undefined);
  if (o.status === "cod_placed" && o.paymentMethod === "cod") add(o.createdAt, `Cash on delivery order for ${amount}.`);
  if (o.status === "cod_placed" && o.paymentMethod === "partial") add(o.createdAt, `Advance of ${inr(o.amountPaid ?? o.advance ?? 0)} paid online, ${inr(toCollectPaise(o))} to collect on delivery.`, "good");
  if (o.status === "failed") add(o.updatedAt, "Payment failed.", "bad");
  if (o.manualTags.includes("OTP skipped")) add(o.createdAt, "Mobile OTP was skipped (SMS service problem), order let through.");
  if (o.shopifyPushAt && o.shopifyOrderName) add(o.shopifyPushAt, `Created in Shopify as ${o.shopifyOrderName}.`);
  if (o.confirmAt) add(o.confirmAt, `WhatsApp order confirmation ${o.confirmStatus === "confirmed" ? "— customer confirmed" : o.confirmStatus === "cancelled" ? "— customer cancelled" : "sent"}.`, o.confirmStatus === "confirmed" ? "good" : o.confirmStatus === "cancelled" ? "bad" : "event");
  for (const c of d.calls) add(c.at, c.kind === "skip" ? "Confirmation call skipped" : "Confirmation call made", "event", c.provider ? `via ${c.provider}` : undefined, c.actor);
  if (o.callAt && o.callStatus) add(o.callAt, o.callStatus === "confirmed" ? "Confirmed on call." : o.callStatus === "cancelled" ? "Cancelled on call." : `Call follow-up${o.followUpAt ? ` set for ${longDate(o.followUpAt)}` : ""}.`, o.callStatus === "confirmed" ? "good" : o.callStatus === "cancelled" ? "bad" : "event", undefined, o.callBy ?? undefined);
  if (o.labelPrintedAt) add(o.labelPrintedAt, "Shipping label printed.");
  if (o.shippedAt) add(o.shippedAt, `Booked with ${o.courier ? courierById(o.courier)?.name ?? o.courier : "the courier"}${o.awb ? ` (AWB ${o.awb})` : ""}.`, "ship");
  if (o.ofdAt) add(o.ofdAt, `Out for delivery${o.ofdAttempts > 1 ? ` (attempt ${o.ofdAttempts})` : ""}.`, "ship");
  if (o.ndrAt) add(o.ndrAt, "Delivery attempt failed (NDR).", "bad", o.ndrReason ?? undefined);
  if (o.reattemptAt) add(o.reattemptAt, "Re-attempt requested with the courier.", "ship");
  if (o.ofdCallAt && o.ofdCallStatus) add(o.ofdCallAt, `Delivery-day call: ${o.ofdCallStatus === "ready" ? "customer ready" : o.ofdCallStatus === "denied" ? "customer denied" : "follow-up"}.`, o.ofdCallStatus === "denied" ? "bad" : "event", undefined, o.ofdCallBy ?? undefined);
  if (o.deliveredAt) add(o.deliveredAt, "Delivered to the customer.", "good");
  if ((o.shipStatus === "rto" || o.shipStatus === "rto_transit") && o.shipStatusAt) add(o.shipStatusAt, o.shipStatus === "rto" ? "Returned to origin (RTO)." : "RTO in transit.", "bad");
  if (o.cancelledAt) add(o.cancelledAt, `Order cancelled${o.cancelReason ? `: ${o.cancelReason}` : "."}`, "bad", undefined, o.cancelledBy ?? undefined);
  for (const e of o.timeline ?? []) add(e.at, e.text, (e as { kind?: string }).kind === "comment" ? "comment" : "event", undefined, e.by);
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}

function TimelineCard({ d, o }: { d: Data; o: OrderRow & Data["order"] }) {
  const events = useMemo(() => buildTimeline(d, o), [d, o]);
  const nav = useNavigation();
  const posting = nav.state !== "idle" && nav.formData?.get("intent") === "comment";
  const formRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const wasPosting = useRef(false);
  useEffect(() => { if (posting) wasPosting.current = true; else if (wasPosting.current) { wasPosting.current = false; setText(""); } }, [posting]);
  const groups: { day: string; items: Ev[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.at);
    const g = groups[groups.length - 1];
    if (g?.day === day) g.items.push(e); else groups.push({ day, items: [e] });
  }
  const dot: Record<Ev["kind"], string> = { comment: "bg-[#5b6cf0]", event: "bg-ink-faint", good: "bg-[#1f8f5f]", bad: "bg-[#d92d20]", ship: "bg-[#0e7490]" };
  return (
    <section>
      <h2 className="mb-2 px-1 text-[13.5px] font-semibold">Timeline</h2>
      <Form method="post" ref={formRef} className="panel overflow-hidden p-0">
        <input type="hidden" name="intent" value="comment" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
        <div className="flex items-start gap-3 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ffd79d] text-[12px] font-semibold text-[#5e4200]"><Icon name="chat" className="h-4 w-4" /></span>
          <textarea name="comment" value={text} onChange={(e) => setText(e.target.value)} rows={text.includes("\n") ? 3 : 1} maxLength={1000} placeholder="Leave a comment…"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) formRef.current?.requestSubmit(); }}
            className="min-h-8 flex-1 resize-none border-0 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-ink-faint" />
        </div>
        <div className="flex items-center justify-between border-t border-rule bg-paper/60 px-4 py-2">
          <span className="flex items-center gap-1 text-[11.5px] text-ink-faint"><Icon name="lock" className="h-3 w-3" />Only you and your team can see comments</span>
          <button className="btn-primary h-7 px-3 text-[12px]" disabled={!text.trim() || posting}>{posting ? "Posting…" : "Post"}</button>
        </div>
      </Form>
      <ol className="relative ml-[29px] mt-1 border-l-2 border-rule pb-2">
        {groups.map((g) => (
          <li key={g.day} className="pt-4">
            <p className="-ml-px pl-5 text-[12px] font-medium text-ink-soft">{g.day}</p>
            <ul className="mt-1.5 space-y-1">
              {g.items.map((e, i) => (
                <li key={i} className="relative flex items-start gap-3 py-1.5 pl-5 pr-1">
                  <span className={`absolute -left-[6px] top-[11px] h-2.5 w-2.5 rounded-full ring-4 ring-paper ${dot[e.kind]}`} />
                  <div className={`min-w-0 flex-1 text-[13px] ${e.kind === "comment" ? "rounded-xl bg-white px-3 py-2 shadow-[0_0_0_1px_rgba(0,0,0,.06)]" : ""}`}>
                    <p className="whitespace-pre-wrap break-words">{e.text}</p>
                    {(e.sub || e.by) && <p className="mt-0.5 text-[11.5px] text-ink-faint">{[e.by, e.sub].filter(Boolean).join(" · ")}</p>}
                  </div>
                  <span className="num shrink-0 pt-0.5 text-[11.5px] text-ink-faint">{timeOnly(e.at)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------- side cards ----------------

function NotesCard({ o }: { o: OrderRow }) {
  const [edit, setEdit] = useState(false);
  const nav = useNavigation();
  useEffect(() => { if (nav.state === "idle") setEdit(false); }, [nav.state]);
  return (
    <Card title="Notes" right={<button type="button" onClick={() => setEdit((x) => !x)} className="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-soft hover:bg-black/[.05] hover:text-ink">{edit ? "Close" : o.staffNote || o.customerNote ? "Edit" : "Add"}</button>}>
      <div className="px-4 pb-3.5 pt-1 text-[13px]">
        {edit ? <NotesBlock o={o} /> : (o.staffNote || o.customerNote) ? (
          <div className="space-y-2">
            {o.staffNote && <p className="whitespace-pre-wrap"><span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint"><Icon name="lock" className="h-3 w-3" />Team</span>{o.staffNote}</p>}
            {o.customerNote && <p className="whitespace-pre-wrap"><span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint"><Icon name="user" className="h-3 w-3" />For customer</span>{o.customerNote}</p>}
          </div>
        ) : <p className="text-ink-faint">No notes</p>}
      </div>
    </Card>
  );
}

function CustomerCard({ d, o }: { d: Data; o: OrderRow }) {
  const c = o.customer as OrderCustomer;
  const name = `${c.firstName} ${c.lastName}`.trim() || "Customer";
  const ordersLink = `/dashboard/orders?q=${encodeURIComponent(c.phone)}&range=max`;
  const addr = [c.address1, c.address2, c.city, stateName(c.state), c.pincode].filter(Boolean).join(", ");
  return (
    <Card title="Customer">
      <div className="space-y-3 px-4 pb-4 pt-1 text-[13px]">
        <div>
          <Link to={ordersLink} className="font-medium text-[#005bd3] hover:underline">{name}</Link>
          <p className="mt-0.5 text-ink-soft">
            <Link to={ordersLink} className="hover:underline">{d.customer.orders === 1 ? "First order" : `${d.customer.orders} orders`}</Link>
            {d.customer.orders > 1 && <> · {inr(d.customer.spentPaise)} spent</>}
          </p>
          {d.customer.orders > 1 && (d.customer.delivered > 0 || d.customer.rto > 0) && (
            <p className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
              {d.customer.delivered > 0 && <span className="rounded-md bg-[#e3f1ea] px-1.5 py-0.5 font-medium text-[#0c5132]">{d.customer.delivered} delivered</span>}
              {d.customer.rto > 0 && <span className="rounded-md bg-[#fee9e8] px-1.5 py-0.5 font-medium text-[#8e1f0b]">{d.customer.rto} RTO</span>}
            </p>
          )}
        </div>
        <div className="border-t border-rule pt-3">
          <p className="text-[12px] font-medium text-ink-soft">Contact information</p>
          {c.email && <p className="mt-1 flex items-center gap-1 break-all text-[#005bd3]"><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a><CopyButton text={c.email} label="Copy email" small /></p>}
          <p className="mt-1 flex items-center gap-1"><a href={`tel:+91${c.phone}`} className="num hover:underline">+91 {c.phone}</a><CopyButton text={c.phone} label="Copy number" small />
            <a href={`https://wa.me/91${c.phone}`} target="_blank" rel="noreferrer" className="ml-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#128C7E] hover:bg-[#128C7E]/10">WhatsApp</a></p>
        </div>
        <div className="border-t border-rule pt-3">
          <AddressBlock o={o} />
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-[#005bd3] hover:underline">View map<Icon name="external" className="h-3 w-3" /></a>
        </div>
      </div>
    </Card>
  );
}

function SourceCard({ d }: { d: Data }) {
  const s = d.source;
  const meta = SOURCE_META[s.channel] ?? SOURCE_META.unknown;
  let landing: { host: string; path: string } | null = null;
  try { if (d.landing) { const u = new URL(d.landing); landing = { host: u.hostname.replace(/^www\./, ""), path: u.pathname }; } } catch { /* not a URL */ }
  return (
    <Card title="Order source" icon="target">
      <div className="space-y-2.5 px-4 pb-4 pt-1.5 text-[13px]">
        <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: `${meta.color}0f`, boxShadow: `inset 0 0 0 1px ${meta.color}26` }}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: meta.color }}><Icon name={s.paid ? "ads" : s.channel === "direct" ? "user" : s.channel === "unknown" ? "help" : "globe"} className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold" style={{ color: meta.color }}>{meta.label}{s.paid && <span className="rounded px-1 text-[9.5px] font-bold uppercase tracking-wide text-white" style={{ background: meta.color }}>Ad</span>}</p>
            <p className="text-[11.5px] text-ink-soft">{s.paid ? "This order came from an ad" : s.channel === "direct" ? "Not from an ad" : s.channel === "unknown" ? "Source not recorded" : "Not a paid ad"}</p>
          </div>
        </div>
        {s.placement && <KV k="Ad shown on" v={s.placement} />}
        {s.campaign && <KV k="Campaign" v={s.campaign} />}
        {s.detail && <KV k="Tags" v={s.campaign ? s.detail.replace(` · ${s.campaign}`, "") : s.detail} />}
        {landing && <KV k="Checkout from" v={`${landing.host}${landing.path === "/" ? "" : landing.path}`} />}
        {s.hint && <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink-faint"><Icon name="help" className="mt-px h-3.5 w-3.5 shrink-0" />{s.hint}</p>}
        <div className="space-y-2 border-t border-rule pt-2.5">
          <KV k="Meta Purchase event" v={d.order.capiSentAt ? <span className="text-[#0c5132]">Sent · {longDate(d.order.capiSentAt)}</span> : <span className="text-ink-faint">Not sent</span>} />
          {d.order.googleSentAt && <KV k="Google Ads purchase" v={<span className="text-[#0c5132]">Sent · {longDate(d.order.googleSentAt)}</span>} />}
        </div>
      </div>
    </Card>
  );
}

function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-3"><span className="shrink-0 text-ink-soft">{k}</span><span className={`min-w-0 break-words text-right ${mono ? "num" : ""}`}>{v}</span></div>;
}

function VisitCard({ d }: { d: Data }) {
  const ua = parseUa(d.ua);
  const ip = d.ip;
  if (!ip && !ua) return null;
  const g = ip?.geo ?? null;
  return (
    <Card title="IP address & device" icon="shield">
      <div className="space-y-2.5 px-4 pb-4 pt-1.5 text-[13px]">
        {ip && (
          <>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2">
              <span className="num min-w-0 break-all font-medium">{ip.address}</span>
              <CopyButton text={ip.address} label="Copy IP address" small />
            </div>
            <KV k="Location" v={g ? <span>{flagOf(g.cc)} {placeOf(g)}</span> : <span className="text-ink-faint">Not found</span>} />
            {g?.postal && <KV k="Postal code" v={g.postal} mono />}
            {g?.isp && <KV k="Network" v={g.isp} />}
            {hasPoint(g) && <a href={`https://www.google.com/maps?q=${g.lat},${g.lon}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-[#005bd3] hover:underline">See IP location on map<Icon name="external" className="h-3 w-3" /></a>}
            {ip.stateMismatch && (
              <p className="flex items-start gap-1.5 rounded-lg bg-[#fff6e5] px-2.5 py-2 text-[12px] leading-snug text-[#7a4b00]"><Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
                The IP is in {g?.region}, the delivery address is in {ip.deliveryState}. Often normal (mobile networks, travel), but worth a look on a costly COD order.</p>
            )}
            {ip.sameIp.length > 0 && (
              <div className="rounded-lg bg-paper px-2.5 py-2">
                <p className="text-[12px] font-medium">{ip.sameIp.length}{ip.sameIp.length === 6 ? "+" : ""} other order{ip.sameIp.length === 1 ? "" : "s"} from this IP (90 days)</p>
                <ul className="mt-1 space-y-0.5 text-[12px]">
                  {ip.sameIp.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link to={`/dashboard/orders/${encodeURIComponent(r.id)}`} className="num text-[#005bd3] hover:underline">{r.name ?? `#${r.id.slice(-6).toUpperCase()}`}</Link>
                      <span className={r.samePhone ? "text-ink-faint" : "font-medium text-[#7a4b00]"}>{r.samePhone ? "same customer" : "different number"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {ua && (
          <div className={ip ? "border-t border-rule pt-2.5 space-y-2.5" : "space-y-2.5"}>
            <KV k="Device" v={<span className="inline-flex items-center gap-1"><Icon name={ua.device === "Desktop" ? "overview" : "phone"} className="h-3.5 w-3.5 text-ink-soft" />{ua.device} · {ua.os}</span>} />
            <KV k="Browser" v={ua.inApp ?? ua.browser} />
          </div>
        )}
      </div>
    </Card>
  );
}

function TagsCard({ o }: { o: OrderRow }) {
  const nav = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const adding = nav.state !== "idle" && nav.formData?.get("intent") === "tagAdd";
  useEffect(() => { if (!adding) formRef.current?.reset(); }, [adding]);
  return (
    <Card title="Tags" icon="tag">
      <div className="space-y-2.5 px-4 pb-4 pt-1.5">
        <Form method="post" ref={formRef} className="flex gap-1.5"><input type="hidden" name="intent" value="tagAdd" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} />
          <input name="tag" maxLength={32} minLength={2} required placeholder="Add a tag" className="input min-w-0 py-1.5 text-[12.5px]" /><button className="btn-secondary px-2.5 py-1.5 text-xs" disabled={adding}>Add</button></Form>
        <div className="flex flex-wrap items-center gap-1.5">
          {isOutsource(o) && <span className="rounded-md bg-[#7c3aed] px-1.5 py-0.5 text-[10.5px] font-bold text-white">{OUTSOURCE_TAG}</span>}
          {o.manualTags.filter((t) => t !== OUTSOURCE_TAG).map((tag) => (
            <Form key={tag} method="post" className="inline-flex"><input type="hidden" name="intent" value="tagRemove" /><input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="storeId" value={o.storeId} /><input type="hidden" name="tag" value={tag} />
              <span className="inline-flex items-center gap-1 rounded-md bg-paper-sunk py-0.5 pl-2 pr-1 text-[12px]">{tag}<button className="rounded p-0.5 text-ink-faint hover:bg-black/[.06] hover:text-ink" aria-label={`Remove tag ${tag}`}><Icon name="close" className="h-3 w-3" /></button></span></Form>
          ))}
          {o.tags.filter((t) => !o.manualTags.includes(t) && t !== OUTSOURCE_TAG).length > 0 && <Tags o={{ ...o, tags: o.tags.filter((t) => !o.manualTags.includes(t)) }} />}
        </div>
      </div>
    </Card>
  );
}

function TeamCard({ d, o }: { d: Data; o: OrderRow & Data["order"] }) {
  const call = o.callStatus === "confirmed" ? "Confirmed" : o.callStatus === "cancelled" ? "Cancelled" : o.callStatus === "follow_up" ? "Follow-up" : "Not called yet";
  return (
    <Card title="Calling team" icon="phone">
      <div className="space-y-2 px-4 pb-4 pt-1.5 text-[13px]">
        <KV k="Confirmation call" v={call} />
        {d.assigned.confirm && <KV k="Assigned to" v={d.assigned.confirm} />}
        {o.callAttempts > 0 && <KV k="Call attempts" v={o.callAttempts} mono />}
        {o.followUpAt && o.callStatus === "follow_up" && <KV k="Follow-up" v={longDate(o.followUpAt)} />}
        {(o.ofdCallStatus || d.assigned.ofd) && <div className="border-t border-rule pt-2 space-y-2">
          <KV k="Delivery-day call" v={o.ofdCallStatus === "ready" ? "Ready" : o.ofdCallStatus === "denied" ? "Denied" : o.ofdCallStatus === "follow_up" ? "Follow-up" : "Not called yet"} />
          {d.assigned.ofd && <KV k="Assigned to" v={d.assigned.ofd} />}
        </div>}
      </div>
    </Card>
  );
}

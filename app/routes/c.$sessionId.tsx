import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { bankOffers, checkoutSessions, db, orders, stores, type OrderCustomer } from "~/db.server";
import { findCoupon, listVisibleCoupons } from "~/lib/coupons.server";
import { finalizeOrder, newOrderId } from "~/lib/orders.server";
import {
  bankOfferEstimate,
  computePricing,
  formatINR,
  type BankOfferRule,
  type CouponRule,
  type PaymentMethod,
} from "~/lib/pricing";
import { fetchLines } from "~/lib/shopify.server";
import { INDIAN_STATES, stateCodeFromName } from "~/lib/states";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function loadSession(sessionId: string) {
  const [row] = await db
    .select({ session: checkoutSessions, store: stores })
    .from(checkoutSessions)
    .innerJoin(stores, eq(checkoutSessions.storeId, stores.id))
    .where(eq(checkoutSessions.id, sessionId))
    .limit(1);
  if (!row || !row.store.active) throw new Response("Checkout link invalid hai", { status: 404 });
  if (Date.now() - row.session.createdAt.getTime() > SESSION_TTL_MS) {
    throw new Response("Ye checkout link expire ho gaya. Store pe wapas jaakar dobara checkout karein.", { status: 410 });
  }
  return row;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `Checkout · ${data.store.name}` : "Checkout" },
  { name: "robots", content: "noindex" },
];

export async function loader({ params }: LoaderFunctionArgs) {
  const { session, store } = await loadSession(params.sessionId!);
  const [lines, coupons, offers] = await Promise.all([
    fetchLines(store, session.items),
    listVisibleCoupons(store.id),
    db
      .select()
      .from(bankOffers)
      .where(and(eq(bankOffers.storeId, store.id), eq(bankOffers.active, true)))
      .orderBy(asc(bankOffers.sort)),
  ]);
  if (!lines.length) throw new Response("Cart ke products ab available nahi hain", { status: 404 });

  return json({
    store: {
      name: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.primaryColor,
      storefrontUrl: store.storefrontUrl,
      supportPhone: store.supportPhone,
      prepaidDiscountPct: store.prepaidDiscountPct,
      codDiscountPct: store.codDiscountPct,
      codEnabled: store.codEnabled,
      payuReady: Boolean(store.payuKey && store.payuSalt),
    },
    lines,
    coupons,
    bankOffers: offers.map(
      (o): BankOfferRule => ({
        id: o.id,
        bankName: o.bankName,
        title: o.title,
        type: o.type === "flat" ? "flat" : "percent",
        value: o.value,
        maxDiscountRupees: o.maxDiscountRupees,
        minCartRupees: o.minCartRupees,
      }),
    ),
  });
}

type FieldErrors = Partial<Record<keyof OrderCustomer | "form", string>>;

export async function action({ request, params }: ActionFunctionArgs) {
  const { session, store } = await loadSession(params.sessionId!);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "coupon") {
    return json(await findCoupon(store.id, String(fd.get("code") ?? "")));
  }

  // ----- place order -----
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const customer: OrderCustomer = {
    firstName: str("firstName"),
    lastName: str("lastName"),
    phone: str("phone").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""),
    email: str("email"),
    address1: str("address1"),
    address2: str("address2"),
    city: str("city"),
    state: str("state"),
    pincode: str("pincode").replace(/\D/g, ""),
  };
  const method: PaymentMethod = str("method") === "cod" ? "cod" : "prepaid";

  const errors: FieldErrors = {};
  if (!customer.firstName) errors.firstName = "Naam daalein";
  if (!/^[6-9]\d{9}$/.test(customer.phone)) errors.phone = "Sahi 10-digit mobile number daalein";
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) errors.email = "Email sahi nahi hai";
  if (customer.address1.length < 5) errors.address1 = "Poora address daalein";
  if (!customer.city) errors.city = "City daalein";
  if (!INDIAN_STATES.some((s) => s.code === customer.state)) errors.state = "State chunein";
  if (!/^\d{6}$/.test(customer.pincode)) errors.pincode = "6-digit pincode daalein";
  if (method === "cod" && !store.codEnabled) errors.form = "Cash on Delivery abhi available nahi hai";
  if (method === "prepaid" && !(store.payuKey && store.payuSalt)) errors.form = "Online payment abhi available nahi hai";
  if (Object.keys(errors).length) return json({ errors }, { status: 400 });

  // Re-price from Shopify + re-validate coupon on the server
  const lines = await fetchLines(store, session.items);
  if (!lines.length) return json({ errors: { form: "Cart ke products available nahi hain" } as FieldErrors }, { status: 400 });

  let coupon: CouponRule | null = null;
  const code = str("couponCode");
  if (code) {
    const r = await findCoupon(store.id, code);
    if ("error" in r) return json({ errors: { form: `Coupon: ${r.error}` } as FieldErrors }, { status: 400 });
    coupon = r.coupon;
  }
  const p = computePricing(lines, store, method, coupon);

  const [order] = await db
    .insert(orders)
    .values({
      id: newOrderId(),
      storeId: store.id,
      sessionId: session.id,
      status: method === "cod" ? "cod_placing" : "pending_payment",
      paymentMethod: method,
      customer,
      items: lines,
      subtotal: p.subtotal,
      paymentDiscount: p.paymentDiscount,
      couponCode: p.couponApplied ? coupon!.code : null,
      couponDiscount: p.couponDiscount,
      total: p.total,
    })
    .returning();

  if (method === "cod") {
    await finalizeOrder(store, order, { status: "cod_placed" });
    return redirect(`/order/${order.id}`);
  }
  return redirect(`/pay/${order.id}`);
}

// ======================= UI =======================

const EMPTY: OrderCustomer = {
  firstName: "", lastName: "", phone: "", email: "", address1: "", address2: "", city: "", state: "", pincode: "",
};
const LS_KEY = "cx_customer_v1";

function hexToRgb(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "17 24 39";
}

export default function Checkout() {
  const { store, lines, coupons, bankOffers: offers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const couponFetcher = useFetcher<typeof action>();

  const [c, setC] = useState<OrderCustomer>(EMPTY);
  const [method, setMethod] = useState<PaymentMethod>(store.payuReady ? "prepaid" : "cod");
  const [coupon, setCoupon] = useState<CouponRule | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Restore saved details
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setC({ ...EMPTY, ...JSON.parse(saved) });
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  }, [c]);

  // Coupon apply result
  useEffect(() => {
    const d = couponFetcher.data as { coupon?: CouponRule; error?: string } | undefined;
    if (!d) return;
    if (d.coupon) { setCoupon(d.coupon); setCouponError(null); setCouponInput(d.coupon.code); }
    else if (d.error) { setCouponError(d.error); }
  }, [couponFetcher.data]);

  // Pincode -> city/state autofill (best effort)
  useEffect(() => {
    if (!/^\d{6}$/.test(c.pincode)) return;
    const ctrl = new AbortController();
    fetch(`https://api.postalpincode.in/pincode/${c.pincode}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        const po = d?.[0]?.PostOffice?.[0];
        if (!po) return;
        const code = stateCodeFromName(po.State ?? "");
        setC((prev) => ({ ...prev, city: prev.city || po.District || "", state: prev.state || code || "" }));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [c.pincode]);

  const prepaid = useMemo(() => computePricing(lines, store, "prepaid", coupon), [lines, store, coupon]);
  const cod = useMemo(() => computePricing(lines, store, "cod", coupon), [lines, store, coupon]);
  const p = method === "prepaid" ? prepaid : cod;
  const bestBank = useMemo(
    () => Math.max(0, ...offers.map((o) => bankOfferEstimate(o, prepaid.subtotal, prepaid.total))),
    [offers, prepaid],
  );

  const errors = (actionData && "errors" in actionData ? actionData.errors : {}) as FieldErrors;
  const placing = nav.state !== "idle" && nav.formData?.get("intent") === "place";
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const set = (k: keyof OrderCustomer) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setC((prev) => ({ ...prev, [k]: e.target.value }));

  const applyCode = (code: string) => {
    setCouponError(null);
    couponFetcher.submit({ intent: "coupon", code }, { method: "post" });
  };

  const payLabel = method === "prepaid" ? `Pay ${formatINR(p.total)}` : `Place COD order · ${formatINR(p.total)}`;

  return (
    <div style={{ ["--brand" as string]: hexToRgb(store.primaryColor) }} className="pb-28 lg:pb-10">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href={store.storefrontUrl} className="flex items-center gap-2">
            {store.logoUrl ? (
              <img src={store.logoUrl} alt={store.name} className="h-8 w-auto max-w-[140px] object-contain" />
            ) : (
              <span className="text-lg font-bold">{store.name}</span>
            )}
          </a>
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <LockIcon /> Secure checkout
          </span>
        </div>
      </header>

      {/* Mobile summary toggle */}
      <button
        type="button"
        onClick={() => setSummaryOpen((o) => !o)}
        className="flex w-full items-center justify-between border-b border-gray-200 bg-white px-4 py-3 text-sm lg:hidden"
      >
        <span className="font-medium text-brand">
          {summaryOpen ? "Order summary chhupayein ▴" : `Order summary (${itemCount}) ▾`}
        </span>
        <span className="text-right">
          {p.mrpTotal > p.total && <s className="mr-2 text-xs text-gray-400">{formatINR(p.mrpTotal)}</s>}
          <b>{formatINR(p.total)}</b>
        </span>
      </button>
      {summaryOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-4 lg:hidden">
          <Summary lines={lines} p={p} method={method} coupon={coupon} hasOffers={offers.length > 0} />
        </div>
      )}

      {/* Savings banner */}
      {p.savings > 0 && (
        <div className="bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white">
          🎉 Is order pe aap {formatINR(p.savings)} bacha rahe hain
        </div>
      )}

      <Form method="post" id="checkout-form" className="mx-auto grid max-w-6xl gap-5 px-4 py-5 lg:grid-cols-[1fr_400px] lg:gap-8 lg:py-8">
        <input type="hidden" name="intent" value="place" />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="couponCode" value={coupon?.code ?? ""} />

        <div className="space-y-5">
          {/* Contact & address */}
          <section className="card">
            <h2 className="mb-4 text-base font-semibold">Delivery details</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mobile number *" error={errors.phone} className="col-span-2">
                <div className="flex">
                  <span className="flex items-center rounded-l-xl border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-600">+91</span>
                  <input name="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} required
                    className="input rounded-l-none" placeholder="10-digit mobile" value={c.phone} onChange={set("phone")} />
                </div>
              </Field>
              <Field label="First name *" error={errors.firstName}>
                <input name="firstName" autoComplete="given-name" required className="input" value={c.firstName} onChange={set("firstName")} />
              </Field>
              <Field label="Last name" error={errors.lastName}>
                <input name="lastName" autoComplete="family-name" className="input" value={c.lastName} onChange={set("lastName")} />
              </Field>
              <Field label="Email (order updates ke liye)" error={errors.email} className="col-span-2">
                <input name="email" type="email" autoComplete="email" className="input" placeholder="optional" value={c.email} onChange={set("email")} />
              </Field>
              <Field label="Pincode *" error={errors.pincode}>
                <input name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} required className="input" value={c.pincode} onChange={set("pincode")} />
              </Field>
              <Field label="City *" error={errors.city}>
                <input name="city" autoComplete="address-level2" required className="input" value={c.city} onChange={set("city")} />
              </Field>
              <Field label="House no., building, street *" error={errors.address1} className="col-span-2">
                <input name="address1" autoComplete="address-line1" required className="input" value={c.address1} onChange={set("address1")} />
              </Field>
              <Field label="Area, landmark" error={errors.address2} className="col-span-2">
                <input name="address2" autoComplete="address-line2" className="input" value={c.address2} onChange={set("address2")} />
              </Field>
              <Field label="State *" error={errors.state} className="col-span-2">
                <select name="state" required className="input" value={c.state} onChange={set("state")}>
                  <option value="">State chunein</option>
                  {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </Field>
            </div>
          </section>

          {/* Offers */}
          <section className="card">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><TagIcon /> Coupons & offers</h2>
            {coupon ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-800">{coupon.code} applied</p>
                  <p className="text-xs text-emerald-700">
                    {p.couponApplied ? `${formatINR(p.couponDiscount)} extra off` : p.couponMessage}
                  </p>
                  {p.couponApplied && p.couponMessage && <p className="text-xs text-emerald-700">{p.couponMessage}</p>}
                </div>
                <button type="button" className="text-sm font-medium text-red-600" onClick={() => { setCoupon(null); setCouponInput(""); }}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className="input uppercase" placeholder="Coupon code" value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(couponInput); } }} />
                <button type="button" className="btn-primary shrink-0 px-5" disabled={!couponInput.trim() || couponFetcher.state !== "idle"}
                  onClick={() => applyCode(couponInput)}>
                  {couponFetcher.state !== "idle" ? "…" : "Apply"}
                </button>
              </div>
            )}
            {couponError && <p className="mt-2 text-xs text-red-600">{couponError}</p>}

            {coupons.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Available coupons</p>
                {coupons.map((cp) => {
                  const preview = computePricing(lines, store, method, cp);
                  const active = coupon?.code === cp.code;
                  return (
                    <div key={cp.code} className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-3.5 py-3 ${active ? "border-emerald-400 bg-emerald-50" : "border-gray-300"}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-bold tracking-wide">{cp.code}</p>
                        <p className="text-xs text-gray-600">
                          {cp.description || (cp.type === "percent" ? `${cp.value}% off` : `₹${cp.value} off`)}
                          {cp.paymentRestriction !== "any" && ` · sirf ${cp.paymentRestriction === "prepaid" ? "prepaid" : "COD"}`}
                        </p>
                        {preview.couponApplied && <p className="text-xs font-medium text-emerald-700">Aapko {formatINR(preview.couponDiscount)} aur bachenge</p>}
                      </div>
                      <button type="button" disabled={active} onClick={() => applyCode(cp.code)}
                        className="shrink-0 text-sm font-semibold text-brand disabled:text-emerald-700">
                        {active ? "Applied ✓" : "Apply"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {offers.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Bank offers (online payment)</p>
                {offers.map((o) => {
                  const est = bankOfferEstimate(o, prepaid.subtotal, prepaid.total);
                  return (
                    <div key={o.id} className="flex items-start gap-3 rounded-xl bg-blue-50 px-3.5 py-3">
                      <span className="mt-0.5 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold text-blue-800">{o.bankName}</span>
                      <div className="text-xs text-blue-900">
                        <p className="font-semibold">{o.title}</p>
                        {est > 0 && <p>Is order pe extra {formatINR(est)} tak ki bachat</p>}
                        <p className="text-blue-700">Card details daalte hi payment page pe auto-apply hoga</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Payment */}
          <section className="card">
            <h2 className="mb-3 text-base font-semibold">Payment method</h2>
            <div className="space-y-3">
              {store.payuReady && (
                <PayOption
                  selected={method === "prepaid"}
                  onSelect={() => setMethod("prepaid")}
                  title="Pay online"
                  subtitle="UPI · Cards · Netbanking · Wallets"
                  badge={prepaid.paymentDiscountPct > 0 ? `${prepaid.paymentDiscountPct}% OFF` : null}
                  amount={prepaid.total}
                  note={
                    <>
                      {prepaid.total < cod.total && <>COD se {formatINR(cod.total - prepaid.total)} sasta</>}
                      {bestBank > 0 && <> · bank offer se {formatINR(bestBank)} tak aur</>}
                    </>
                  }
                  highlight
                />
              )}
              {store.codEnabled && (
                <PayOption
                  selected={method === "cod"}
                  onSelect={() => setMethod("cod")}
                  title="Cash on Delivery"
                  subtitle="Delivery ke time pay karein"
                  badge={cod.paymentDiscountPct > 0 ? `${cod.paymentDiscountPct}% OFF` : null}
                  amount={cod.total}
                  note={store.payuReady && prepaid.total < cod.total ? <>Online pay karke {formatINR(cod.total - prepaid.total)} aur bachayein</> : null}
                />
              )}
            </div>
            {errors.form && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}
          </section>
        </div>

        {/* Desktop summary */}
        <aside className="hidden lg:block">
          <div className="card sticky top-20">
            <h2 className="mb-4 text-base font-semibold">Order summary</h2>
            <Summary lines={lines} p={p} method={method} coupon={coupon} hasOffers={offers.length > 0} />
            <button type="submit" className="btn-primary mt-5 w-full py-3.5 text-base" disabled={placing}>
              {placing ? "Please wait…" : payLabel}
            </button>
            <Trust phone={store.supportPhone} />
          </div>
        </aside>
      </Form>

      {/* Mobile sticky pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white px-4 pt-3 lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{formatINR(p.total)}</p>
            {p.savings > 0 && <p className="text-xs font-medium text-emerald-700">{formatINR(p.savings)} saved</p>}
          </div>
          <button type="submit" form="checkout-form" className="btn-primary flex-1 py-3.5 text-base" disabled={placing}>
            {placing ? "Please wait…" : method === "prepaid" ? "Pay now" : "Place order"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- pieces ----------

type P = ReturnType<typeof computePricing>;
type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

function Summary({ lines, p, method, coupon, hasOffers }: {
  lines: LoaderData["lines"]; p: P; method: PaymentMethod; coupon: CouponRule | null; hasOffers: boolean;
}) {
  return (
    <div>
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.variantId} className="flex gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
              {l.image && <img src={l.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
              <span className="absolute -right-0 -top-0 rounded-bl-lg bg-gray-800 px-1.5 text-[11px] font-semibold text-white">{l.quantity}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium">{l.title}</p>
              {l.variantTitle && <p className="text-xs text-gray-500">{l.variantTitle}</p>}
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">{formatINR(l.pricePaise * l.quantity)}</p>
              {l.comparePaise && <s className="text-xs text-gray-400">{formatINR(l.comparePaise * l.quantity)}</s>}
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-2 border-t border-gray-200 pt-4 text-sm">
        <Row label="Subtotal" value={formatINR(p.subtotal)} />
        {p.paymentDiscount > 0 && (
          <Row label={`${method === "prepaid" ? "Prepaid" : "COD"} discount (${p.paymentDiscountPct}%)`} value={`−${formatINR(p.paymentDiscount)}`} green />
        )}
        {p.couponApplied && coupon && <Row label={`Coupon ${coupon.code}`} value={`−${formatINR(p.couponDiscount)}`} green />}
        <Row label="Shipping" value="FREE" green />
        <div className="flex items-baseline justify-between border-t border-gray-200 pt-3">
          <dt className="font-semibold">Total</dt>
          <dd className="text-right">
            {p.mrpTotal > p.total && <s className="mr-2 text-xs text-gray-400">{formatINR(p.mrpTotal)}</s>}
            <span className="text-xl font-bold">{formatINR(p.total)}</span>
          </dd>
        </div>
        {method === "prepaid" && hasOffers && <p className="text-xs text-gray-500">Bank offer discount (agar applicable) payment page pe lagega.</p>}
      </dl>
    </div>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-600">{label}</dt>
      <dd className={green ? "font-medium text-emerald-700" : "font-medium"}>{value}</dd>
    </div>
  );
}

function PayOption({ selected, onSelect, title, subtitle, badge, amount, note, highlight }: {
  selected: boolean; onSelect: () => void; title: string; subtitle: string; badge: string | null;
  amount: number; note?: React.ReactNode; highlight?: boolean;
}) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={`relative flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition ${selected ? "border-brand bg-brand/5" : "border-gray-200 hover:border-gray-300"}`}>
      <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-brand" : "border-gray-300"}`}>
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${highlight ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-800"}`}>{badge}</span>}
        </span>
        <span className="mt-0.5 block text-xs text-gray-500">{subtitle}</span>
        {note && <span className="mt-1 block text-xs font-medium text-emerald-700">{note}</span>}
      </span>
      <span className="shrink-0 text-right text-base font-bold">{formatINR(amount)}</span>
    </button>
  );
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Trust({ phone }: { phone: string | null }) {
  return (
    <div className="mt-4 space-y-1 text-center text-xs text-gray-500">
      <p className="flex items-center justify-center gap-1.5"><LockIcon /> 100% secure payments via PayU</p>
      {phone && <p>Help chahiye? <a className="underline" href={`tel:${phone}`}>{phone}</a></p>}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

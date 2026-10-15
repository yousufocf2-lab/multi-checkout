import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { and, asc, desc, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { MetaPixel } from "~/components/MetaPixel";
import { Spinner } from "~/components/ui";
import { bankOffers, checkoutSessions, db, discountRules, orders, stores, type OrderCustomer } from "~/db.server";
import { codBlockedMessage, codEligibility, normalizePhone, type CodStatus } from "~/lib/cod.server";
import { findCoupon, listVisibleCoupons } from "~/lib/coupons.server";
import { clientIp, finalizeOrder, newOrderId } from "~/lib/orders.server";
import {
  bankOfferEstimate, computePricing, formatINR, linePct,
  type BankOfferRule, type CouponRule, type PaymentMethod, type PricedLine, type StoreRule,
} from "~/lib/pricing";
import { fetchLines, fetchUpsellProducts } from "~/lib/shopify.server";
import { INDIAN_STATES, stateCodeFromName } from "~/lib/states";
import { ensureStoreHost } from "~/lib/urls.server";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QTY = 9999;

async function loadSession(sessionId: string) {
  const [row] = await db
    .select({ session: checkoutSessions, store: stores })
    .from(checkoutSessions)
    .innerJoin(stores, eq(checkoutSessions.storeId, stores.id))
    .where(eq(checkoutSessions.id, sessionId))
    .limit(1);
  if (!row || !row.store.active) throw new Response("This checkout link isn't valid. Go back to the store and check out again.", { status: 404 });
  if (Date.now() - row.session.createdAt.getTime() > SESSION_TTL_MS) {
    throw new Response("This checkout link has expired. Go back to the store and check out again.", { status: 410 });
  }
  return row;
}

async function storeRuleFor(store: typeof stores.$inferSelect): Promise<StoreRule> {
  const rules = await db
    .select()
    .from(discountRules)
    .where(and(eq(discountRules.storeId, store.id), eq(discountRules.active, true)))
    .orderBy(desc(discountRules.createdAt));
  return {
    prepaidDiscountPct: store.prepaidDiscountPct,
    codDiscountPct: store.codDiscountPct,
    rules: rules.map((r) => ({ productIds: r.products.map((p) => p.id), prepaidPct: r.prepaidPct, codPct: r.codPct })),
  };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `Checkout | ${data.store.name}` : "Checkout" },
  { name: "robots", content: "noindex" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, store } = await loadSession(params.sessionId!);
  ensureStoreHost(request, store);
  const [lines, coupons, offers, rule] = await Promise.all([
    fetchLines(store, session.items),
    listVisibleCoupons(store.id),
    db.select().from(bankOffers).where(and(eq(bankOffers.storeId, store.id), eq(bankOffers.active, true))).orderBy(asc(bankOffers.sort)),
    storeRuleFor(store),
  ]);

  let upsell: { productId: string; title: string; image: string | null; variants: { id: string; title: string; pricePaise: number; comparePaise: number | null }[] }[] = [];
  if (store.upsellEnabled && store.adminToken) {
    const inCart = new Set(lines.map((l) => l.productId));
    try {
      const products = await fetchUpsellProducts(store, store.upsellProducts.map((p) => p.id));
      upsell = products
        .filter((p) => !inCart.has(p.id))
        .slice(0, 6)
        .map((p) => ({ productId: p.id, title: p.title, image: p.image, variants: p.variants.filter((v) => v.available).map(({ available: _a, ...v }) => v) }));
    } catch (e) {
      console.error("[upsell]", e instanceof Error ? e.message : e);
    }
  }

  return json({
    store: {
      name: store.name, logoUrl: store.logoUrl, primaryColor: store.primaryColor, storefrontUrl: store.storefrontUrl,
      supportPhone: store.supportPhone, codEnabled: store.codEnabled, payuReady: Boolean(store.payuKey && store.payuSalt),
      pixelId: store.metaPixelId,
    },
    rule,
    lines,
    coupons,
    upsell,
    bankOffers: offers.map((o): BankOfferRule => ({
      id: o.id, bankName: o.bankName, title: o.title, type: o.type === "flat" ? "flat" : "percent",
      value: o.value, maxDiscountRupees: o.maxDiscountRupees, minCartRupees: o.minCartRupees,
    })),
  });
}

type FieldErrors = Partial<Record<keyof OrderCustomer | "form", string>>;

export async function action({ request, params }: ActionFunctionArgs) {
  const { session, store } = await loadSession(params.sessionId!);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "coupon") return json(await findCoupon(store.id, String(fd.get("code") ?? "")));

  if (intent === "eligibility") {
    const cod = await codEligibility(store, String(fd.get("phone") ?? ""));
    return json({ cod, message: cod.allowed ? null : codBlockedMessage(cod) });
  }

  if (intent === "cart") {
    const variantId = String(fd.get("variantId") ?? "").replace(/\D/g, "");
    const op = String(fd.get("op") ?? "");
    if (!variantId) return json({ cart: false });
    const items = [...session.items];
    const i = items.findIndex((x) => x.variantId === variantId);
    if (op === "add") {
      if (i >= 0) items[i] = { ...items[i], quantity: Math.min(MAX_QTY, items[i].quantity + 1) };
      else items.push({ variantId, quantity: 1 });
    } else if (op === "set" && i >= 0) {
      const q = Math.floor(Number(fd.get("quantity")));
      if (!Number.isFinite(q) || q <= 0) items.splice(i, 1);
      else items[i] = { ...items[i], quantity: Math.min(MAX_QTY, q) };
    }
    await db.update(checkoutSessions).set({ items: items.slice(0, 100) }).where(eq(checkoutSessions.id, session.id));
    return json({ cart: true });
  }

  // ----- place order -----
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const customer: OrderCustomer = {
    firstName: str("firstName"), lastName: str("lastName"), phone: normalizePhone(str("phone")), email: str("email"),
    address1: str("address1"), address2: str("address2"), city: str("city"), state: str("state"), pincode: str("pincode").replace(/\D/g, ""),
  };
  const method: PaymentMethod = str("method") === "cod" ? "cod" : "prepaid";

  const errors: FieldErrors = {};
  if (!customer.firstName) errors.firstName = "Enter your first name";
  if (!/^[6-9]\d{9}$/.test(customer.phone)) errors.phone = "Enter a valid 10-digit mobile number";
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) errors.email = "Enter a valid email address";
  if (customer.address1.length < 5) errors.address1 = "Enter your house number and street";
  if (!customer.city) errors.city = "Enter your city";
  if (!INDIAN_STATES.some((s) => s.code === customer.state)) errors.state = "Select your state";
  if (!/^\d{6}$/.test(customer.pincode)) errors.pincode = "Enter a 6-digit pincode";
  if (method === "prepaid" && !(store.payuKey && store.payuSalt)) errors.form = "Online payment isn't available right now. Choose Cash on Delivery.";
  if (method === "cod" && !errors.phone) {
    const cod = await codEligibility(store, customer.phone);
    if (!cod.allowed) errors.form = codBlockedMessage(cod);
  }
  if (Object.keys(errors).length) return json({ errors }, { status: 400 });

  const [lines, rule] = await Promise.all([fetchLines(store, session.items), storeRuleFor(store)]);
  if (!lines.length) return json({ errors: { form: "Your cart is empty. Go back to the store to add items." } as FieldErrors }, { status: 400 });

  let coupon: CouponRule | null = null;
  const code = str("couponCode");
  if (code) {
    const r = await findCoupon(store.id, code);
    if ("error" in r) return json({ errors: { form: `Coupon ${code.toUpperCase()}: ${r.error}` } as FieldErrors }, { status: 400 });
    coupon = r.coupon;
  }
  const p = computePricing(lines, rule, method, coupon);

  const [order] = await db
    .insert(orders)
    .values({
      id: newOrderId(), storeId: store.id, sessionId: session.id,
      status: method === "cod" ? "cod_placing" : "pending_payment", paymentMethod: method,
      customer, items: lines, subtotal: p.subtotal, paymentDiscount: p.paymentDiscount,
      couponCode: p.couponApplied ? coupon!.code : null, couponDiscount: p.couponDiscount, total: p.total,
      tracking: {
        ...(session.tracking ?? {}),
        ip: clientIp(request) ?? session.tracking?.ip,
        ua: request.headers.get("user-agent")?.slice(0, 500) ?? session.tracking?.ua,
      },
    })
    .returning();

  if (method === "cod") {
    await finalizeOrder(store, order, { status: "cod_placed" });
    return redirect(`/order/${order.id}`);
  }
  return redirect(`/pay/${order.id}`);
}

// ======================= UI =======================

const EMPTY: OrderCustomer = { firstName: "", lastName: "", phone: "", email: "", address1: "", address2: "", city: "", state: "", pincode: "" };
const LS_KEY = "cx_customer_v1";

function hexToRgb(hex: string) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : "17 24 39";
}

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Checkout() {
  const { store, rule, lines, coupons, upsell, bankOffers: offers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const couponFetcher = useFetcher<typeof action>();
  const codFetcher = useFetcher<{ cod: CodStatus; message: string | null }>();

  const [c, setC] = useState<OrderCustomer>(EMPTY);
  const [method, setMethod] = useState<PaymentMethod>(store.payuReady ? "prepaid" : "cod");
  const [coupon, setCoupon] = useState<CouponRule | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    try { const saved = localStorage.getItem(LS_KEY); if (saved) setC({ ...EMPTY, ...JSON.parse(saved) }); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ } }, [c]);

  useEffect(() => {
    const d = couponFetcher.data as { coupon?: CouponRule; error?: string } | undefined;
    if (!d) return;
    if (d.coupon) { setCoupon(d.coupon); setCouponError(null); setCouponInput(d.coupon.code); }
    else if (d.error) setCouponError(d.error);
  }, [couponFetcher.data]);

  // COD rules for this phone number
  const phoneOk = /^[6-9]\d{9}$/.test(c.phone);
  useEffect(() => {
    if (!phoneOk || !store.codEnabled) return;
    codFetcher.submit({ intent: "eligibility", phone: c.phone }, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.phone, phoneOk]);
  const codStatus = phoneOk ? codFetcher.data : undefined;
  const codBlocked = Boolean(codStatus && !codStatus.cod.allowed);
  const codAvailable = store.codEnabled && !codBlocked;
  useEffect(() => { if (codBlocked && method === "cod" && store.payuReady) setMethod("prepaid"); }, [codBlocked, method, store.payuReady]);

  // Pincode autofill
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

  const prepaid = useMemo(() => computePricing(lines, rule, "prepaid", coupon), [lines, rule, coupon]);
  const cod = useMemo(() => computePricing(lines, rule, "cod", coupon), [lines, rule, coupon]);
  const p = method === "prepaid" ? prepaid : cod;
  const bestBank = useMemo(() => Math.max(0, ...offers.map((o) => bankOfferEstimate(o, prepaid.subtotal, prepaid.total))), [offers, prepaid]);

  const errors = (actionData && "errors" in actionData ? actionData.errors : {}) as FieldErrors;
  const placing = nav.state !== "idle" && nav.formData?.get("intent") === "place";
  const redirectingToPay = placing && nav.formData?.get("method") === "prepaid";
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const set = (k: keyof OrderCustomer) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setC((prev) => ({ ...prev, [k]: k === "phone" ? e.target.value.replace(/\D/g, "").slice(-10) : e.target.value }));
  const applyCode = (code: string) => { setCouponError(null); couponFetcher.submit({ intent: "coupon", code }, { method: "post" }); };
  const discountLabel = (r: typeof prepaid) => (r.paymentDiscountPct ? `${r.paymentDiscountPct}% off` : r.paymentDiscount > 0 ? `Up to ${r.maxPaymentPct}% off` : null);
  const payLabel = method === "prepaid" ? `Pay ${formatINR(p.total)}` : `Place order, ${formatINR(p.total)}`;

  if (lines.length === 0) {
    return (
      <Shell store={store}>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <p className="text-xl font-semibold">Your cart is empty</p>
          <p className="mt-2 text-ink-soft">Add something you like and check out again.</p>
          <a href={store.storefrontUrl} className="btn-primary mt-6">Continue shopping</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell store={store}>
      {store.pixelId && (
        <MetaPixel pixelId={store.pixelId} event="InitiateCheckout"
          data={{ currency: "INR", value: p.total / 100, num_items: itemCount, content_ids: lines.map((l) => l.variantId), content_type: "product" }}
          onceKey={`ic_${lines.map((l) => l.variantId + "x" + l.quantity).join("_")}`} />
      )}

      {p.savings > 0 && (
        <div className="bg-brand px-4 py-2 text-center text-sm font-medium text-white">
          You're saving {formatINR(p.savings)} on this order{method === "cod" && prepaid.total < cod.total ? `. Pay online to save ${formatINR(cod.total - prepaid.total)} more.` : ""}
        </div>
      )}

      <Form method="post" id="checkout-form" className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-8 lg:py-8">
        <input type="hidden" name="intent" value="place" />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="couponCode" value={coupon?.code ?? ""} />

        <div className="space-y-4">
          {/* Mobile: order first so customers can edit it */}
          <Card title={`Your order (${itemCount})`} className="lg:hidden">
            <CartItems lines={lines} rule={rule} method={method} />
            {upsell.length > 0 && <Upsell items={upsell} rule={rule} />}
          </Card>

          <Card title="Delivery details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mobile number" error={errors.phone} className="col-span-2">
                <div className="flex">
                  <span className="flex items-center rounded-l-lg border border-r-0 border-rule-strong bg-paper px-3 text-[15px] text-ink-soft">+91</span>
                  <input name="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} required className="input rounded-l-none"
                    placeholder="10-digit mobile number" value={c.phone} onChange={set("phone")} aria-invalid={Boolean(errors.phone) || undefined} />
                </div>
              </Field>
              <Field label="First name" error={errors.firstName}><input name="firstName" autoComplete="given-name" required className="input" value={c.firstName} onChange={set("firstName")} /></Field>
              <Field label="Last name"><input name="lastName" autoComplete="family-name" className="input" value={c.lastName} onChange={set("lastName")} /></Field>
              <Field label="Email (optional, for order updates)" error={errors.email} className="col-span-2"><input name="email" type="email" autoComplete="email" className="input" value={c.email} onChange={set("email")} /></Field>
              <Field label="Pincode" error={errors.pincode}><input name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} required className="input" value={c.pincode} onChange={set("pincode")} /></Field>
              <Field label="City" error={errors.city}><input name="city" autoComplete="address-level2" required className="input" value={c.city} onChange={set("city")} /></Field>
              <Field label="House number, building, street" error={errors.address1} className="col-span-2"><input name="address1" autoComplete="address-line1" required className="input" value={c.address1} onChange={set("address1")} /></Field>
              <Field label="Area, landmark (optional)" className="col-span-2"><input name="address2" autoComplete="address-line2" className="input" value={c.address2} onChange={set("address2")} /></Field>
              <Field label="State" error={errors.state} className="col-span-2">
                <select name="state" required className="input" value={c.state} onChange={set("state")}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card title="Offers">
            {coupon ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-900">{coupon.code} applied</p>
                  <p className="text-xs text-emerald-800">{p.couponApplied ? `You save ${formatINR(p.couponDiscount)} more` : p.couponMessage}</p>
                  {p.couponApplied && p.couponMessage && <p className="text-xs text-emerald-800">{p.couponMessage}</p>}
                </div>
                <button type="button" className="text-sm font-medium text-bad" onClick={() => { setCoupon(null); setCouponInput(""); }}>Remove</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className="input uppercase" placeholder="Enter coupon code" value={couponInput} aria-label="Coupon code"
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(couponInput); } }} />
                <button type="button" className="btn-primary shrink-0 px-5" disabled={!couponInput.trim() || couponFetcher.state !== "idle"} onClick={() => applyCode(couponInput)}>
                  {couponFetcher.state !== "idle" ? <Spinner /> : "Apply"}
                </button>
              </div>
            )}
            {couponError && <p className="mt-2 text-xs font-medium text-bad" role="alert">{couponError}</p>}

            {coupons.length > 0 && (
              <ul className="mt-4 space-y-2">
                {coupons.map((cp) => {
                  const preview = computePricing(lines, rule, method, cp);
                  const active = coupon?.code === cp.code;
                  return (
                    <li key={cp.code} className={`flex items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-3 ${active ? "border-emerald-400 bg-emerald-50" : "border-rule-strong"}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tracking-wide">{cp.code}</p>
                        <p className="text-xs text-ink-soft">
                          {cp.description || (cp.type === "percent" ? `${cp.value}% off` : `${formatINR(cp.value * 100)} off`)}
                          {cp.paymentRestriction !== "any" && (cp.paymentRestriction === "prepaid" ? ", online payment only" : ", COD only")}
                        </p>
                        {preview.couponApplied ? <p className="text-xs font-medium text-good">Save {formatINR(preview.couponDiscount)} more</p>
                          : preview.couponMessage && <p className="text-xs text-ink-faint">{preview.couponMessage}</p>}
                      </div>
                      <button type="button" disabled={active} onClick={() => applyCode(cp.code)} className="shrink-0 text-sm font-semibold text-brand disabled:text-good">
                        {active ? "Applied" : "Apply"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {offers.length > 0 && (
              <ul className="mt-4 space-y-2">
                {offers.map((o) => {
                  const est = bankOfferEstimate(o, prepaid.subtotal, prepaid.total);
                  return (
                    <li key={o.id} className="flex items-start gap-3 rounded-lg bg-paper px-3.5 py-3">
                      <span className="mt-0.5 rounded border border-rule bg-white px-1.5 py-0.5 text-[11px] font-semibold">{o.bankName}</span>
                      <div className="text-xs">
                        <p className="font-medium text-ink">{o.title}</p>
                        <p className="text-ink-soft">{est > 0 ? `Up to ${formatINR(est)} off this order. ` : ""}Applied automatically on the payment page.</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Payment">
            <div className="space-y-3" role="radiogroup" aria-label="Payment method">
              {store.payuReady && (
                <PayOption selected={method === "prepaid"} onSelect={() => setMethod("prepaid")} title="Pay online" subtitle="UPI, cards, net banking, wallets"
                  badge={discountLabel(prepaid)} amount={prepaid.total} highlight
                  note={<>{codAvailable && prepaid.total < cod.total && <>{formatINR(cod.total - prepaid.total)} less than COD</>}{bestBank > 0 && <>{codAvailable && prepaid.total < cod.total ? ". " : ""}Bank offers can save up to {formatINR(bestBank)} more</>}</>} />
              )}
              {store.codEnabled && (
                <PayOption selected={method === "cod"} onSelect={() => codAvailable && setMethod("cod")} disabled={!codAvailable}
                  title="Cash on Delivery" subtitle={codBlocked ? codStatus?.message ?? "" : "Pay when your order arrives"}
                  badge={codAvailable ? discountLabel(cod) : null} amount={cod.total} />
              )}
            </div>
            {errors.form && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{errors.form}</p>}
          </Card>

          <Card title="Price details" className="lg:hidden"><PriceDetails p={p} method={method} coupon={coupon} hasOffers={offers.length > 0} /></Card>
          <Trust phone={store.supportPhone} className="lg:hidden" />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            <Card title={`Your order (${itemCount})`}>
              <CartItems lines={lines} rule={rule} method={method} />
              {upsell.length > 0 && <Upsell items={upsell} rule={rule} />}
              <div className="mt-4 border-t border-rule pt-4"><PriceDetails p={p} method={method} coupon={coupon} hasOffers={offers.length > 0} /></div>
              <button type="submit" className="btn-primary mt-5 w-full py-3.5 text-base" disabled={placing}>
                {placing ? <><Spinner /> {redirectingToPay ? "Opening secure payment" : "Placing your order"}</> : payLabel}
              </button>
              <Trust phone={store.supportPhone} className="mt-4" />
            </Card>
          </div>
        </aside>
      </Form>

      {/* Mobile pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-white px-4 pt-3 lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="num text-lg font-semibold leading-tight">{formatINR(p.total)}</p>
            {p.savings > 0 && <p className="text-xs font-medium text-good">{formatINR(p.savings)} saved</p>}
          </div>
          <button type="submit" form="checkout-form" className="btn-primary flex-1 py-3.5 text-base" disabled={placing}>
            {placing ? <><Spinner /> {redirectingToPay ? "Opening payment" : "Placing order"}</> : method === "prepaid" ? "Pay now" : "Place order"}
          </button>
        </div>
      </div>

      {redirectingToPay && <PaymentOverlay name={store.name} logo={store.logoUrl} />}
    </Shell>
  );
}

// ---------- pieces ----------

function Shell({ store, children }: { store: LoaderData["store"]; children: React.ReactNode }) {
  return (
    <div style={{ ["--brand" as string]: hexToRgb(store.primaryColor) }} className="min-h-screen bg-paper pb-28 lg:pb-12">
      <header className="sticky top-0 z-20 border-b border-rule bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href={store.storefrontUrl} className="flex min-w-0 items-center gap-2">
            {store.logoUrl ? <img src={store.logoUrl} alt={store.name} className="h-8 w-auto max-w-[150px] object-contain" /> : <span className="truncate text-lg font-semibold">{store.name}</span>}
          </a>
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-soft"><LockIcon /> Secure checkout</span>
        </div>
      </header>
      {children}
    </div>
  );
}

function Card({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-rule bg-white p-4 sm:p-5 ${className}`}>
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function CartItems({ lines, rule, method }: { lines: PricedLine[]; rule: StoreRule; method: PaymentMethod }) {
  return (
    <ul className="space-y-4">
      {lines.map((l) => <CartLine key={l.variantId} line={l} pct={linePct(l, rule, method)} />)}
    </ul>
  );
}

function CartLine({ line, pct }: { line: PricedLine; pct: number }) {
  const f = useFetcher();
  const busy = f.state !== "idle";
  const pending = f.formData?.get("quantity");
  const qty = pending != null ? Number(pending) : line.quantity;
  const setQty = (q: number) => f.submit({ intent: "cart", op: "set", variantId: line.variantId, quantity: String(q) }, { method: "post" });
  return (
    <li className={`flex gap-3 transition-opacity ${busy ? "opacity-60" : ""}`}>
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-rule bg-paper">
        {line.image && <img src={line.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium">{line.title}</p>
        {line.variantTitle && <p className="text-xs text-ink-faint">{line.variantTitle}</p>}
        <div className="mt-2 flex items-center gap-3">
          <div className="inline-flex items-center rounded-lg border border-rule-strong">
            <button type="button" className="h-8 w-8 text-lg leading-none text-ink-soft hover:text-ink disabled:opacity-40" onClick={() => setQty(qty - 1)} disabled={busy} aria-label={qty <= 1 ? `Remove ${line.title}` : "Decrease quantity"}>−</button>
            <span className="num w-8 text-center text-sm font-medium" aria-live="polite">{qty}</span>
            <button type="button" className="h-8 w-8 text-lg leading-none text-ink-soft hover:text-ink disabled:opacity-40" onClick={() => setQty(qty + 1)} disabled={busy || qty >= MAX_QTY} aria-label="Increase quantity">+</button>
          </div>
          <button type="button" className="text-xs text-ink-faint underline-offset-2 hover:text-bad hover:underline" onClick={() => setQty(0)} disabled={busy}>Remove</button>
        </div>
      </div>
      <div className="text-right">
        <p className="num text-sm font-semibold">{formatINR(line.pricePaise * line.quantity)}</p>
        {line.comparePaise && <s className="num text-xs text-ink-faint">{formatINR(line.comparePaise * line.quantity)}</s>}
        {pct > 0 && <p className="text-[11px] font-medium text-good">{pct}% off</p>}
      </div>
    </li>
  );
}

function Upsell({ items, rule }: { items: LoaderData["upsell"]; rule: StoreRule }) {
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <h3 className="mb-3 text-sm font-semibold">You may also like</h3>
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:scroll-px-5 sm:px-5">
        {items.map((u) => <UpsellCard key={u.productId} item={u} rule={rule} />)}
      </ul>
    </div>
  );
}

function UpsellCard({ item, rule }: { item: LoaderData["upsell"][number]; rule: StoreRule }) {
  const f = useFetcher();
  const [variantId, setVariantId] = useState(item.variants[0]?.id ?? "");
  const v = item.variants.find((x) => x.id === variantId) ?? item.variants[0];
  if (!v) return null;
  const pct = linePct({ variantId: v.id, productId: item.productId, title: "", variantTitle: null, image: null, quantity: 1, pricePaise: v.pricePaise, comparePaise: null }, rule, "prepaid");
  const online = Math.round(v.pricePaise * (1 - pct / 100));
  const busy = f.state !== "idle";
  return (
    <li className="w-[150px] shrink-0 snap-start">
      <div className="aspect-square overflow-hidden rounded-lg border border-rule bg-paper">
        {item.image && <img src={item.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs font-medium">{item.title}</p>
      {item.variants.length > 1 && (
        <select className="input mt-1 px-2 py-1 text-xs" value={variantId} onChange={(e) => setVariantId(e.target.value)} aria-label={`Option for ${item.title}`}>
          {item.variants.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
      )}
      <p className="mt-1 text-xs">
        <span className="num font-semibold">{formatINR(pct > 0 ? online : v.pricePaise)}</span>{" "}
        {pct > 0 ? <s className="num text-ink-faint">{formatINR(v.pricePaise)}</s> : v.comparePaise && <s className="num text-ink-faint">{formatINR(v.comparePaise)}</s>}
      </p>
      {pct > 0 && <p className="text-[11px] text-good">when you pay online</p>}
      <button type="button" className="btn-secondary mt-2 w-full py-1.5 text-xs" disabled={busy}
        onClick={() => f.submit({ intent: "cart", op: "add", variantId: v.id }, { method: "post" })}>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : "Add"}
      </button>
    </li>
  );
}

type P = ReturnType<typeof computePricing>;

function PriceDetails({ p, method, coupon, hasOffers }: { p: P; method: PaymentMethod; coupon: CouponRule | null; hasOffers: boolean }) {
  return (
    <dl className="space-y-2 text-sm">
      <Row label="Item total" value={formatINR(p.subtotal)} />
      {p.mrpTotal > p.subtotal && <Row label="You already save on MRP" value={formatINR(p.mrpTotal - p.subtotal)} muted />}
      {p.paymentDiscount > 0 && <Row label={`${method === "prepaid" ? "Online payment" : "COD"} discount${p.paymentDiscountPct ? ` (${p.paymentDiscountPct}%)` : ""}`} value={`−${formatINR(p.paymentDiscount)}`} green />}
      {p.couponApplied && coupon && <Row label={`Coupon ${coupon.code}`} value={`−${formatINR(p.couponDiscount)}`} green />}
      <Row label="Delivery" value="Free" green />
      <div className="flex items-baseline justify-between border-t border-rule pt-3">
        <dt className="font-semibold">To pay</dt>
        <dd className="text-right">
          {p.mrpTotal > p.total && <s className="num mr-2 text-xs text-ink-faint">{formatINR(p.mrpTotal)}</s>}
          <span className="num text-xl font-semibold">{formatINR(p.total)}</span>
        </dd>
      </div>
      {method === "prepaid" && hasOffers && <p className="text-xs text-ink-faint">Eligible bank offers are applied on the payment page.</p>}
    </dl>
  );
}

function Row({ label, value, green, muted }: { label: string; value: string; green?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={muted ? "text-ink-faint" : "text-ink-soft"}>{label}</dt>
      <dd className={`num ${green ? "font-medium text-good" : muted ? "text-ink-faint" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

function PayOption({ selected, onSelect, title, subtitle, badge, amount, note, highlight, disabled }: {
  selected: boolean; onSelect: () => void; title: string; subtitle: string; badge: string | null; amount: number; note?: React.ReactNode; highlight?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-disabled={disabled || undefined} onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition ${disabled ? "cursor-not-allowed border-rule bg-paper opacity-80" : selected ? "border-brand bg-brand/[0.04]" : "border-rule hover:border-rule-strong"}`}>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected && !disabled ? "border-brand" : "border-rule-strong"}`}>
        {selected && !disabled && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${highlight ? "bg-good text-white" : "bg-amber-100 text-amber-900"}`}>{badge}</span>}
        </span>
        <span className={`mt-0.5 block text-xs ${disabled ? "text-warn" : "text-ink-soft"}`}>{subtitle}</span>
        {note && <span className="mt-1 block text-xs font-medium text-good">{note}</span>}
      </span>
      {!disabled && <span className="num shrink-0 text-right text-base font-semibold">{formatINR(amount)}</span>}
    </button>
  );
}

function Field({ label, error, className = "", children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="error-text">{error}</span>}
    </label>
  );
}

function Trust({ phone, className = "" }: { phone: string | null; className?: string }) {
  return (
    <div className={`space-y-1 text-center text-xs text-ink-faint ${className}`}>
      <p className="flex items-center justify-center gap-1.5"><LockIcon /> Payments are encrypted and processed by PayU</p>
      {phone && <p>Need help? Call <a className="underline" href={`tel:${phone}`}>{phone}</a></p>}
    </div>
  );
}

function PaymentOverlay({ name, logo }: { name: string; logo: string | null }) {
  return (
    <div className="fixed inset-0 z-50 flex animate-fadein flex-col items-center justify-center bg-white/95 px-6 text-center" role="status" aria-live="polite">
      {logo ? <img src={logo} alt={name} className="mb-6 h-9 w-auto max-w-[160px] object-contain" /> : <p className="mb-6 text-lg font-semibold">{name}</p>}
      <div className="h-1 w-48 overflow-hidden rounded-full bg-paper-sunk"><div className="h-full w-1/2 animate-bar rounded-full bg-brand" /></div>
      <p className="mt-5 font-medium">Opening secure payment</p>
      <p className="mt-1 text-sm text-ink-soft">Don't close this page or press back.</p>
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

import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { COURIER_LOGOS } from "~/lib/courier-catalog";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation, type ShouldRevalidateFunction } from "@remix-run/react";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { useEffect, useMemo, useRef, useState } from "react";
import { MetaPixel } from "~/components/MetaPixel";
import { Spinner } from "~/components/ui";
import { BrandLoader, PoweredBy } from "~/components/Brand";
import { bankOffers, checkoutSessions, db, discountRules, orders, shippingRates, stores, type OrderCustomer } from "~/db.server";
import { guessStateFromPincode } from "~/lib/pincode";
import { quoteShipping, withShipping, type ShipRule } from "~/lib/shipping";
import { codBlockedMessage, codEligibility, normalizePhone, type CodStatus } from "~/lib/cod.server";
import { BLOCK_MESSAGE, blockFor, messaging, otpReady, otpRequired, otpVerified, sendOtp, verifyOtp, verifyWidgetOtp, widgetPublic } from "~/lib/rto.server";
import { codeLength, widgetRetry, widgetSend, widgetVerify, type WidgetConfig } from "~/components/msg91-widget";
import { shieldFor } from "~/lib/rto-shield.server";
import { SHIELD_MESSAGE } from "~/lib/rto-shield";
import { lookupAddresses, revealAddress } from "~/lib/addresses.server";
import type { MaskedAddress } from "~/lib/addresses";
import { findCoupon, listVisibleCoupons } from "~/lib/coupons.server";
import { freeGiftsFor, type FreeLine, type OfferHint } from "~/lib/offers.server";
import { clientIp, finalizeOrder, newOrderId } from "~/lib/orders.server";
import {
  bankOfferEstimate, computePricing, formatINR, lineOff, mixBlocksPayment, mixTitle,
  type BankOfferRule, type CouponRule, type PaymentMethod, type PricedLine, type StoreRule,
} from "~/lib/pricing";
import { fetchLines, fetchUpsellProducts } from "~/lib/shopify.server";
import { INDIAN_STATES, stateCodeFromName } from "~/lib/states";
import { FONTS, FONT_SCALE, SECTION_ORDERS, buttonText, resolveTheme, themeVars, type CheckoutTheme } from "~/lib/theme";
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
  const buyQty = Math.max(2, store.mixBuyQty);
  const deal = (on: boolean, qty: number, which: string, keep: boolean) => {
    if (!store.mixEnabled || !on) return null;
    const freeQty = Math.min(buyQty - 1, Math.max(1, qty));
    return { buyQty, freeQty, which: which === "high" ? "high" as const : "low" as const, keep, title: store.mixTitle?.trim() || mixTitle({ buyQty, freeQty }) };
  };
  const prepaidDeal = deal(store.mixPrepaidOn, store.mixFreeQty, store.mixFreeWhich, store.mixKeepPrepaid);
  const codDeal = deal(store.mixCodOn, store.mixCodFreeQty, store.mixCodFreeWhich, store.mixKeepCod);
  return {
    prepaidDiscountPct: store.prepaidDiscountPct,
    codDiscountPct: store.codDiscountPct,
    mix: prepaidDeal || codDeal ? { prepaid: prepaidDeal, cod: codDeal } : null,
    rules: rules.map((r) => ({ productIds: r.products.map((p) => p.id), type: r.type === "flat" ? "flat" as const : "percent" as const, prepaidPct: r.prepaidPct, codPct: r.codPct })),
  };
}

async function shippingRulesFor(storeId: number): Promise<ShipRule[]> {
  const rows = await db.select().from(shippingRates).where(and(eq(shippingRates.storeId, storeId), eq(shippingRates.active, true)));
  return rows.map((r) => ({
    id: r.id, name: r.name, pricePaise: r.pricePaise, minOrderRupees: r.minOrderRupees, maxOrderRupees: r.maxOrderRupees,
    states: r.states, pincodePrefixes: r.pincodePrefixes, paymentMethod: r.paymentMethod,
  }));
}

/** Small background requests (draft save, COD check, coupon) don't need to reload the cart. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ formData, defaultShouldRevalidate }) => {
  const intent = formData?.get("intent");
  if (intent === "draft" || intent === "eligibility" || intent === "coupon" || intent === "otp_send" || intent === "otp_verify" || intent === "otp_widget" || intent === "addr_lookup" || intent === "addr_reveal") return false;
  return defaultShouldRevalidate;
};

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
  const [shipping, gifts, otpPrepaid, otpCod] = await Promise.all([shippingRulesFor(store.id), freeGiftsFor(store, lines), otpRequired(store, "prepaid"), otpRequired(store, "cod")]);
  // Snapshot for abandoned-checkout reports
  await db.update(checkoutSessions).set({
    cartSnapshot: lines.map((l) => ({ title: l.title, variantTitle: l.variantTitle, image: l.image, quantity: l.quantity, pricePaise: l.pricePaise })),
    cartValue: lines.reduce((n, l) => n + l.pricePaise * l.quantity, 0),
    updatedAt: new Date(),
  }).where(eq(checkoutSessions.id, session.id));

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
    theme: resolveTheme(store.theme),
    otp: { prepaid: otpPrepaid, cod: otpCod },
    otpWidget: widgetPublic(await messaging()),
    rule,
    shipping,
    gifts,
    draft: session.customer ?? null,
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

  if (intent === "draft") {
    const keep = (k: keyof OrderCustomer, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
    const draft: Partial<OrderCustomer> = {
      phone: normalizePhone(keep("phone", 20)), firstName: keep("firstName"), lastName: keep("lastName"), email: keep("email"),
      pincode: keep("pincode", 6), city: keep("city"), state: keep("state", 4), address1: keep("address1", 300), address2: keep("address2", 300),
    };
    await db.update(checkoutSessions).set({ customer: draft, updatedAt: new Date() }).where(eq(checkoutSessions.id, session.id));
    return json({ saved: true });
  }

  if (intent === "eligibility") {
    const g = (k: string) => String(fd.get(k) ?? "");
    const [cod, block, shield] = await Promise.all([
      codEligibility(store, g("phone")),
      blockFor(store, { phone: g("phone"), email: g("email"), pincode: g("pincode"), city: g("city"), state: g("state"), country: "IN" }),
      shieldFor(store, normalizePhone(g("phone"))),
    ]);
    const scope = block?.scope === "all" || shield?.scope === "all" ? "all" : block || shield ? "cod" : null;
    const codOk = cod.allowed && !scope;
    return json({
      cod: { ...cod, allowed: codOk }, block: scope,
      message: block ? BLOCK_MESSAGE[block.scope] : shield ? SHIELD_MESSAGE[shield.scope] : cod.allowed ? null : codBlockedMessage(cod),
    });
  }

  // Saved addresses (shared across stores): masked until the phone is verified with an OTP
  if (intent === "addr_lookup") {
    const phone = normalizePhone(String(fd.get("phone") ?? ""));
    if (!/^[6-9]\d{9}$/.test(phone) || session.addrLookups >= 12 || !otpReady(await messaging())) return json({ addresses: [] as MaskedAddress[] });
    await db.update(checkoutSessions).set({ addrLookups: sql`${checkoutSessions.addrLookups} + 1` }).where(eq(checkoutSessions.id, session.id));
    return json({ addresses: await lookupAddresses(phone) });
  }
  if (intent === "addr_reveal") {
    const phone = normalizePhone(String(fd.get("phone") ?? ""));
    if (!(await otpVerified(session.id, phone))) return json({ address: null, error: "Verify your mobile number first" });
    const a = await revealAddress(Number(fd.get("id")), phone);
    return json({ address: a ? { firstName: a.firstName, lastName: a.lastName, email: a.email, address1: a.address1, address2: a.address2, city: a.city, state: a.state, pincode: a.pincode } : null, error: a ? null : "Address not found" });
  }

  if (intent === "otp_send") {
    const r = await sendOtp(store, session.id, normalizePhone(String(fd.get("phone") ?? "")));
    return json({ otp: "sent" as const, ...r });
  }
  if (intent === "otp_widget") {
    const r = await verifyWidgetOtp(store, session.id, normalizePhone(String(fd.get("phone") ?? "")), String(fd.get("token") ?? ""));
    return json({ otp: "verify" as const, ...r });
  }
  if (intent === "otp_verify") {
    const r = await verifyOtp(session.id, normalizePhone(String(fd.get("phone") ?? "")), String(fd.get("code") ?? ""));
    return json({ otp: "verify" as const, ...r });
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

  // A saved address is used only after the customer verifies the phone (OTP at the end)
  const savedId = Number(str("savedAddressId")) || 0;
  if (savedId) {
    if (!(await otpVerified(session.id, customer.phone))) {
      return json({ errors: { form: "Verify your mobile number with the OTP to use your saved address." } as FieldErrors, needOtp: true }, { status: 400 });
    }
    const a = await revealAddress(savedId, customer.phone);
    if (!a) return json({ errors: { form: "That saved address isn't available. Enter your address." } as FieldErrors }, { status: 400 });
    Object.assign(customer, { firstName: a.firstName, lastName: a.lastName, email: customer.email || a.email, address1: a.address1, address2: a.address2, city: a.city, state: a.state, pincode: a.pincode });
  }

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
  if (!Object.keys(errors).length) {
    const block = await blockFor(store, { phone: customer.phone, email: customer.email, pincode: customer.pincode, city: customer.city, state: customer.state, country: "IN" });
    if (block && (block.scope === "all" || method === "cod")) errors.form = BLOCK_MESSAGE[block.scope];
  }
  if (!Object.keys(errors).length) {
    const shield = await shieldFor(store, customer.phone);
    if (shield && (shield.scope === "all" || method === "cod")) errors.form = SHIELD_MESSAGE[shield.scope];
  }
  if (Object.keys(errors).length) return json({ errors }, { status: 400 });
  if ((await otpRequired(store, method)) && !(await otpVerified(session.id, customer.phone))) {
    return json({ errors: { form: "Verify your mobile number with the OTP to continue." } as FieldErrors, needOtp: true }, { status: 400 });
  }

  const [lines, rule, shipRules] = await Promise.all([fetchLines(store, session.items), storeRuleFor(store), shippingRulesFor(store.id)]);
  if (!lines.length) return json({ errors: { form: "Your cart is empty. Go back to the store to add items." } as FieldErrors }, { status: 400 });
  const freeLines = (await freeGiftsFor(store, lines))[method];

  let coupon: CouponRule | null = null;
  const code = str("couponCode");
  if (code) {
    const r = await findCoupon(store.id, code);
    if ("error" in r) return json({ errors: { form: `Coupon ${code.toUpperCase()}: ${r.error}` } as FieldErrors }, { status: 400 });
    coupon = r.coupon;
  }
  const base = computePricing(lines, rule, method, coupon);
  const p = withShipping(base, quoteShipping(shipRules, { state: customer.state, pincode: customer.pincode, method, value: base.total }));

  const [order] = await db
    .insert(orders)
    .values({
      id: newOrderId(), storeId: store.id, sessionId: session.id,
      status: method === "cod" ? "cod_placing" : "pending_payment", paymentMethod: method,
      customer, items: [...lines, ...freeLines], subtotal: p.subtotal, paymentDiscount: p.paymentDiscount,
      couponCode: p.couponApplied ? coupon!.code : null, couponDiscount: p.couponDiscount, offerDiscount: p.mixDiscount,
      shipping: p.shipping, shippingTitle: p.shippingName, total: p.total,
      saveAddress: savedId > 0 || fd.get("saveAddress") === "on",
      tracking: {
        ...(session.tracking ?? {}),
        ip: clientIp(request) ?? session.tracking?.ip,
        ua: request.headers.get("user-agent")?.slice(0, 500) ?? session.tracking?.ua,
      },
    })
    .returning();

  await db.update(checkoutSessions).set({ customer, paymentAttempted: true, updatedAt: new Date() }).where(eq(checkoutSessions.id, session.id));
  if (method === "cod") {
    await finalizeOrder(store, order, { status: "cod_placed" });
    return redirect(`/order/${order.id}`);
  }
  return redirect(`/pay/${order.id}`);
}

// ======================= UI =======================

const EMPTY: OrderCustomer = { firstName: "", lastName: "", phone: "", email: "", address1: "", address2: "", city: "", state: "", pincode: "" };
const LS_KEY = "cx_customer_v1";

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Checkout() {
  const { store, theme, otp, otpWidget, rule, shipping, gifts, draft, lines, coupons, upsell, bankOffers: offers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const couponFetcher = useFetcher<typeof action>();
  const codFetcher = useFetcher<{ cod: CodStatus; block: "cod" | "all" | null; message: string | null }>();

  const [c, setC] = useState<OrderCustomer>(EMPTY);
  const [method, setMethod] = useState<PaymentMethod>(store.payuReady ? "prepaid" : "cod");
  const [coupon, setCoupon] = useState<CouponRule | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setC({ ...EMPTY, ...JSON.parse(saved) });
      else if (draft) setC({ ...EMPTY, ...draft } as OrderCustomer);
    } catch { if (draft) setC({ ...EMPTY, ...draft } as OrderCustomer); }
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
    if (!phoneOk) return;
    const t = setTimeout(() => codFetcher.submit({ intent: "eligibility", phone: c.phone, email: c.email, pincode: c.pincode, city: c.city, state: c.state }, { method: "post" }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.phone, phoneOk, c.pincode, c.city, c.state, c.email]);
  const codStatus = phoneOk ? codFetcher.data : undefined;
  const codBlocked = Boolean(codStatus && !codStatus.cod.allowed);
  const orderBlocked = codStatus?.block === "all";
  const codAvailable = store.codEnabled && !codBlocked;
  useEffect(() => { if (codBlocked && method === "cod" && store.payuReady) setMethod("prepaid"); }, [codBlocked, method, store.payuReady]);

  // Saved addresses from any Growpefy store, shown masked; full address only after OTP
  const addrFetcher = useFetcher<{ addresses: MaskedAddress[] }>();
  const revealFetcher = useFetcher<{ address: Partial<OrderCustomer> | null; error: string | null }>();
  const [saved, setSaved] = useState<MaskedAddress[]>([]);
  const [addrMode, setAddrMode] = useState<"manual" | "saved">("manual");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const choseManual = useRef(false);
  const lookedUp = useRef<string | null>(null);
  useEffect(() => {
    if (!phoneOk) { setSaved([]); setAddrMode("manual"); setSavedId(null); lookedUp.current = null; choseManual.current = false; return; }
    if (lookedUp.current === c.phone) return;
    if (lookedUp.current) { setSaved([]); setAddrMode("manual"); setSavedId(null); choseManual.current = false; }
    const t = setTimeout(() => { lookedUp.current = c.phone; addrFetcher.submit({ intent: "addr_lookup", phone: c.phone }, { method: "post" }); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.phone, phoneOk]);
  const pickSaved = (a: MaskedAddress) => {
    setSavedId(a.id); setAddrMode("saved"); setShowAll(false);
    setC((prev) => ({ ...prev, city: a.city, state: a.state, pincode: a.pincode }));
  };
  useEffect(() => {
    const list = addrFetcher.data?.addresses ?? [];
    setSaved(list);
    if (!list.length) { setAddrMode("manual"); setSavedId(null); return; }
    if (!choseManual.current && !c.address1.trim()) pickSaved(list[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrFetcher.data]);
  useEffect(() => {
    const a = revealFetcher.data?.address;
    if (!a) return;
    choseManual.current = true;
    setC((prev) => ({ ...prev, ...a, email: prev.email || a.email || "" } as OrderCustomer));
    setAddrMode("manual"); setSavedId(null);
  }, [revealFetcher.data]);
  const addNew = () => {
    choseManual.current = true; setAddrMode("manual"); setSavedId(null);
    setC((prev) => ({ ...EMPTY, phone: prev.phone, email: prev.email }));
  };
  const [saveAddr, setSaveAddr] = useState(true);

  // Save what the customer has typed (for abandoned checkout recovery)
  const draftFetcher = useFetcher();
  useEffect(() => {
    if (!phoneOk) return;
    const t = setTimeout(() => draftFetcher.submit({ intent: "draft", ...c }, { method: "post" }), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, phoneOk]);

  // Pincode: state appears instantly from the prefix, city follows from the lookup
  const auto = useRef<{ city: string; state: string }>({ city: "", state: "" });
  const [pinStatus, setPinStatus] = useState<"idle" | "loading" | "ok" | "unknown">("idle");
  useEffect(() => {
    if (!/^\d{6}$/.test(c.pincode)) { setPinStatus("idle"); return; }
    const fill = (city: string | null, state: string | null) =>
      setC((prev) => {
        const next = { ...prev };
        if (state && (!prev.state || prev.state === auto.current.state)) { next.state = state; auto.current.state = state; }
        if (city && (!prev.city || prev.city === auto.current.city)) { next.city = city; auto.current.city = city; }
        return next;
      });
    fill(null, guessStateFromPincode(c.pincode));
    setPinStatus("loading");
    const ctrl = new AbortController();
    fetch(`/api/pincode/${c.pincode}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: { city: string | null; state: string | null }) => { fill(d.city, d.state); setPinStatus(d.city ? "ok" : "unknown"); })
      .catch(() => setPinStatus("unknown"));
    return () => ctrl.abort();
  }, [c.pincode]);

  const priced = (m: PaymentMethod) => {
    const base = computePricing(lines, rule, m, coupon);
    return withShipping(base, quoteShipping(shipping, { state: c.state, pincode: c.pincode, method: m, value: base.total }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prepaid = useMemo(() => priced("prepaid"), [lines, rule, coupon, shipping, c.state, c.pincode]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cod = useMemo(() => priced("cod"), [lines, rule, coupon, shipping, c.state, c.pincode]);
  const p = method === "prepaid" ? prepaid : cod;
  const bestBank = useMemo(() => Math.max(0, ...offers.map((o) => bankOfferEstimate(o, prepaid.subtotal, prepaid.total))), [offers, prepaid]);

  const errors = (actionData && "errors" in actionData ? actionData.errors : {}) as FieldErrors;

  // OTP before the order (RTO Suite)
  const formRef = useRef<HTMLFormElement>(null);
  const verifiedPhone = useRef<string | null>(null);
  const [otpOpen, setOtpOpen] = useState(false);
  const otpFor = useRef<"order" | { reveal: number }>("order");
  const usingSaved = addrMode === "saved" && savedId != null && saved.some((a) => a.id === savedId);
  const needsOtp = ((method === "prepaid" ? otp.prepaid : otp.cod) || usingSaved) && verifiedPhone.current !== c.phone;
  useEffect(() => { if (actionData && "needOtp" in actionData && actionData.needOtp) { otpFor.current = "order"; setOtpOpen(true); } }, [actionData]);
  const editSaved = (id: number) => {
    if (verifiedPhone.current === c.phone) { revealFetcher.submit({ intent: "addr_reveal", id: String(id), phone: c.phone }, { method: "post" }); return; }
    otpFor.current = { reveal: id }; setOtpOpen(true);
  };
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (orderBlocked) { e.preventDefault(); return; }
    if (needsOtp && /^[6-9]\d{9}$/.test(c.phone) && formRef.current?.checkValidity()) { e.preventDefault(); otpFor.current = "order"; setOtpOpen(true); }
  };
  const placing = nav.state !== "idle" && nav.formData?.get("intent") === "place";
  const redirectingToPay = placing && nav.formData?.get("method") === "prepaid";
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const freeLines = (method === "prepaid" ? gifts.prepaid : gifts.cod) as FreeLine[];
  const giftWorth = freeLines.reduce((n, l) => n + (l.comparePaise ?? 0) * l.quantity, 0);
  const freeCount = freeLines.reduce((n, l) => n + l.quantity, 0);
  const otherFree = (method === "prepaid" ? gifts.cod : gifts.prepaid) as FreeLine[];
  const giftTitle = `Your order (${itemCount}${freeCount ? ` + ${freeCount} free` : ""})`;
  const set = (k: keyof OrderCustomer) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setC((prev) => ({ ...prev, [k]: k === "phone" ? e.target.value.replace(/\D/g, "").slice(-10) : k === "pincode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value }));
  const applyCode = (code: string) => { setCouponError(null); couponFetcher.submit({ intent: "coupon", code }, { method: "post" }); };
  const discountLabel = (r: typeof prepaid) => (r.paymentDiscountPct ? `${r.paymentDiscountPct}% off` : r.paymentDiscount > 0 ? `Save ${formatINR(r.paymentDiscount)}` : null);
  const payLabel = buttonText(method === "prepaid" ? theme.prepaidButtonText : theme.codButtonText, formatINR(p.total));
  const showUpsell = upsell.length > 0 && theme.upsellPlacement !== "hidden";
  const upsellInCart = showUpsell && theme.upsellPlacement === "cart";
  const upsellCard = showUpsell && !upsellInCart ? <Card title={theme.upsellTitle}><Upsell items={upsell} rule={rule} bare /></Card> : null;

  if (lines.length === 0) {
    return (
      <Shell store={store} theme={theme}>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <p className="text-xl font-semibold">Your cart is empty</p>
          <p className="mt-2 text-ink-soft">Add something you like and check out again.</p>
          <a href={store.storefrontUrl} className="btn-primary mt-6">Continue shopping</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell store={store} theme={theme}>
      {store.pixelId && (
        <MetaPixel pixelId={store.pixelId} event="InitiateCheckout"
          data={{ currency: "INR", value: p.total / 100, num_items: itemCount, content_ids: lines.map((l) => l.variantId), content_type: "product" }}
          onceKey={`ic_${lines.map((l) => l.variantId + "x" + l.quantity).join("_")}`} />
      )}

      {theme.showSavingsBar && p.savings > 0 && (
        <div className="bg-brand px-4 py-2 text-center text-sm font-medium text-white">
          You're saving {formatINR(p.savings)} on this order{method === "cod" && prepaid.total < cod.total ? `. Pay online to save ${formatINR(cod.total - prepaid.total)} more.` : ""}
        </div>
      )}

      <Form method="post" id="checkout-form" ref={formRef} onSubmit={onSubmit} className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-8 lg:py-8">
        <input type="hidden" name="intent" value="place" />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="couponCode" value={coupon?.code ?? ""} />
        {usingSaved && <input type="hidden" name="savedAddressId" value={savedId!} />}

        <div className="space-y-4">
          {/* Mobile: order first so customers can edit it */}
          <Card title={giftTitle} className="lg:hidden">
            <MixBanner rule={rule} itemCount={itemCount} saved={p.mixDiscount} method={method} />
            <CartItems lines={lines} rule={rule} method={method} free={p.mixFree} />
            <FreeGifts lines={freeLines} hints={gifts.hints} otherMethod={method === "prepaid" ? null : otherFree.length > freeLines.length ? "online" : null} />
            {upsellInCart && <Upsell items={upsell} rule={rule} title={theme.upsellTitle} />}
          </Card>

          {SECTION_ORDERS.find((o) => o.id === theme.sectionOrder)!.order.map((key) => key === "address" ? (
          <Card key={key} title="Delivery details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mobile number" error={errors.phone} className="col-span-2">
                <div className="flex">
                  <span className="flex items-center rounded-l-lg border border-r-0 border-rule-strong bg-paper px-3 text-[15px] text-ink-soft">+91</span>
                  <input name="phone" inputMode="numeric" autoComplete="tel-national" maxLength={10} required className="input rounded-l-none"
                    placeholder="10-digit mobile number" value={c.phone} onChange={set("phone")} aria-invalid={Boolean(errors.phone) || undefined} />
                </div>
              </Field>
              {usingSaved ? (
                <>
                  {theme.showEmail && <Field label="Email (optional, for order updates)" error={errors.email} className="col-span-2"><input name="email" type="email" autoComplete="email" className="input" value={c.email} onChange={set("email")} /></Field>}
                  <SavedAddresses className="col-span-2" list={saved} selected={savedId!} showAll={showAll} setShowAll={setShowAll}
                    onPick={pickSaved} onEdit={editSaved} onAddNew={addNew} revealing={revealFetcher.state !== "idle"} />
                </>
              ) : (
                <>
              <Field label="First name" error={errors.firstName}><input name="firstName" autoComplete="given-name" required className="input" value={c.firstName} onChange={set("firstName")} /></Field>
              <Field label="Last name"><input name="lastName" autoComplete="family-name" className="input" value={c.lastName} onChange={set("lastName")} /></Field>
              {theme.showEmail && <Field label="Email (optional, for order updates)" error={errors.email} className="col-span-2"><input name="email" type="email" autoComplete="email" className="input" value={c.email} onChange={set("email")} /></Field>}
              <Field label="Pincode" error={errors.pincode}>
                <div className="relative">
                  <input name="pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} required className="input pr-9" value={c.pincode} onChange={set("pincode")} />
                  {pinStatus === "loading" && <span className="absolute right-3 top-3 text-ink-faint"><Spinner /></span>}
                  {pinStatus === "ok" && <span className="absolute right-3 top-2.5 text-good" aria-label="Pincode found">✓</span>}
                </div>
              </Field>
              <Field label="City" error={errors.city}><input name="city" autoComplete="address-level2" required className="input" value={c.city} onChange={set("city")} /></Field>
              <Field label="House number, building, street" error={errors.address1} className="col-span-2"><input name="address1" autoComplete="address-line1" required className="input" value={c.address1} onChange={set("address1")} /></Field>
              <Field label="Area, landmark (optional)" className="col-span-2"><input name="address2" autoComplete="address-line2" className="input" value={c.address2} onChange={set("address2")} /></Field>
              <Field label="State" error={errors.state} className="col-span-2">
                <select name="state" required className="input" value={c.state} onChange={set("state")}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </Field>
              {saved.length > 0 && (
                <button type="button" className="col-span-2 -mt-1 text-left text-sm font-medium text-brand" onClick={() => pickSaved(saved[0])}>← Use a saved address ({saved.length})</button>
              )}
              <label className="col-span-2 flex cursor-pointer items-start gap-2.5 text-xs text-ink-soft">
                <input type="checkbox" name="saveAddress" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                <span>Save this address for faster checkout next time. You'll see it masked and confirm with an OTP on stores that use this checkout.</span>
              </label>
                </>
              )}
            </div>
          </Card>
          ) : key === "offers" ? (
          <Card key={key} title="Offers">
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
                      <span className="mt-0.5 rounded border border-rule bg-surface px-1.5 py-0.5 text-[11px] font-semibold">{o.bankName}</span>
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
          ) : (
          <div key={key} className="space-y-4">
          {theme.upsellPlacement === "before_payment" && upsellCard}
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
            {orderBlocked && codStatus?.message && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{codStatus.message}</p>}
            {errors.form && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{errors.form}</p>}
            {((method === "prepaid" ? otp.prepaid : otp.cod) || usingSaved) && <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint"><LockIcon />We'll send a one-time code to your mobile to confirm the order.</p>}
          </Card>
          {theme.upsellPlacement === "after_payment" && upsellCard}
          </div>
          ))}

          <Card title="Price details" className="lg:hidden"><PriceDetails p={p} method={method} coupon={coupon} hasOffers={offers.length > 0} giftWorth={giftWorth} /></Card>
          <Trust phone={store.supportPhone} text={theme.showTrust ? theme.trustText : null} className="lg:hidden" />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            <Card title={giftTitle}>
              <MixBanner rule={rule} itemCount={itemCount} saved={p.mixDiscount} method={method} />
              <CartItems lines={lines} rule={rule} method={method} free={p.mixFree} />
              <FreeGifts lines={freeLines} hints={gifts.hints} otherMethod={method === "prepaid" ? null : otherFree.length > freeLines.length ? "online" : null} />
              {upsellInCart && <Upsell items={upsell} rule={rule} title={theme.upsellTitle} />}
              <div className="mt-4 border-t border-rule pt-4"><PriceDetails p={p} method={method} coupon={coupon} hasOffers={offers.length > 0} giftWorth={giftWorth} /></div>
              <button type="submit" className="btn-primary mt-5 w-full py-3.5 text-base" disabled={placing}>
                {placing ? <><Spinner /> {redirectingToPay ? "Opening secure payment" : "Placing your order"}</> : payLabel}
              </button>
              <Trust phone={store.supportPhone} text={theme.showTrust ? theme.trustText : null} className="mt-4" />
            </Card>
          </div>
        </aside>
      </Form>

      {/* Mobile pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface px-4 pt-3 lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="num text-lg font-semibold leading-tight">{formatINR(p.total)}</p>
            {p.savings > 0 && <p className="text-xs font-medium text-good">{formatINR(p.savings)} saved</p>}
          </div>
          <button type="submit" form="checkout-form" className="btn-primary flex-1 py-3.5 text-base" disabled={placing}>
            {placing ? <><Spinner /> {redirectingToPay ? "Opening payment" : "Placing order"}</> : buttonText(method === "prepaid" ? theme.prepaidButtonText : theme.codButtonText, "").replace(/[\s,·-]+$/, "").trim() || (method === "prepaid" ? "Pay now" : "Place order")}
          </button>
        </div>
      </div>

      {redirectingToPay && <PaymentOverlay name={store.name} logo={store.logoUrl} />}
      {otpOpen && (
        <OtpDialog phone={c.phone} widget={otpWidget} onClose={() => setOtpOpen(false)}
          onVerified={() => {
            verifiedPhone.current = c.phone; setOtpOpen(false);
            const f = otpFor.current;
            if (f !== "order") revealFetcher.submit({ intent: "addr_reveal", id: String(f.reveal), phone: c.phone }, { method: "post" });
            else setTimeout(() => formRef.current?.requestSubmit(), 0);
          }} />
      )}
    </Shell>
  );
}

// ---------- pieces ----------

function Shell({ store, theme, children }: { store: LoaderData["store"]; theme: CheckoutTheme; children: React.ReactNode }) {
  const font = FONTS[theme.font];
  return (
    <div style={themeVars(theme, store.primaryColor) as React.CSSProperties} className="cx min-h-screen bg-paper pb-28 text-ink lg:pb-12">
      {font.google && <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${font.google}&display=swap`} />}
      <style>{`html{font-size:${FONT_SCALE[theme.fontScale]}px;background:${theme.bgColor}}`}</style>
      {theme.announcement && (
        <div className="px-4 py-2 text-center text-[13px] font-medium" style={{ background: theme.announcementBg, color: theme.announcementText }}>{theme.announcement}</div>
      )}
      <header className="sticky top-0 z-20 border-b border-rule backdrop-blur" style={{ background: theme.headerBg, color: theme.headerText }}>
        <div className={`mx-auto flex max-w-6xl items-center px-4 py-3 ${theme.logoAlign === "center" ? "relative justify-center" : "justify-between"}`}>
          <a href={store.storefrontUrl} className="flex min-w-0 items-center gap-2">
            {store.logoUrl
              ? <img src={store.logoUrl} alt={store.name} style={{ height: theme.logoHeight }} className="w-auto max-w-[200px] object-contain" />
              : <span className="truncate font-semibold" style={{ fontSize: Math.max(16, theme.logoHeight * 0.55) }}>{store.name}</span>}
          </a>
          <span className={`flex items-center gap-1.5 text-xs font-medium opacity-75 ${theme.logoAlign === "center" ? "absolute right-4 hidden sm:flex" : ""}`}><LockIcon /> Secure checkout</span>
        </div>
      </header>
      {children}
    </div>
  );
}

function Card({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-xl border border-rule bg-surface p-4 sm:p-5 ${className}`}>
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function FreeGifts({ lines, hints, otherMethod }: { lines: FreeLine[]; hints: OfferHint[]; otherMethod: string | null }) {
  if (!lines.length && !hints.length && !otherMethod) return null;
  return (
    <div className="mt-4 space-y-3">
      {lines.length > 0 && (
        <ul className="space-y-3 rounded-xl border border-dashed border-good/50 bg-good/10 p-3">
          {lines.map((l) => (
            <li key={`free-${l.variantId}`} className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-good/30 bg-surface">
                {l.image && <img src={l.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                <span className="absolute -left-1 -top-1 rounded-md bg-emerald-600 px-1 text-[10px] font-bold text-white" aria-hidden>🎁</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-ink">{l.title}</p>
                <p className="text-xs font-medium text-good">{l.variantTitle ? `${l.variantTitle} · ` : ""}{l.offer}{l.quantity > 1 ? ` · ×${l.quantity}` : ""}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-good">FREE</p>
                {l.comparePaise ? <s className="num text-xs text-ink-faint">{formatINR(l.comparePaise * l.quantity)}</s> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {otherMethod && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">🎁 Pay {otherMethod} to get free gifts with this order.</p>}
      {hints.map((h) => (
        <p key={h.offer} className="rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
          🎁 Add <b className="text-ink">{h.need} more</b> item{h.need === 1 ? "" : "s"} to get <b className="text-ink">{h.gifts}</b> free
        </p>
      ))}
    </div>
  );
}

function CartItems({ lines, rule, method, free = [] }: { lines: PricedLine[]; rule: StoreRule; method: PaymentMethod; free?: number[] }) {
  return (
    <ul className="space-y-4">
      {lines.map((l, i) => <CartLine key={l.variantId} line={l} off={lineOff(l, rule, method).label} freeUnits={free[i] ?? 0} />)}
    </ul>
  );
}

/** Mix & Match progress: "Add 1 more item to get 2 FREE" → "2 items are FREE". Deals can differ by payment method. */
function MixBanner({ rule, itemCount, saved, method }: { rule: StoreRule; itemCount: number; saved: number; method: PaymentMethod }) {
  const here = rule.mix?.[method] ?? null;
  const other = rule.mix?.[method === "prepaid" ? "cod" : "prepaid"] ?? null;
  const otherName = method === "prepaid" ? "Cash on Delivery" : "online";
  const m = here ?? other;
  if (!m) return null;

  // Deal only on the other payment method
  if (!here) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-3 text-amber-900">
        <span className="text-lg leading-none" aria-hidden>🛍️</span>
        <p className="text-sm"><b>{m.title}</b> is available when you pay {otherName === "online" ? "online" : "with Cash on Delivery"}. Add any {m.buyQty} items and get {m.freeQty} FREE.</p>
      </div>
    );
  }

  const need = Math.max(0, m.buyQty - itemCount);
  const pct = Math.min(100, Math.round((itemCount / m.buyQty) * 100));
  const which = m.which === "low" ? "lowest-priced" : "highest-priced";
  const better = other && other.freeQty > here.freeQty ? other : null;
  return (
    <div className={`mb-4 overflow-hidden rounded-xl border ${need ? "border-brand/30 bg-brand/[0.06]" : "border-good/40 bg-good/10"}`}>
      <div className="flex items-start gap-3 px-3.5 pt-3">
        <span className="mt-0.5 text-lg leading-none" aria-hidden>{need ? "🛍️" : "🎉"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand">{m.title}</p>
          {need ? (
            <p className="text-sm font-medium text-ink">Add <b>{need} more item{need === 1 ? "" : "s"}</b> and get <b>{m.freeQty} item{m.freeQty === 1 ? "" : "s"} FREE</b></p>
          ) : (
            <p className="text-sm font-medium text-ink">Unlocked! Your {m.freeQty} {which} item{m.freeQty === 1 ? " is" : "s are"} <b className="text-good">FREE</b>{saved > 0 && <> · you save <b className="num text-good">{formatINR(saved)}</b></>}</p>
          )}
          <p className="mt-0.5 text-xs text-ink-faint">Mix any {m.buyQty} items. The {m.freeQty} {which} {m.freeQty === 1 ? "one is" : "ones are"} free.</p>
          {better && <p className="mt-1 text-xs font-semibold text-brand">Pay {otherName === "online" ? "online" : "with Cash on Delivery"} and get {better.freeQty} items FREE instead.</p>}
          {!need && mixBlocksPayment(m) && <p className="mt-1 text-xs font-medium text-amber-700">The {method === "prepaid" ? "online payment" : "COD"} discount doesn't apply with this deal.</p>}
          {need > 0 && here.keep === false && <p className="mt-1 text-xs text-ink-faint">The {method === "prepaid" ? "online payment" : "COD"} discount is replaced by this deal once it applies.</p>}
        </div>
      </div>
      <div className="mx-3.5 mb-3 mt-2.5 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-rule" role="progressbar" aria-valuemin={0} aria-valuemax={m.buyQty} aria-valuenow={Math.min(itemCount, m.buyQty)} aria-label="Items towards the deal">
          <div className={`h-full rounded-full transition-all ${need ? "bg-brand" : "bg-good"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="num text-xs font-semibold text-ink-soft">{Math.min(itemCount, m.buyQty)}/{m.buyQty}</span>
      </div>
    </div>
  );
}

function CartLine({ line, off, freeUnits = 0 }: { line: PricedLine; off: string | null; freeUnits?: number }) {
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
        {freeUnits > 0
          ? <p className="ml-auto mt-0.5 block w-fit rounded bg-good px-1.5 py-px text-[10px] font-bold text-white">{freeUnits === line.quantity ? "FREE" : `${freeUnits} FREE`}</p>
          : off && <p className="text-[11px] font-medium text-good">{off}</p>}
      </div>
    </li>
  );
}

function Upsell({ items, rule, title, bare }: { items: LoaderData["upsell"]; rule: StoreRule; title?: string; bare?: boolean }) {
  return (
    <div className={bare ? "" : "mt-5 border-t border-rule pt-4"}>
      {!bare && <h3 className="mb-3 text-sm font-semibold">{title}</h3>}
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
  const pct = lineOff({ productId: item.productId, pricePaise: v.pricePaise }, rule, "prepaid").unit;
  const online = v.pricePaise - pct;
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

type P = ReturnType<typeof computePricing> & { itemsTotal: number; shipping: number; shippingName: string; freeAbove: number | null };

function PriceDetails({ p, method, coupon, hasOffers, giftWorth = 0 }: { p: P; method: PaymentMethod; coupon: CouponRule | null; hasOffers: boolean; giftWorth?: number }) {
  return (
    <dl className="space-y-2 text-sm">
      <Row label="Item total" value={formatINR(p.subtotal)} />
      {p.mixDiscount > 0 && <Row label="Mix & Match free items" value={`−${formatINR(p.mixDiscount)}`} green />}
      {giftWorth > 0 && <Row label={`Free gifts (worth ${formatINR(giftWorth)})`} value="FREE" green />}
      {p.mrpTotal > p.subtotal && <Row label="You already save on MRP" value={formatINR(p.mrpTotal - p.subtotal)} muted />}
      {p.paymentDiscount > 0 && <Row label={`${method === "prepaid" ? "Online payment" : "COD"} discount${p.paymentDiscountPct ? ` (${p.paymentDiscountPct}%)` : ""}`} value={`−${formatINR(p.paymentDiscount)}`} green />}
      {p.couponApplied && coupon && <Row label={`Coupon ${coupon.code}`} value={`−${formatINR(p.couponDiscount)}`} green />}
      <Row label={p.shipping > 0 ? p.shippingName : "Delivery"} value={p.shipping > 0 ? formatINR(p.shipping) : "Free"} green={p.shipping === 0} />
      {p.shipping > 0 && p.freeAbove && <p className="text-xs font-medium text-good">Free delivery on orders above {formatINR(p.freeAbove)}</p>}
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

function Trust({ phone, text, className = "" }: { phone: string | null; text: string | null; className?: string }) {
  return (
    <div className={`space-y-1 text-center text-xs text-ink-faint ${className}`}>
      <CourierStrip />
      {text && <p className="flex items-center justify-center gap-1.5"><LockIcon /> {text}</p>}
      {phone && <p>Need help? Call <a className="underline" href={`tel:${phone}`}>{phone}</a></p>}
      <p className="pt-1"><PoweredBy /></p>
    </div>
  );
}

/** "Delivered by" row of courier logos. */
function CourierStrip() {
  return (
    <div className="pb-2">
      <p className="text-[10px] font-medium uppercase tracking-wider">Delivered by trusted couriers</p>
      <div className="mt-1.5 flex items-center justify-center gap-1.5">
        {COURIER_LOGOS.map((c) => <img key={c.id} src={c.logo} alt={c.name} title={c.name} width={28} height={28} loading="lazy" className="h-7 w-7 rounded-full bg-white object-contain" />)}
      </div>
    </div>
  );
}

function OtpDialog({ phone, widget, onClose, onVerified }: { phone: string; widget: WidgetConfig | null; onClose: () => void; onVerified: () => void }) {
  const send = useFetcher<{ ok: boolean; error?: string; resendIn?: number }>();
  const verify = useFetcher<{ ok: boolean; error?: string }>();
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(0);
  // MSG91 widget mode: the browser sends and checks the OTP, our server confirms the token
  const [w, setW] = useState<{ reqId: string | null; busy: "send" | "verify" | null; error: string | null }>({ reqId: null, busy: null, error: null });
  const input = useRef<HTMLInputElement>(null);
  const len = codeLength(widget);
  const sendOtp = () => {
    if (!widget) { send.submit({ intent: "otp_send", phone }, { method: "post" }); return; }
    setW((x) => ({ ...x, busy: "send", error: null }));
    (w.reqId ? widgetRetry(widget, w.reqId).then(() => w.reqId!) : widgetSend(widget, phone))
      .then((reqId) => { setW({ reqId, busy: null, error: null }); setWait(30); })
      .catch((e: Error) => setW((x) => ({ ...x, busy: null, error: e.message })));
  };
  useEffect(() => { sendOtp(); input.current?.focus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (send.data?.resendIn) setWait(send.data.resendIn); }, [send.data]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((x) => x - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { if (verify.data?.ok) onVerified(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [verify.data]);
  const submit = (v = code) => {
    if (v.length !== len) return;
    if (!widget) { verify.submit({ intent: "otp_verify", phone, code: v }, { method: "post" }); return; }
    if (!w.reqId) return;
    setW((x) => ({ ...x, busy: "verify", error: null }));
    widgetVerify(widget, v, w.reqId, phone)
      .then((token) => { setW((x) => ({ ...x, busy: null })); verify.submit({ intent: "otp_widget", phone, token }, { method: "post" }); })
      .catch((e: Error) => setW((x) => ({ ...x, busy: null, error: e.message })));
  };
  const error = w.error ?? (verify.data && !verify.data.ok ? verify.data.error : send.data && !send.data.ok && !send.data.resendIn ? send.data.error : null);
  const sending = send.state !== "idle" || w.busy === "send";
  const verifying = verify.state !== "idle" || w.busy === "verify";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="otp-title">
      <div className="w-full max-w-sm animate-fadein rounded-t-2xl bg-surface p-6 shadow-lift sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="otp-title" className="text-lg font-semibold">Verify your mobile number</h2>
            <p className="mt-1 text-sm text-ink-soft">{sending ? `Sending a ${len}-digit code to` : `Enter the ${len}-digit code sent to`} <b className="num text-ink">+91 {phone}</b></p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-faint hover:text-ink" aria-label="Close">✕</button>
        </div>
        <input ref={input} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={len} aria-label="OTP"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, len); setCode(v); if (v.length === len) submit(v); }}
          className="input num mt-5 text-center text-2xl font-semibold tracking-[0.5em]" placeholder={"•".repeat(len)} />
        {error && <p className="mt-2 text-sm font-medium text-bad" role="alert">{error}</p>}
        <button type="button" onClick={() => submit()} disabled={code.length !== len || verifying} className="btn-primary mt-4 w-full py-3">
          {verifying ? <><Spinner /> Verifying</> : "Verify and continue"}
        </button>
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" onClick={onClose} className="text-ink-soft hover:text-ink">Change number</button>
          <button type="button" disabled={wait > 0 || sending} onClick={() => { setCode(""); sendOtp(); }} className="font-medium text-brand disabled:text-ink-faint">
            {wait > 0 ? `Resend in ${wait}s` : "Resend OTP"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SavedAddresses({ list, selected, showAll, setShowAll, onPick, onEdit, onAddNew, revealing, className = "" }: {
  list: MaskedAddress[]; selected: number; showAll: boolean; setShowAll: (v: boolean) => void;
  onPick: (a: MaskedAddress) => void; onEdit: (id: number) => void; onAddNew: () => void; revealing: boolean; className?: string;
}) {
  const current = list.find((a) => a.id === selected) ?? list[0];
  const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;
  const Box = ({ a, active, onClick }: { a: MaskedAddress; active: boolean; onClick?: () => void }) => (
    <div onClick={onClick} role={onClick ? "radio" : undefined} aria-checked={onClick ? active : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      className={`rounded-xl border px-4 py-3 text-sm transition ${active ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-rule-strong"} ${onClick ? "cursor-pointer hover:border-brand/60" : ""}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-brand" : "border-rule-strong"}`}>{active && <span className="h-2 w-2 rounded-full bg-brand" />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{a.name}</p>
          <p className="mt-0.5 break-words text-ink-soft">{a.line}</p>
          <p className="text-ink-soft">{a.city}, {stateName(a.state)} – <span className="num">{a.pincode}</span></p>
        </div>
      </div>
    </div>
  );
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Deliver to your saved address</span>
        <span className="flex items-center gap-1 text-[11px] text-ink-faint"><LockIcon /> Partly hidden for privacy</span>
      </div>
      {showAll ? (
        <div className="space-y-2" role="radiogroup" aria-label="Saved addresses">
          {list.map((a) => <Box key={a.id} a={a} active={a.id === current.id} onClick={() => onPick(a)} />)}
        </div>
      ) : (
        <Box a={current} active />
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium">
        {list.length > 1 && <button type="button" className="text-brand" onClick={() => setShowAll(!showAll)}>{showAll ? "Done" : `Change (${list.length})`}</button>}
        <button type="button" className="text-brand disabled:text-ink-faint" disabled={revealing} onClick={() => onEdit(current.id)}>{revealing ? "Opening…" : "Edit"}</button>
        <button type="button" className="text-brand" onClick={onAddNew}>+ Add new address</button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">We'll confirm it's you with an OTP before placing the order.</p>
    </div>
  );
}

function PaymentOverlay({ name, logo }: { name: string; logo: string | null }) {
  return (
    <div className="fixed inset-0 z-50 flex animate-fadein flex-col items-center justify-center bg-surface/95 px-6 text-center" role="status" aria-live="polite">
      {logo ? <img src={logo} alt={name} className="mb-6 h-9 w-auto max-w-[160px] object-contain" /> : <p className="mb-6 text-lg font-semibold">{name}</p>}
      <BrandLoader className="h-16 w-16" label="Opening payment" />
      <p className="mt-4 font-medium">Opening secure payment</p>
      <p className="mt-1 text-sm text-ink-soft">Don't close this page or press back.</p>
      <PoweredBy className="absolute bottom-6" />
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

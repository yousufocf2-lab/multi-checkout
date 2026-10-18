// Shared pricing engine (runs on both client and server). All money in paise.

export type PaymentMethod = "prepaid" | "cod";

export interface PricedLine {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string | null;
  image: string | null;
  quantity: number;
  pricePaise: number;
  comparePaise: number | null;
}

export interface ProductRule {
  productIds: string[];
  type?: "percent" | "flat"; // flat = rupees off each item
  prepaidPct: number; // % off, or ₹ per item when flat
  codPct: number;
}

/** Mix & Match: any `buyQty` items in the cart → `freeQty` of them free (cheapest or priciest). */
export interface MixDeal {
  buyQty: number;
  freeQty: number;
  which: "low" | "high";
  title: string;
  keep?: boolean; // this payment method's discount still applies when the deal is unlocked (default yes)
}

/** The deal can differ by payment method (or be off for one of them). */
export type MixDeals = { prepaid: MixDeal | null; cod: MixDeal | null };

/** True when the unlocked deal switches off the payment discount. */
export const mixBlocksPayment = (mix: MixDeal | null | undefined) => Boolean(mix) && mix!.keep === false;

export interface StoreRule {
  prepaidDiscountPct: number;
  codDiscountPct: number;
  rules?: ProductRule[];
  mix?: MixDeals | null;
}

export const mixTitle = (m: Pick<MixDeal, "buyQty" | "freeQty">) => `Buy ${m.buyQty}, Get ${m.freeQty} Free`;

/**
 * Which units are free under a Mix & Match deal. Returns free units per line (same order as `lines`).
 * Only `freeQty` units are ever free, however many items are in the cart (no repeats).
 */
export function mixFreeUnits(lines: Pick<PricedLine, "pricePaise" | "quantity">[], mix: MixDeal | null | undefined) {
  const free = lines.map(() => 0);
  const qty = lines.reduce((n, l) => n + l.quantity, 0);
  if (!mix || mix.buyQty < 2 || mix.freeQty < 1 || qty < mix.buyQty) return { free, discount: 0, qty };
  const order = lines.map((l, i) => ({ i, price: l.pricePaise })).sort((a, b) => (mix.which === "high" ? b.price - a.price : a.price - b.price) || a.i - b.i);
  let left = Math.min(mix.freeQty, mix.buyQty - 1);
  let discount = 0;
  for (const o of order) {
    if (left <= 0) break;
    const take = Math.min(left, lines[o.i].quantity);
    free[o.i] = take;
    discount += take * o.price;
    left -= take;
  }
  return { free, discount, qty };
}

export interface CouponRule {
  code: string;
  description?: string | null;
  type: "percent" | "flat";
  value: number; // percent, or rupees for flat
  minCartRupees: number;
  maxDiscountRupees: number | null;
  stackable: boolean;
  paymentRestriction: "any" | "prepaid" | "cod";
  productIds?: string[] | null; // null/empty = whole cart
}

export interface BankOfferRule {
  id: number;
  bankName: string;
  title: string;
  type: "percent" | "flat";
  value: number;
  maxDiscountRupees: number | null;
  minCartRupees: number;
}

export interface PricingResult {
  subtotal: number;
  mrpTotal: number;
  paymentDiscount: number;
  /** Single % when every line gets the same payment discount, else null ("up to"). */
  paymentDiscountPct: number | null;
  maxPaymentPct: number;
  couponDiscount: number;
  couponApplied: boolean;
  couponMessage: string | null;
  total: number;
  savings: number; // vs subtotal (real selling price)
  mixDiscount: number; // Mix & Match free items
  mixFree: number[]; // free units per line
}

const MIN_TOTAL = 100; // ₹1

const clampPct = (p: number) => Math.max(0, Math.min(100, p));
const lineTotal = (l: PricedLine) => l.pricePaise * l.quantity;

/**
 * Payment discount for one line: first matching product rule, else the store-wide %.
 * Returns paise off per item, the effective % and a label like "70% off" or "₹100 off".
 */
export function lineOff(line: Pick<PricedLine, "productId" | "pricePaise">, store: StoreRule, method: PaymentMethod) {
  const rule = store.rules?.find((r) => r.productIds.includes(line.productId));
  const value = rule ? (method === "prepaid" ? rule.prepaidPct : rule.codPct) : method === "prepaid" ? store.prepaidDiscountPct : store.codDiscountPct;
  if (rule?.type === "flat") {
    const unit = Math.max(0, Math.min(line.pricePaise, Math.round(value * 100)));
    const pct = line.pricePaise ? Math.round((unit / line.pricePaise) * 100) : 0;
    return { unit, pct, flat: true, label: unit > 0 ? `${formatINR(unit)} off` : null };
  }
  const pct = clampPct(value);
  return { unit: Math.round((line.pricePaise * pct) / 100), pct, flat: false, label: pct > 0 ? `${pct}% off` : null };
}

/** Effective payment discount % for one line (kept for older callers). */
export function linePct(line: PricedLine, store: StoreRule, method: PaymentMethod) {
  return lineOff(line, store, method).pct;
}

export function computePricing(
  lines: PricedLine[],
  store: StoreRule,
  method: PaymentMethod,
  coupon: CouponRule | null,
): PricingResult {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const mrpTotal = lines.reduce((s, l) => s + Math.max(l.comparePaise ?? 0, l.pricePaise) * l.quantity, 0);

  // Mix & Match first: free units are taken out before payment discounts and coupons
  const deal = store.mix?.[method] ?? null;
  const mix = mixFreeUnits(lines, deal);
  const noPaymentDiscount = mix.discount > 0 && mixBlocksPayment(deal);
  const perLine = lines.map((l, i) => {
    const off = noPaymentDiscount ? { unit: 0, pct: 0, flat: false, label: null } : lineOff(l, store, method);
    const paidQty = l.quantity - mix.free[i];
    const net = l.pricePaise * paidQty;
    const discount = off.flat ? off.unit * paidQty : Math.round((net * off.pct) / 100);
    return { line: l, pct: off.pct, flat: off.flat, discount, net };
  });
  let paymentDiscount = perLine.reduce((s, x) => s + x.discount, 0);
  const pcts = [...new Set(perLine.map((x) => x.pct))];
  const maxPaymentPct = Math.max(0, ...pcts);
  // A single "70% off" label only when every line has the same percentage discount
  let paymentDiscountPct: number | null = pcts.length === 1 && !perLine.some((x) => x.flat) ? pcts[0] : null;

  let couponDiscount = 0;
  let couponApplied = false;
  let couponMessage: string | null = null;

  if (coupon) {
    const restricted = Boolean(coupon.productIds?.length);
    const eligible = restricted ? perLine.filter((x) => coupon.productIds!.includes(x.line.productId)) : perLine;
    const eligibleSubtotal = eligible.reduce((s, x) => s + x.net, 0);
    const eligibleAfterPayment = eligible.reduce((s, x) => s + x.net - x.discount, 0);
    const eligiblePayment = eligibleSubtotal - eligibleAfterPayment;

    if (coupon.paymentRestriction !== "any" && coupon.paymentRestriction !== method) {
      couponMessage = coupon.paymentRestriction === "prepaid" ? "Valid only when you pay online" : "Valid only on Cash on Delivery";
    } else if (restricted && eligible.length === 0) {
      couponMessage = "Not valid on the products in your cart";
    } else if (subtotal < coupon.minCartRupees * 100) {
      couponMessage = `Add items worth ${formatINR(coupon.minCartRupees * 100 - subtotal)} more to use this coupon`;
    } else {
      const base = coupon.stackable ? eligibleAfterPayment : eligibleSubtotal;
      let raw = coupon.type === "percent" ? Math.round((base * clampPct(coupon.value)) / 100) : coupon.value * 100;
      if (coupon.maxDiscountRupees != null) raw = Math.min(raw, coupon.maxDiscountRupees * 100);
      raw = Math.max(0, Math.min(raw, base));

      if (coupon.stackable) {
        couponDiscount = raw;
        couponApplied = true;
      } else if (raw > eligiblePayment) {
        // Non-stackable coupon replaces the payment discount on eligible items when it saves more
        couponDiscount = raw;
        paymentDiscount -= eligiblePayment;
        if (restricted) paymentDiscountPct = null;
        else paymentDiscountPct = 0;
        couponApplied = true;
        couponMessage = "Replaces the payment discount on these items (you save more)";
      } else {
        couponMessage = "Your payment discount already saves you more";
      }
    }
  }

  const total = Math.max(MIN_TOTAL, subtotal - mix.discount - paymentDiscount - couponDiscount);
  return {
    subtotal,
    mrpTotal,
    paymentDiscount,
    paymentDiscountPct: paymentDiscount > 0 ? paymentDiscountPct : 0,
    maxPaymentPct,
    couponDiscount,
    couponApplied,
    couponMessage,
    total,
    savings: subtotal - total,
    mixDiscount: mix.discount,
    mixFree: mix.free,
  };
}

/** Estimated extra saving from a bank offer on a given payable amount (display only). */
export function bankOfferEstimate(offer: BankOfferRule, subtotal: number, payable: number) {
  if (subtotal < offer.minCartRupees * 100) return 0;
  let d = offer.type === "percent" ? Math.round((payable * clampPct(offer.value)) / 100) : offer.value * 100;
  if (offer.maxDiscountRupees != null) d = Math.min(d, offer.maxDiscountRupees * 100);
  return Math.max(0, Math.min(d, payable - MIN_TOTAL));
}

export function formatINR(paise: number) {
  const r = paise / 100;
  return (
    "₹" +
    r.toLocaleString("en-IN", {
      minimumFractionDigits: paise % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

/** Compact rupees for dashboards: ₹950, ₹12.4K, ₹3.2L, ₹1.1Cr */
export function compactINR(rupees: number) {
  const a = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
}
const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

export function rupeesToPaise(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

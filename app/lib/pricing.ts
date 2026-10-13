// Shared pricing engine (runs on both client and server). All money in paise.

export type PaymentMethod = "prepaid" | "cod";

export interface PricedLine {
  variantId: string;
  title: string;
  variantTitle: string | null;
  image: string | null;
  quantity: number;
  pricePaise: number;
  comparePaise: number | null;
}

export interface StoreRule {
  prepaidDiscountPct: number;
  codDiscountPct: number;
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
  paymentDiscountPct: number;
  couponDiscount: number;
  couponApplied: boolean;
  couponMessage: string | null;
  total: number;
  savings: number; // vs subtotal (real selling price)
}

const MIN_TOTAL = 100; // ₹1

export function computePricing(
  lines: PricedLine[],
  store: StoreRule,
  method: PaymentMethod,
  coupon: CouponRule | null,
): PricingResult {
  const subtotal = lines.reduce((s, l) => s + l.pricePaise * l.quantity, 0);
  const mrpTotal = lines.reduce(
    (s, l) => s + Math.max(l.comparePaise ?? 0, l.pricePaise) * l.quantity,
    0,
  );

  const pct = method === "prepaid" ? store.prepaidDiscountPct : store.codDiscountPct;
  let paymentDiscount = Math.round((subtotal * clampPct(pct)) / 100);
  let couponDiscount = 0;
  let couponApplied = false;
  let couponMessage: string | null = null;

  if (coupon) {
    if (coupon.paymentRestriction !== "any" && coupon.paymentRestriction !== method) {
      couponMessage =
        coupon.paymentRestriction === "prepaid"
          ? "Ye coupon sirf prepaid payment pe valid hai"
          : "Ye coupon sirf Cash on Delivery pe valid hai";
    } else if (subtotal < coupon.minCartRupees * 100) {
      couponMessage = `Minimum cart value ₹${coupon.minCartRupees} chahiye`;
    } else {
      const base = coupon.stackable ? subtotal - paymentDiscount : subtotal;
      let raw =
        coupon.type === "percent"
          ? Math.round((base * clampPct(coupon.value)) / 100)
          : coupon.value * 100;
      if (coupon.maxDiscountRupees != null) raw = Math.min(raw, coupon.maxDiscountRupees * 100);
      raw = Math.max(0, Math.min(raw, base));

      if (coupon.stackable) {
        couponDiscount = raw;
        couponApplied = true;
      } else if (raw > paymentDiscount) {
        // Non-stackable coupon replaces the payment discount when it's bigger
        couponDiscount = raw;
        paymentDiscount = 0;
        couponApplied = true;
        couponMessage = "Coupon ne payment discount ko replace kiya (zyada bachat)";
      } else {
        couponMessage = "Aapka payment discount is coupon se zyada hai";
      }
    }
  }

  const total = Math.max(MIN_TOTAL, subtotal - paymentDiscount - couponDiscount);
  return {
    subtotal,
    mrpTotal,
    paymentDiscount,
    paymentDiscountPct: paymentDiscount > 0 ? pct : 0,
    couponDiscount,
    couponApplied,
    couponMessage,
    total,
    savings: subtotal - total,
  };
}

/** Estimated extra saving from a bank offer on a given payable amount (display only). */
export function bankOfferEstimate(offer: BankOfferRule, subtotal: number, payable: number) {
  if (subtotal < offer.minCartRupees * 100) return 0;
  let d =
    offer.type === "percent" ? Math.round((payable * clampPct(offer.value)) / 100) : offer.value * 100;
  if (offer.maxDiscountRupees != null) d = Math.min(d, offer.maxDiscountRupees * 100);
  return Math.max(0, Math.min(d, payable - MIN_TOTAL));
}

function clampPct(p: number) {
  return Math.max(0, Math.min(100, p));
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

export function rupeesToPaise(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

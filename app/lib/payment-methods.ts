// Payment methods (COD, Prepaid, Partial COD): on/off, discount or fee, coupons, and when each one shows.
// Shared by server and browser. Money in paise unless a field says rupees.

export type PayMethod = "prepaid" | "cod" | "partial";
export const PAY_METHODS: PayMethod[] = ["prepaid", "cod", "partial"];
export const METHOD_LABEL: Record<PayMethod, string> = { prepaid: "Prepaid (pay online)", cod: "Cash on Delivery", partial: "Partial COD" };

/** Partial COD is a COD order with an advance paid online, so COD rules (cooldown, blocks, shipping, gifts) apply to it. */
export const legacyMethod = (m: PayMethod): "prepaid" | "cod" => (m === "prepaid" ? "prepaid" : "cod");

export type AdjustMode = "off" | "discount" | "fee";
export type AmountType = "percent" | "flat"; // flat = whole rupees

export type ProductLite = { id: string; title: string; image?: string | null };

/**
 * When a method shows. A rule matches when every condition it has matches:
 * order value between min and max (rupees, blank = no limit) and, if products are picked,
 * "contains" = the cart has at least one of them, "only" = every item in the cart is one of them.
 * No rules = always shown. Several rules = shown when any one matches.
 */
export type ShowRule = { min: number | null; max: number | null; products: ProductLite[]; productMode: "contains" | "only" };

export type MethodSettings = {
  on: boolean;
  adjust: AdjustMode;
  type: AmountType;
  value: number; // % or ₹
  coupons: boolean; // can checkout coupons be used with this method
  rules: ShowRule[];
};

export type PartialSettings = MethodSettings & { advanceType: AmountType; advanceValue: number };

export type CodUnavailableSettings = { show: boolean; message: string };
export const DEFAULT_COD_UNAVAILABLE_MESSAGE = "COD is temporarily unavailable for this pin code.";
export type PaymentMethodsSettings = { prepaid: MethodSettings; cod: MethodSettings; partial: PartialSettings; codUnavailable: CodUnavailableSettings };

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clean = (v: unknown, fallback: MethodSettings): MethodSettings => {
  const o = (v && typeof v === "object" ? v : {}) as Partial<MethodSettings>;
  return {
    on: typeof o.on === "boolean" ? o.on : fallback.on,
    adjust: o.adjust === "discount" || o.adjust === "fee" || o.adjust === "off" ? o.adjust : fallback.adjust,
    type: o.type === "flat" ? "flat" : o.type === "percent" ? "percent" : fallback.type,
    value: Math.max(0, num(o.value, fallback.value)),
    coupons: typeof o.coupons === "boolean" ? o.coupons : fallback.coupons,
    rules: Array.isArray(o.rules) ? o.rules.map(cleanRule).filter((r): r is ShowRule => r !== null).slice(0, 20) : fallback.rules,
  };
};
function cleanRule(v: unknown): ShowRule | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<ShowRule>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  const products = Array.isArray(r.products) ? r.products.filter((p) => p && typeof p.id === "string").slice(0, 50) : [];
  const rule = { min: n(r.min), max: n(r.max), products, productMode: r.productMode === "only" ? "only" as const : "contains" as const };
  return rule.min == null && rule.max == null && !products.length ? null : rule;
}

/**
 * Settings with defaults. Stores saved before this tab existed keep their old % discounts
 * (stores.prepaidDiscountPct / codDiscountPct) and COD switch.
 */
export function resolvePaymentMethods(
  saved: Partial<PaymentMethodsSettings> | null | undefined,
  legacy: { prepaidDiscountPct: number; codDiscountPct: number; codEnabled: boolean },
): PaymentMethodsSettings {
  const s = saved ?? {};
  const pct = (p: number): Pick<MethodSettings, "adjust" | "type" | "value"> => (p > 0 ? { adjust: "discount", type: "percent", value: p } : { adjust: "off", type: "percent", value: 0 });
  const prepaid = clean(s.prepaid, { on: true, ...pct(legacy.prepaidDiscountPct), coupons: true, rules: [] });
  const cod = { ...clean(s.cod, { on: legacy.codEnabled, ...pct(legacy.codDiscountPct), coupons: true, rules: [] }), on: legacy.codEnabled };
  const p = (s.partial ?? {}) as Partial<PartialSettings>;
  const partial: PartialSettings = {
    ...clean(s.partial, { on: false, adjust: "off", type: "percent", value: 0, coupons: true, rules: [] }),
    advanceType: p.advanceType === "flat" ? "flat" : "percent",
    advanceValue: Math.max(0, num(p.advanceValue, 10)),
  };
  const unavailable = (s as Partial<PaymentMethodsSettings>).codUnavailable;
  const codUnavailable: CodUnavailableSettings = {
    show: unavailable?.show === true,
    message: typeof unavailable?.message === "string" ? unavailable.message.slice(0, 60) : DEFAULT_COD_UNAVAILABLE_MESSAGE,
  };
  return { prepaid, cod, partial, codUnavailable };
}

/** What the pricing engine needs for one method. */
export type MethodAdjust = Pick<MethodSettings, "adjust" | "type" | "value" | "coupons">;

/** Does this method show for the cart? `value` = items total in paise (before discounts). */
export function methodShows(s: { on: boolean; rules: { min: number | null; max: number | null; productMode: "contains" | "only"; products: { id: string }[] }[] }, cart: { value: number; productIds: string[] }) {
  if (!s.on) return false;
  if (!s.rules.length) return true;
  return s.rules.some((r) => {
    if (r.min != null && cart.value < r.min * 100) return false;
    if (r.max != null && cart.value > r.max * 100) return false;
    if (r.products.length) {
      const ids = new Set(r.products.map((p) => p.id));
      if (r.productMode === "only") return cart.productIds.length > 0 && cart.productIds.every((id) => ids.has(id));
      return cart.productIds.some((id) => ids.has(id));
    }
    return true;
  });
}

/** Advance paid online for Partial COD on an order `total`. Whole rupees, rounded up. Null when it would be the whole order. */
export function partialAdvance(s: Pick<PartialSettings, "advanceType" | "advanceValue">, total: number): number | null {
  if (total <= 0 || s.advanceValue <= 0) return null;
  const raw = s.advanceType === "flat" ? s.advanceValue * 100 : (total * Math.min(100, s.advanceValue)) / 100;
  const adv = Math.max(100, Math.ceil(raw / 100) * 100);
  return adv >= total ? null : adv;
}

/** Amount charged online now for an order. */
export const payNowPaise = (o: { paymentMethod: string; total: number; advance?: number | null }) =>
  o.paymentMethod === "partial" && o.advance ? o.advance : o.total;

export function describeRule(r: ShowRule) {
  const parts: string[] = [];
  if (r.min != null && r.max != null) parts.push(`order ₹${r.min} – ₹${r.max}`);
  else if (r.min != null) parts.push(`order ₹${r.min} or more`);
  else if (r.max != null) parts.push(`order up to ₹${r.max}`);
  if (r.products.length) {
    const names = r.products.slice(0, 2).map((p) => p.title).join(", ") + (r.products.length > 2 ? ` +${r.products.length - 2}` : "");
    parts.push(r.productMode === "only" ? `cart has only ${names}` : `cart has ${names}`);
  }
  return parts.join(" and ");
}

/** Order value after a bank offer: what the customer pays in all (online + on delivery). */
export const orderValuePaise = (o: { paymentMethod: string; total: number; amountPaid?: number | null; bankDiscount?: number | null }) =>
  o.paymentMethod === "partial" ? o.total - (o.bankDiscount ?? 0) : o.amountPaid ?? o.total;
/** Still to collect on delivery (COD: everything, Partial COD: the rest after the advance). */
export const toCollectPaise = (o: { paymentMethod: string; total: number; advance?: number | null }) =>
  o.paymentMethod === "cod" ? o.total : o.paymentMethod === "partial" ? o.total - (o.advance ?? 0) : 0;

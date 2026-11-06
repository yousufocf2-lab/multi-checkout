// Smart Checkout: what it adds over the standard checkout, its terms, checkout field rules and tipping. Browser-safe.
import type { CheckoutRules, FieldMode, TippingSettings } from "~/db/schema";

export const SMART_TERMS_VERSION = "v1";

export const SMART_FEATURES: { title: string; text: string }[] = [
  { title: "OTP-verified COD", text: "Customers confirm their mobile number with an OTP before a COD order is placed, so fake orders drop." },
  { title: "Discounts and fees by payment method", text: "Give a prepaid discount, add a COD fee, and set when each method shows." },
  { title: "Partial COD", text: "Customers pay a small advance online and the rest in cash on delivery." },
  { title: "Offers for one payment method", text: "Coupons, free gifts, product discounts and delivery charges that apply only to prepaid or only to COD." },
  { title: "RTO protection", text: "Block risky COD orders by delivery history, pin code and repeat behaviour." },
];

export const SMART_TERMS: string[] = [
  "Smart Checkout fees are charged on the order value (after discounts, including shipping) of every order placed through Growpefy checkout while Smart Checkout is active, prepaid and COD alike.",
  "The fee rate follows your plan at the time of the order: Starter 2%, Growth 1%, Pro 0.5%. It is billed on your monthly invoice with GST as applicable.",
  "Fees are charged on orders placed, including orders later cancelled, returned or not delivered (RTO). Fees already billed are not refunded.",
  "OTP and WhatsApp messages sent for Smart Checkout features are billed at the rates shown in Plan & billing.",
  "You decide the discounts, fees and rules shown to your customers and are responsible for them being accurate and lawful, including any fee you charge for cash on delivery.",
  "Growpefy may stop Smart Checkout for a store with invoices unpaid for more than 15 days. Orders keep working on the standard checkout.",
  "You can turn Smart Checkout off at any time from Checkout settings. From then on your checkout works as a standard checkout and no Smart Checkout fee is charged on new orders.",
  "Growpefy may change these terms or fees with 30 days' notice by email and in your admin. Continuing to use Smart Checkout after that means you accept the change.",
];

export const resolveRules = (r: CheckoutRules | null | undefined, showEmail = true): Required<CheckoutRules> => {
  const mode = (v: unknown, d: FieldMode): FieldMode => (v === "hidden" || v === "optional" || v === "required" ? v : d);
  return { email: mode(r?.email, showEmail ? "optional" : "hidden"), landmark: mode(r?.landmark, "optional"), orderNote: Boolean(r?.orderNote) };
};

export const resolveTipping = (t: TippingSettings | null | undefined) => {
  const presets = (Array.isArray(t?.presets) ? t!.presets : [5, 10, 15]).map((n) => Math.round(Number(n))).filter((n) => n > 0 && n <= 50).slice(0, 3);
  return { on: Boolean(t?.on), presets: presets.length ? presets : [5, 10, 15], custom: t?.custom !== false, label: (t?.label || "Add a tip").slice(0, 40) };
};

/** Highest tip we accept: half the order or ₹10,000, whichever is lower (paise). */
export const maxTipPaise = (subtotal: number) => Math.min(Math.round(subtotal / 2), 10_000_00);

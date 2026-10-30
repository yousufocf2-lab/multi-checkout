// Wallet constants and maths shared by server and browser. Money is paise.
import type { WalletRates } from "~/db/schema";

export const WALLET_GST = 0.18;

export const DEFAULT_RATES: WalletRates = { saleFeeBps: 100, otp: 100, waConfirm: 150, waTracking: 100, waPromo: 250, waReply: 7, waFollowup: 150, waRecovery: 250 };

export type TxType = "recharge" | "sale_fee" | "otp" | "wa_confirm" | "wa_tracking" | "wa_promo" | "wa_reply" | "wa_followup" | "wa_recovery" | "refund_reversal" | "manual_credit" | "manual_debit"
  | "dropship_product" | "dropship_shipping" | "dropship_packing" | "dropship_rto" | "dropship_refund";
export type UsageType = "otp" | "wa_confirm" | "wa_tracking" | "wa_promo" | "wa_reply" | "wa_followup" | "wa_recovery";

export const TX_LABELS: Record<TxType, string> = {
  recharge: "Recharge",
  sale_fee: "Sale fee",
  otp: "OTP",
  wa_confirm: "WhatsApp order confirmation",
  wa_tracking: "WhatsApp courier tracking",
  wa_promo: "WhatsApp promotional",
  wa_reply: "WhatsApp inbox reply (within 24 h)",
  wa_followup: "WhatsApp inbox follow-up (after 24 h)",
  wa_recovery: "WhatsApp abandoned cart message",
  refund_reversal: "Sale fee reversed (refund)",
  manual_credit: "Growpefy free credit",
  manual_debit: "Debit by admin",
  dropship_product: "Order fulfilment charge",
  dropship_shipping: "Shipping charge",
  dropship_packing: "Packing charge",
  dropship_rto: "RTO charge",
  dropship_refund: "Refund for cancelled order",
};

export const USAGE_RATE_KEY: Record<UsageType, keyof WalletRates> = { otp: "otp", wa_confirm: "waConfirm", wa_tracking: "waTracking", wa_promo: "waPromo", wa_reply: "waReply", wa_followup: "waFollowup", wa_recovery: "waRecovery" };

/** GST is added on top of the credit: ₹2,000 credit → ₹360 GST → pay ₹2,360. */
export function rechargeBreakup(creditPaise: number) {
  const gst = Math.round(creditPaise * WALLET_GST);
  return { credit: creditPaise, gst, total: creditPaise + gst };
}

/** 1% of the order total, rounded up to the next paisa. */
export const saleFeeFor = (orderTotalPaise: number, bps: number) => Math.ceil((orderTotalPaise * bps) / 10000);

export function mergeRates(base: WalletRates | null | undefined, override?: Partial<WalletRates> | null): WalletRates {
  const b = { ...DEFAULT_RATES, ...(base ?? {}) };
  const o = Object.fromEntries(Object.entries(override ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0));
  return { ...b, ...o } as WalletRates;
}

export type WalletState = "ok" | "low" | "negative" | "locked";

/** ok → low (below alert) → negative (below ₹0, all still works) → locked (past the negative limit). */
export function walletState(balance: number, lowAlert: number, negativeLimit: number): WalletState {
  if (balance < -negativeLimit) return "locked";
  if (balance < 0) return "negative";
  if (balance < lowAlert) return "low";
  return "ok";
}

export const rupees = (paise: number, d = 2) =>
  (paise < 0 ? "−₹" : "₹") + (Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Indian financial year label for a date, e.g. 2026-10-18 → "26-27". */
export function financialYear(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

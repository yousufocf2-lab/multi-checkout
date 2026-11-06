// Standard checkout for stores without Smart Checkout: no OTP, no payment-method discounts or fees, no Partial COD,
// and every offer applies the same way to every payment method.
import type { Store } from "~/db.server";
import { resolvePaymentMethods, type PaymentMethodsSettings } from "./payment-methods";

export function smartView(store: Store): Store {
  if (store.smartCheckout) return store;
  const pm = resolvePaymentMethods(store.paymentMethods, store);
  const plain = { adjust: "off" as const, type: "percent" as const, value: 0, coupons: true };
  const methods: PaymentMethodsSettings = {
    ...pm,
    prepaid: { ...pm.prepaid, ...plain },
    cod: { ...pm.cod, ...plain },
    partial: { ...pm.partial, ...plain, on: false },
  };
  return {
    ...store,
    otpEnabled: false,
    prepaidDiscountPct: 0,
    codDiscountPct: 0,
    paymentMethods: methods,
    // Mix & Match: the prepaid deal applies to every method
    mixCodOn: store.mixPrepaidOn, mixCodFreeQty: store.mixFreeQty, mixCodFreeWhich: store.mixFreeWhich, mixKeepCod: store.mixKeepPrepaid,
  };
}

/** Coupons, gifts and delivery charges limited to one payment method only count with Smart Checkout. */
export const methodLimited = (store: Pick<Store, "smartCheckout">, restriction: string | null | undefined) => store.smartCheckout ? restriction ?? "any" : "any";

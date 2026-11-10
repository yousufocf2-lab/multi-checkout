// Store-wide pricing and delivery rules the checkout applies (shared by the checkout and order recovery).
import { and, desc, eq } from "drizzle-orm";
import { db, discountRules, shippingRates, type stores } from "~/db.server";
import { mixTitle, type StoreRule } from "./pricing";
import { resolvePaymentMethods, type PaymentMethodsSettings } from "./payment-methods";
import type { ShipRule } from "./shipping";

export async function storeRuleFor(store: typeof stores.$inferSelect): Promise<StoreRule> {
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
  const pm = resolvePaymentMethods(store.paymentMethods, store);
  const adj = (m: PaymentMethodsSettings["prepaid"]) => ({ adjust: m.adjust, type: m.type, value: m.value, coupons: m.coupons });
  return {
    methods: { prepaid: adj(pm.prepaid), cod: adj(pm.cod), partial: adj(pm.partial) },
    prepaidDiscountPct: store.prepaidDiscountPct,
    codDiscountPct: store.codDiscountPct,
    mix: prepaidDeal || codDeal ? { prepaid: prepaidDeal, cod: codDeal } : null,
    rules: rules.map((r) => ({ productIds: r.products.map((p) => p.id), type: r.type === "flat" ? "flat" as const : "percent" as const, prepaidPct: r.prepaidPct, codPct: r.codPct, partialPct: r.partialPct })),
    uniform: !store.smartCheckout,
  };
}

export async function shippingRulesFor(storeId: number, smart = true): Promise<ShipRule[]> {
  const rows = await db.select().from(shippingRates).where(and(eq(shippingRates.storeId, storeId), eq(shippingRates.active, true)));
  // Delivery charges for one payment method only are a Smart Checkout feature
  return rows.filter((r) => smart || r.paymentMethod === "any").map((r) => ({
    id: r.id, name: r.name, pricePaise: r.pricePaise, minOrderRupees: r.minOrderRupees, maxOrderRupees: r.maxOrderRupees,
    states: r.states, pincodePrefixes: r.pincodePrefixes, paymentMethod: r.paymentMethod,
  }));
}


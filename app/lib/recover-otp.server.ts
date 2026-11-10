// One-time recovery: customers who got stuck at the COD OTP step (Resend OTP was broken and a code that was
// already accepted could not be used again) before the fix went live. Each becomes a COD order from their own
// cart and address, tagged "Recovered", for the calling team to confirm before anything ships.
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { checkoutEvents, checkoutSessions, db, orders, stores, type OrderCustomer } from "~/db.server";
import { normalizePhone } from "./cod.server";
import { shippingRulesFor, storeRuleFor } from "./checkout-rules.server";
import { freeGiftsFor } from "./offers.server";
import { finalizeOrder, newOrderId } from "./orders.server";
import { fetchLines } from "./platform.server";
import { legacyMethod } from "./payment-methods";
import { computePricing } from "./pricing";
import { quoteShipping, withShipping } from "./shipping";
import { smartView } from "./smart.server";
import { INDIAN_STATES } from "./states";

// Only checkouts from before the OTP fix (10 Nov 2026, 18:22 IST)
const FROM = new Date("2026-11-07T18:30:00Z");
const UNTIL = new Date("2026-11-10T12:52:00Z");

let ran = false;
export async function recoverOtpStuck() {
  if (ran) return;
  ran = true;
  try {
    // Checkouts where the customer typed an OTP, or the OTP step failed for them
    const ev = await db.select({ sessionId: checkoutEvents.sessionId, storeId: checkoutEvents.storeId, type: checkoutEvents.type })
      .from(checkoutEvents)
      .where(and(inArray(checkoutEvents.type, ["otp_error", "otp_verified"]), gte(checkoutEvents.at, FROM), lt(checkoutEvents.at, UNTIL)));
    const ids = [...new Set(ev.map((e) => e.sessionId))];
    if (!ids.length) return;
    const sessions = await db.select().from(checkoutSessions).where(inArray(checkoutSessions.id, ids));
    const withOrder = new Set((await db.select({ s: orders.sessionId }).from(orders).where(and(inArray(orders.sessionId, ids), isNotNull(orders.sessionId)))).map((r) => r.s));
    const storeRows = new Map((await db.select().from(stores).where(inArray(stores.id, [...new Set(sessions.map((s) => s.storeId))]))).map((s) => [s.id, s]));
    const done = new Set<string>(); // one order per store + phone
    let made = 0;
    // newest checkout first: that's the cart the customer last wanted
    for (const s of sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
      const raw = storeRows.get(s.storeId);
      if (!raw || !raw.codEnabled || withOrder.has(s.id)) continue;
      const c = s.customer ?? {};
      const phone = normalizePhone(c.phone ?? "");
      const customer: OrderCustomer = {
        firstName: (c.firstName ?? "").trim(), lastName: (c.lastName ?? "").trim(), phone, email: c.email ?? "",
        address1: (c.address1 ?? "").trim(), address2: c.address2 ?? "", city: (c.city ?? "").trim(), state: c.state ?? "", pincode: (c.pincode ?? "").replace(/\D/g, ""),
      };
      if (!customer.lastName && /\s/.test(customer.firstName)) { const [f, ...r] = customer.firstName.split(/\s+/); customer.firstName = f; customer.lastName = r.join(" "); }
      if (!customer.firstName || !/^[6-9]\d{9}$/.test(phone) || customer.address1.length < 5 || !customer.city || !/^\d{6}$/.test(customer.pincode) || !INDIAN_STATES.some((x) => x.code === customer.state)) continue;
      const key = `${s.storeId}:${phone}`;
      if (done.has(key)) continue;
      done.add(key);
      // The customer ordered anyway (another try, another day)?
      const [already] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.storeId, s.storeId), gte(orders.createdAt, new Date(s.createdAt.getTime() - 86400_000)), inArray(orders.status, ["cod_placed", "paid", "cod_placing"]), sql`${orders.customer}->>'phone' = ${phone}`))
        .limit(1);
      if (already) continue;
      try {
        const store = smartView(raw);
        const [lines, rule, shipRules] = await Promise.all([fetchLines(store, s.items), storeRuleFor(store), shippingRulesFor(store.id, store.smartCheckout)]);
        if (!lines.length) continue;
        const freeLines = (await freeGiftsFor(store, lines))[legacyMethod("cod")];
        const base = computePricing(lines, rule, "cod", null);
        const p = withShipping(base, quoteShipping(shipRules, { state: customer.state, pincode: customer.pincode, method: legacyMethod("cod"), value: base.total }));
        const [order] = await db.insert(orders).values({
          id: newOrderId(), storeId: store.id, sessionId: s.id, checkoutChannel: store.smartCheckout ? "premium_checkout" : "native",
          status: "cod_placing", paymentMethod: "cod", customer, items: [...lines, ...freeLines],
          subtotal: p.subtotal, paymentDiscount: p.paymentDiscount, couponCode: null, couponDiscount: 0, offerDiscount: p.mixDiscount,
          shipping: p.shipping, shippingTitle: p.shippingName, total: p.total, paymentFee: p.paymentFee, tip: 0, advance: null,
          tracking: s.tracking ?? {}, manualTags: ["Recovered"],
          staffNote: "Recovered: the customer got stuck at the OTP step and the order wasn't placed. Call to confirm before shipping.",
        }).returning();
        await finalizeOrder(store, order, { status: "cod_placed" });
        made++;
        console.log(`[recover-otp] store ${store.id}: order ${order.id} for session ${s.id}`);
      } catch (e) {
        console.error(`[recover-otp] session ${s.id}:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`[recover-otp] ${made} order(s) created from ${ids.length} OTP checkout(s)`);
  } catch (e) {
    console.error("[recover-otp]", e instanceof Error ? e.message : e);
  }
}

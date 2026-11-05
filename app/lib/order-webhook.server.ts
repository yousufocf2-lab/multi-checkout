// Custom integration: every new order is POSTed to the store's own URL (an ERP, a courier, Zapier/Make...),
// signed so the receiver can trust it: X-Growpefy-Signature = hex HMAC-SHA256 of the raw body with the store's secret.
import crypto from "node:crypto";
import type { Order, Store } from "~/db.server";
import { codAmount } from "./store-fulfil.server";

export function orderPayload(store: Store, o: Order) {
  return {
    event: "order.created",
    store: { id: store.id, name: store.name },
    order: {
      id: o.id, number: o.shopifyOrderName ?? o.id, created_at: o.createdAt.toISOString(),
      payment: o.paymentMethod, status: o.status, total: o.total / 100, shipping: o.shipping / 100, cod_amount: codAmount(o) / 100,
      coupon: o.couponCode ?? null,
      customer: { ...o.customer },
      items: o.items.map((l) => ({ variant_id: l.variantId, title: l.title, variant: l.variantTitle, quantity: l.quantity, price: l.pricePaise / 100 })),
    },
  };
}

export async function postWebhook(url: string, secret: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Growpefy-Signature": sig, "User-Agent": "Growpefy-Webhook/1" },
    body, signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

/** Never blocks the order: failures are only logged. */
export async function sendOrderWebhook(store: Store, o: Order) {
  if (!store.orderWebhookUrl || !store.orderWebhookSecret) return;
  try {
    const status = await postWebhook(store.orderWebhookUrl, store.orderWebhookSecret, orderPayload(store, o));
    if (status >= 300) console.warn(`[order-webhook] ${store.name} ${o.id}: HTTP ${status}`);
  } catch (e) {
    console.warn(`[order-webhook] ${store.name} ${o.id}:`, e instanceof Error ? e.message : e);
  }
}

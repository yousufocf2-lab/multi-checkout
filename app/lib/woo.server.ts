// WooCommerce stores talk to Growpefy through the "Growpefy Checkout for WooCommerce" plugin.
// Every request is signed both ways with the store's secret: X-Growpefy-Time + X-Growpefy-Signature
// (hex HMAC-SHA256 of "<unix seconds>.<raw body>"). The plugin re-checks prices, stock and totals itself.
import crypto from "node:crypto";
import type { Order, Store } from "~/db/schema";
import { gatewayName } from "./gateways/catalog";
import { rupeesToPaise, type PricedLine } from "./pricing";
import type { CatalogProduct, FulfilResult, OrderTracking } from "./shopify.server";

export { WOO_PLUGIN_PATH, WOO_PLUGIN_VERSION } from "./woo";
const MAX_SKEW_S = 300;

export class WooError extends Error {}

export const newWooSecret = () => `gpw_${crypto.randomBytes(24).toString("base64url")}`;

export function wooSign(secret: string, time: string, body: string) {
  return crypto.createHmac("sha256", secret).update(`${time}.${body}`).digest("hex");
}

/** Checks a request the plugin sent us. */
export function wooVerify(secret: string | null | undefined, time: string | null, signature: string | null, body: string) {
  if (!secret || !time || !signature || !/^\d{9,11}$/.test(time) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(time)) > MAX_SKEW_S) return false;
  const a = Buffer.from(wooSign(secret, time, body)), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const base = (s: Store) => s.storefrontUrl.replace(/\/+$/, "");

/** Calls the plugin. Uses ?rest_route= so it works with or without pretty permalinks. */
async function call<T>(store: Store, route: string, payload: unknown = {}, timeoutMs = 15_000): Promise<T> {
  if (!store.wooSecret) throw new WooError("WooCommerce isn't connected yet. Install the Growpefy plugin and paste the secret key.");
  const body = JSON.stringify(payload ?? {});
  const time = String(Math.floor(Date.now() / 1000));
  let res: Response;
  try {
    res = await fetch(`${base(store)}/?rest_route=${encodeURIComponent(`/growpefy/v1/${route}`)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Growpefy-Time": time, "X-Growpefy-Signature": wooSign(store.wooSecret, time, body), "User-Agent": "Growpefy/1.0 (+https://growpefy.com)" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    throw new WooError(`Couldn't reach ${base(store).replace(/^https?:\/\//, "")}${cause ? ` (${cause})` : ""}. Check the store is online.`);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* HTML error page, security plugin, etc. */ }
  if (!res.ok) {
    const code = String(data.code ?? "");
    if (code === "rest_no_route") throw new WooError("The Growpefy plugin isn't installed or is turned off on this store.");
    if (code === "growpefy_bad_signature") throw new WooError("The secret key in the plugin doesn't match. Copy it again from Growpefy → Setup.");
    if (code === "growpefy_not_configured") throw new WooError("The Growpefy plugin is installed but the Store ID / secret key aren't saved yet.");
    throw new WooError(String(data.message ?? `Store replied ${res.status}${text && !data.message ? ` (${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)})` : ""}`));
  }
  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) throw new WooError("The store returned a page instead of data. A security or cache plugin may be blocking /wp-json; allow growpefy routes.");
  return data as T;
}

// ---------- reads ----------

export async function testConnection(store: Store) {
  const r = await call<{ name: string; currency: string; wc: string; plugin: string }>(store, "ping");
  if (r.currency && r.currency !== "INR") throw new WooError(`Store currency is ${r.currency}. Growpefy checkout works in INR.`);
  return { name: r.name, currencyCode: r.currency || "INR", plugin: r.plugin, wc: r.wc };
}

type WooLine = { id: string; product_id: string; title: string; variant_title: string | null; image: string | null; price: string; regular_price: string | null; available: boolean };

/** Live prices from WooCommerce (never trust prices from the browser). Unknown / unavailable items are left out. */
export async function fetchLines(store: Store, items: { variantId: string; quantity: number }[]): Promise<PricedLine[]> {
  if (!items.length) return [];
  const r = await call<{ items: WooLine[] }>(store, "lines", { ids: items.map((i) => i.variantId) });
  const by = new Map((r.items ?? []).map((x) => [String(x.id), x]));
  const out: PricedLine[] = [];
  for (const it of items) {
    const n = by.get(String(it.variantId));
    if (!n || !n.available) continue;
    const price = rupeesToPaise(n.price) ?? 0;
    const compare = rupeesToPaise(n.regular_price);
    out.push({
      variantId: it.variantId, productId: String(n.product_id), title: n.title, variantTitle: n.variant_title || null,
      image: n.image, quantity: it.quantity, pricePaise: price, comparePaise: compare && compare > price ? compare : null,
    });
  }
  return out;
}

type WooProduct = { id: string; title: string; image: string | null; variants: { id: string; title: string; price: string; regular_price: string | null; available: boolean }[] };
const toCatalog = (p: WooProduct): CatalogProduct => ({
  id: String(p.id), title: p.title, image: p.image,
  variants: (p.variants ?? []).map((v) => {
    const price = rupeesToPaise(v.price) ?? 0;
    const compare = rupeesToPaise(v.regular_price);
    return { id: String(v.id), title: v.title ?? "", pricePaise: price, comparePaise: compare && compare > price ? compare : null, available: Boolean(v.available) };
  }),
});

export async function searchProducts(store: Store, q: string) {
  const r = await call<{ products: WooProduct[] }>(store, "products", { q: q.trim().slice(0, 80), limit: 20 });
  return (r.products ?? []).map(toCatalog);
}

const upsellCache = new Map<string, { at: number; items: CatalogProduct[] }>();
export async function fetchUpsellProducts(store: Store, chosenIds: string[]) {
  const key = `${store.id}:${chosenIds.join(",")}`;
  const hit = upsellCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.items;
  const r = await call<{ products: WooProduct[] }>(store, "products", chosenIds.length ? { ids: chosenIds } : { newest: 12 });
  const items = (r.products ?? []).map(toCatalog).filter((p) => p.variants.some((v) => v.available));
  upsellCache.set(key, { at: Date.now(), items });
  return items;
}

export async function fetchVariantSkus(store: Store, variantIds: string[]) {
  const ids = [...new Set(variantIds.filter(Boolean))].slice(0, 100);
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const r = await call<{ skus: Record<string, string> }>(store, "skus", { ids });
  for (const [k, v] of Object.entries(r.skus ?? {})) out.set(String(k), String(v ?? "").trim());
  return out;
}

// ---------- orders ----------

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** Creates the order in WooCommerce. The plugin is idempotent on our order id, so retries never duplicate. */
export async function createOrder(store: Store, order: Order) {
  const c = order.customer;
  const isCod = order.paymentMethod === "cod";
  const isPartial = order.paymentMethod === "partial";
  const discounts = [
    { label: isPartial ? "Partial COD discount" : isCod ? "COD discount" : "Online payment discount", amount: order.paymentDiscount },
    { label: order.couponCode ? `Coupon ${order.couponCode}` : "Coupon", amount: order.couponDiscount },
    { label: "Bank offer", amount: order.bankDiscount },
    { label: "Mix & Match offer", amount: order.offerDiscount },
  ].filter((d) => d.amount > 0).map((d) => ({ label: d.label, amount: rupees(d.amount) }));
  const paid = isCod ? 0 : (order.amountPaid ?? (isPartial ? order.advance ?? 0 : order.total));
  const gw = order.gateway ? gatewayName(order.gateway) : order.payuMihpayid ? "PayU" : null;
  const r = await call<{ id: number | string; number: string; existed?: boolean }>(store, "order/create", {
    growpefy_id: order.id,
    payment: isCod ? "cod" : isPartial ? "partial" : "prepaid",
    payment_title: isCod ? "Cash on Delivery" : isPartial ? `Partial COD${gw ? ` (advance via ${gw})` : ""}` : `Paid online${gw ? ` via ${gw}` : ""}`,
    transaction_id: order.gatewayRef ?? order.payuMihpayid ?? null,
    paid: rupees(paid),
    total: rupees(order.total),
    collect_on_delivery: rupees(isCod ? order.total : isPartial ? order.total - (order.advance ?? 0) : 0),
    customer: {
      first_name: c.firstName, last_name: c.lastName || "", phone: c.phone, email: c.email || "",
      address_1: c.address1, address_2: c.address2 || "", city: c.city, state: c.state, postcode: c.pincode, country: "IN",
    },
    items: order.items.map((l) => ({ id: l.variantId, quantity: l.quantity, price: rupees(l.free ? 0 : l.pricePaise), free: Boolean(l.free), offer: l.offer ?? null })),
    discounts,
    fees: order.paymentFee > 0 ? [{ label: isPartial ? "Partial COD charges" : isCod ? "COD charges" : "Payment charges", amount: rupees(order.paymentFee) }] : [],
    shipping: { title: order.shippingTitle || "Standard delivery", amount: rupees(order.shipping) },
    tags: ["Growpefy", isCod ? "COD" : isPartial ? "Partial COD" : "Prepaid", order.couponCode].filter(Boolean),
    note: `Growpefy checkout order ${order.id}${order.gatewayRef || order.payuMihpayid ? `, ${gw ?? "gateway"} ${order.gatewayRef ?? order.payuMihpayid}` : ""}${isPartial ? `. Partial COD: ₹${rupees(order.amountPaid ?? order.advance ?? 0)} paid online, collect ₹${rupees(order.total - (order.advance ?? 0))} on delivery` : ""}`,
  }, 30_000);
  return { id: String(r.id), name: `#${r.number || r.id}` };
}

const num = (id: string) => (id.match(/(\d+)\s*$/)?.[1] ?? id);

/** Adds tags (as an order note + meta). Never throws; returns an error message or null. */
export async function tagOrder(store: Store, orderId: string, tags: string[]) {
  try { await call(store, "order/tag", { id: num(orderId), tags }); return null; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** Cancels the order in WooCommerce (stock goes back). Never throws. */
export async function cancelOrder(store: Store, orderId: string, note: string) {
  try { await call(store, "order/cancel", { id: num(orderId), note }); return null; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

export async function fulfilOrder(store: Store, orderId: string, tracking: { number: string; company: string }): Promise<FulfilResult> {
  try {
    const r = await call<{ ok: boolean; already?: boolean; cancelled?: boolean; error?: string }>(store, "order/fulfil", { id: num(orderId), number: tracking.number, company: tracking.company });
    if (r.ok) return { ok: true, already: Boolean(r.already) };
    return { ok: false, cancelled: r.cancelled, error: r.error ?? "Couldn't mark the order shipped" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type WooTracking = { id: string; status: string; cancelled: boolean; tags: string[]; updated: string | null; tracking: { number: string; company: string | null; url: string | null }[] };

/** Tracking numbers saved on WooCommerce orders (our own, Shipment Tracking / AST, and common courier plugins). */
export async function fetchTracking(store: Store, orderIds: string[]): Promise<OrderTracking[]> {
  if (!orderIds.length) return [];
  const want = orderIds.slice(0, 50);
  const r = await call<{ orders: WooTracking[] }>(store, "order/tracking", { ids: want.map(num) });
  const by = new Map((r.orders ?? []).map((o) => [String(o.id), o]));
  const out: OrderTracking[] = [];
  for (const asked of want) {
    const o = by.get(num(asked));
    if (!o) continue;
    const tracking = (o.tracking ?? []).filter((t) => t.number).map((t) => ({ number: String(t.number).trim(), company: t.company, url: t.url }));
    const shipped = o.status === "completed" ? "FULFILLED" : o.status === "delivered" ? "DELIVERED" : tracking.length ? "IN_TRANSIT" : null;
    out.push({
      orderId: asked, // same id format the caller used
      tags: [...(o.tags ?? []), o.status],
      cancelled: o.cancelled,
      fulfillments: shipped || tracking.length ? [{ status: shipped, updatedAt: o.updated, tracking }] : [],
      tracking,
    });
  }
  return out;
}

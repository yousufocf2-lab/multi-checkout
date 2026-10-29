// Checkout on the store's own domain through the Shopify App Proxy: https://<store>/apps/growpefy/c/<session>.
// Shopify forwards it to https://growpefy.com/proxy/c/<session>; server.mjs rewrites that to /apps/growpefy/c/<session>.
// Same checkout, but the customer never leaves the store's domain, so the store's Meta / Google cookies and
// the payment gateway's registered website all match.
import type { Order, Store } from "~/db/schema";
import { PROXY_PATH } from "./gateways/index.server";

export { PROXY_PATH };

/** True when this request came in through the App Proxy (the store's domain). */
export function isProxied(request: Request) {
  return new URL(request.url).pathname.startsWith(`${PROXY_PATH}/`);
}

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
function hostOf(u: string) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}

/** The store domain the customer is on (sent by the checkout page). Only the store's own domains are accepted. */
export function cleanProxyOrigin(store: Pick<Store, "storefrontUrl" | "shopDomain">, raw: unknown) {
  if (typeof raw !== "string") return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  const site = hostOf(store.storefrontUrl);
  const ok = h === store.shopDomain.toLowerCase() || (site && bare(h) === bare(site));
  return ok ? `https://${h}` : null;
}

/** Thank-you page for an order placed on the store's domain. */
export const proxyOrderUrl = (origin: string, orderId: string) => `${origin}${PROXY_PATH}/order/${orderId}`;
export const proxyCheckoutUrl = (origin: string, sessionId: string) => `${origin}${PROXY_PATH}/c/${sessionId}`;
export const orderProxyOrigin = (order: Pick<Order, "tracking">) => order.tracking?.proxyOrigin ?? null;

// ---------------- does the App Proxy work for this store? ----------------

type Check = { ok: boolean; at: number; running?: Promise<boolean> };
const checks = new Map<number, Check>();
const OK_FOR = 30 * 60_000;
const FAIL_FOR = 5 * 60_000;

/** Asks the store's /apps/growpefy/ping (through Shopify) whether the App Proxy reaches us with a valid signature. */
async function probe(store: Pick<Store, "shopDomain" | "slug">) {
  try {
    const res = await fetch(`https://${store.shopDomain}${PROXY_PATH}/ping?probe=1`, { redirect: "follow", signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    return res.ok && text.includes(`growpefy-proxy-ok:${store.slug}`);
  } catch {
    return false;
  }
}

/**
 * Whether new checkouts for this store open on the store's own domain.
 * Answers from a cache; the first call (or an expired one) starts a check in the background and uses the old answer
 * (or "no" the very first time), so opening the checkout is never slowed down.
 */
export function proxyCheckoutReady(store: Pick<Store, "id" | "platform" | "shopDomain" | "slug" | "proxyCheckout" | "clientSecret">) {
  if (store.platform !== "shopify" || !store.proxyCheckout || !store.clientSecret) return false;
  const c = checks.get(store.id);
  const fresh = c && Date.now() - c.at < (c.ok ? OK_FOR : FAIL_FOR);
  if (!fresh && !c?.running) {
    const running = probe(store).then((ok) => {
      checks.set(store.id, { ok, at: Date.now() });
      if (!ok) console.warn(`[proxy-checkout] App Proxy not working for ${store.shopDomain}; using the Growpefy address`);
      return ok;
    });
    checks.set(store.id, { ok: c?.ok ?? false, at: c?.at ?? 0, running });
  }
  return c?.ok ?? false;
}

/** Runs the check now (Setup page), and remembers the answer. */
export async function checkProxyNow(store: Pick<Store, "id" | "shopDomain" | "slug">) {
  const ok = await probe(store);
  checks.set(store.id, { ok, at: Date.now() });
  return ok;
}

export function forgetProxyCheck(storeId: number) {
  checks.delete(storeId);
}

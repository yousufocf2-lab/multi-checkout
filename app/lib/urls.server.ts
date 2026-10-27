import type { Store } from "~/db/schema";
import { env } from "./env.server";

/**
 * Shared checkout domain (env CHECKOUT_DOMAIN, e.g. checkout.growpefy.com).
 * Every store gets its own subdomain on it automatically: vyros.checkout.growpefy.com.
 * Needs one wildcard domain (*.checkout.growpefy.com) on Railway + DNS.
 */
export function checkoutRoot() {
  const v = (process.env.CHECKOUT_DOMAIN ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  return v || null;
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** vyros → vyros.checkout.growpefy.com (null when CHECKOUT_DOMAIN isn't set or the slug can't be a hostname). */
export function storeSubdomain(slug: string | null | undefined) {
  const root = checkoutRoot();
  const s = String(slug ?? "").toLowerCase();
  return root && LABEL_RE.test(s) ? `${s}.${root}` : null;
}

/** The slug in a request to <slug>.<CHECKOUT_DOMAIN>, if it is one. */
export function slugFromHost(host: string) {
  const root = checkoutRoot();
  if (!root || !host.endsWith(`.${root}`)) return null;
  const s = host.slice(0, -(root.length + 1));
  return LABEL_RE.test(s) ? s : null;
}

/**
 * The host a store's checkout lives on: its subdomain on Growpefy's checkout domain.
 * Stores' own domains (checkout.brand.com) are no longer used; old links on them redirect here.
 */
export function storeHost(store: Pick<Store, "checkoutDomain" | "slug">) {
  return storeSubdomain(store.slug);
}

/** Public base URL for a store's checkout: its subdomain, else the app URL. */
export function storeBaseUrl(store: Pick<Store, "checkoutDomain" | "slug">) {
  const host = storeHost(store);
  return host ? `https://${host}` : env.appUrl;
}

/** Hostname the request came in on (Railway sets x-forwarded-host). */
export function requestHost(request: Request) {
  const h = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return h.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}

export function appHost() {
  return new URL(env.appUrl).hostname.toLowerCase();
}

export function isAppHost(request: Request) {
  const host = requestHost(request);
  return host === appHost() || host === "localhost" || host === "127.0.0.1";
}

/** Same path + query on another base URL. */
export function sameUrlOn(base: string, request: Request) {
  const u = new URL(request.url);
  return `${base}${u.pathname}${u.search}`;
}

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
export function cleanDomain(v: string) {
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return HOST_RE.test(d) ? d : null;
}

/**
 * Customer pages are served on the store's subdomain; anything else (an old own domain too) redirects there.
 */
export function ensureStoreHost(request: Request, store: Pick<Store, "checkoutDomain" | "slug">) {
  const want = storeHost(store);
  if (!want) return;
  const host = requestHost(request);
  if (host === want || host === "localhost" || host === "127.0.0.1") return;
  throw new Response(null, { status: 302, headers: { Location: sameUrlOn(storeBaseUrl(store), request) } });
}

/**
 * Who may show the checkout in a popup (iframe): the store's own website (any subdomain of it),
 * its myshopify domain and Shopify's theme preview. Everyone else is blocked (no clickjacking).
 */
export function frameAncestors(store: Pick<Store, "storefrontUrl" | "shopDomain">) {
  const out = new Set(["'self'", `https://${store.shopDomain}`, "https://*.shopifypreview.com"]);
  try {
    const u = new URL(store.storefrontUrl);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    out.add(u.origin);
    if (h) { out.add(`https://${h}`); out.add(`https://*.${h}`); }
  } catch { /* bad storefront URL: only the defaults */ }
  if (process.env.NODE_ENV !== "production") out.add("http://localhost:*");
  return `frame-ancestors ${[...out].join(" ")}`;
}

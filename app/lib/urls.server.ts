import type { Store } from "~/db/schema";
import { env } from "./env.server";

/** Public base URL for a store's checkout: its own domain if set, else the app URL. */
export function storeBaseUrl(store: Pick<Store, "checkoutDomain">) {
  return store.checkoutDomain ? `https://${store.checkoutDomain}` : env.appUrl;
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

/** Customer pages must be served on the store's own checkout domain (PayU website match + trust). */
export function ensureStoreHost(request: Request, store: Pick<Store, "checkoutDomain">) {
  if (!store.checkoutDomain) return;
  const host = requestHost(request);
  if (host === store.checkoutDomain || host === "localhost" || host === "127.0.0.1") return;
  throw new Response(null, { status: 302, headers: { Location: sameUrlOn(storeBaseUrl(store), request) } });
}

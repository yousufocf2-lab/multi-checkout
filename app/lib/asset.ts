// Files from /public, from Growpefy's own address. Needed on pages shown on a store's domain
// (Shopify App Proxy), where "/brand/x.svg" would point at the store. In development this stays "/brand/x.svg".
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");
export const asset = (path: string) => `${BASE}${path}`;

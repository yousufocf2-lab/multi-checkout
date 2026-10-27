// One-click Shopify connect: the owner gives the store's .myshopify.com address and asks for credentials,
// Growpefy's team creates a custom-distribution app for that store and saves its install link. Browser-safe.

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Accepts what owners usually paste and returns xyz.myshopify.com:
 *  - abcd12-xy.myshopify.com (with or without https://)
 *  - admin.shopify.com/store/abcd12-xy/... (the address bar in Shopify admin)
 *  - abcd12-xy
 */
export function parseShopInput(raw: string): { shop: string } | { error: string } {
  let v = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (!v) return { error: "Enter your Shopify store address" };
  const admin = v.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) return { shop: `${admin[1]}.myshopify.com` };
  v = v.replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  if (SHOP_RE.test(v)) return { shop: v };
  if (/^[a-z0-9][a-z0-9-]*$/.test(v)) return { shop: `${v}.myshopify.com` };
  if (v.includes(".")) return { error: `${v} is your website address. We need the Shopify address that ends with .myshopify.com (see the steps below).` };
  return { error: "That doesn't look like a Shopify address. It looks like yourstore.myshopify.com." };
}

/** "Fusion Prime" → "fusion-prime" (lowercase, dashes for spaces, max 40). */
export function slugify(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

export const CONNECT_WA_TEMPLATES = {
  /** To Growpefy's own WhatsApp number when an owner asks for credentials. {{1}} brand, {{2}} Shopify address */
  request: {
    name: "growpefy_connect_request",
    text: "New store connect request 🔔\n\nBrand: {{1}}\nShopify: {{2}}\n\nOpen Growpefy admin → Connect requests to create the app and send the install link.",
  },
  /** To the store owner when the install link is saved. {{1}} name, {{2}} brand */
  ready: {
    name: "growpefy_store_ready",
    text: "Hi {{1}}, your Shopify connection for {{2}} is ready! ✅\n\nLog in at growpefy.com/login and click Connect store. Shopify will open, click Install and you're connected. It takes under a minute.\n\nNeed help? Reply to this message.",
  },
} as const;

import type { Order, Store } from "~/db/schema";
import { rupeesToPaise, type PricedLine } from "./pricing";

// ---------- auth ----------

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

/**
 * Returns an Admin API access token for the store.
 * - Static token (shpat_...) from a legacy custom app, or
 * - client_credentials grant for an app created in the Shopify Dev Dashboard.
 */
async function getAccessToken(store: Store): Promise<string> {
  if (store.adminToken) return store.adminToken;
  if (!store.clientId || !store.clientSecret) {
    throw new Error("Store has no Shopify credentials (admin token or client id/secret)");
  }
  const cached = tokenCache.get(store.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`https://${store.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: store.clientId,
      client_secret: store.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Shopify token error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache.set(store.id, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

export function clearTokenCache(storeId: number) {
  tokenCache.delete(storeId);
}

async function adminGraphql<T>(store: Store, query: string, variables?: unknown): Promise<T> {
  const token = await getAccessToken(store);
  const res = await fetch(
    `https://${store.shopDomain}/admin/api/${store.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (res.status === 401) clearTokenCache(store.id);
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// ---------- reads ----------

export async function testConnection(store: Store) {
  const data = await adminGraphql<{ shop: { name: string; currencyCode: string } }>(
    store,
    `{ shop { name currencyCode } }`,
  );
  return data.shop;
}

type VariantNode = {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  image: { url: string } | null;
  product: { title: string; featuredImage: { url: string } | null };
} | null;

/** Re-reads live prices from Shopify — never trust prices sent from the browser. */
export async function fetchLines(
  store: Store,
  items: { variantId: string; quantity: number }[],
): Promise<PricedLine[]> {
  if (!items.length) return [];
  const ids = items.map((i) => `gid://shopify/ProductVariant/${i.variantId}`);
  const data = await adminGraphql<{ nodes: VariantNode[] }>(
    store,
    `query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id title price compareAtPrice availableForSale
          image { url(transform: { maxWidth: 200 }) }
          product { title featuredImage { url(transform: { maxWidth: 200 }) } }
        }
      }
    }`,
    { ids },
  );

  const lines: PricedLine[] = [];
  data.nodes.forEach((n, idx) => {
    if (!n || !n.id) return;
    const price = rupeesToPaise(n.price) ?? 0;
    const compare = rupeesToPaise(n.compareAtPrice);
    lines.push({
      variantId: items[idx].variantId,
      title: n.product.title,
      variantTitle: n.title === "Default Title" ? null : n.title,
      image: n.image?.url ?? n.product.featuredImage?.url ?? null,
      quantity: items[idx].quantity,
      pricePaise: price,
      comparePaise: compare && compare > price ? compare : null,
    });
  });
  return lines;
}

// ---------- order creation ----------

export async function createShopifyOrder(store: Store, order: Order) {
  const c = order.customer;
  const totalDiscount = order.paymentDiscount + order.couponDiscount + order.bankDiscount;
  const isCod = order.paymentMethod === "cod";

  const codeParts = [
    isCod ? `COD${store.codDiscountPct}` : `PREPAID${store.prepaidDiscountPct}`,
    order.couponCode,
    order.bankDiscount > 0 ? "BANKOFFER" : null,
  ].filter(Boolean);

  const address = {
    firstName: c.firstName,
    lastName: c.lastName || ".",
    address1: c.address1,
    address2: c.address2 || null,
    city: c.city,
    provinceCode: c.state,
    countryCode: "IN",
    zip: c.pincode,
    phone: `+91${c.phone}`,
  };

  const money = (paise: number) => ({
    shopMoney: { amount: (paise / 100).toFixed(2), currencyCode: "INR" },
  });

  const input: Record<string, unknown> = {
    lineItems: order.items.map((l) => ({
      variantId: `gid://shopify/ProductVariant/${l.variantId}`,
      quantity: l.quantity,
    })),
    email: c.email || null,
    phone: `+91${c.phone}`,
    shippingAddress: address,
    billingAddress: address,
    financialStatus: isCod ? "PENDING" : "PAID",
    tags: ["MultiCheckout", isCod ? "COD" : "Prepaid", order.couponCode].filter(Boolean),
    note: `Checkout order ${order.id}${order.payuMihpayid ? ` · PayU ${order.payuMihpayid}` : ""}`,
  };

  if (totalDiscount > 0) {
    input.discountCode = {
      itemFixedDiscountCode: { code: codeParts.join("+"), amountSet: money(totalDiscount) },
    };
  }

  if (!isCod) {
    input.transactions = [
      {
        kind: "SALE",
        status: "SUCCESS",
        gateway: "PayU",
        amountSet: money(order.amountPaid ?? order.total),
      },
    ];
  }

  const data = await adminGraphql<{
    orderCreate: {
      order: { id: string; name: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    store,
    `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { id name }
        userErrors { field message }
      }
    }`,
    {
      order: input,
      options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: Boolean(c.email) },
    },
  );

  const r = data.orderCreate;
  if (r.userErrors.length || !r.order) {
    throw new Error(r.userErrors.map((e) => e.message).join("; ") || "orderCreate failed");
  }
  return r.order;
}

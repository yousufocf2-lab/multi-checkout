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
  product: { id: string; title: string; featuredImage: { url: string } | null };
} | null;

const numId = (gid: string) => gid.split("/").pop() ?? gid;

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
          product { id title featuredImage { url(transform: { maxWidth: 200 }) } }
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
      productId: numId(n.product.id),
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

// ---------- product catalog (picker + upsell) ----------

export type CatalogVariant = { id: string; title: string; pricePaise: number; comparePaise: number | null; available: boolean };
export type CatalogProduct = { id: string; title: string; image: string | null; variants: CatalogVariant[] };

type ProductNode = {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: { nodes: { id: string; title: string; price: string; compareAtPrice: string | null; availableForSale: boolean }[] };
};

const PRODUCT_FIELDS = `id title featuredImage { url(transform: { maxWidth: 300 }) }
  variants(first: 20) { nodes { id title price compareAtPrice availableForSale } }`;

function toCatalog(p: ProductNode): CatalogProduct {
  return {
    id: numId(p.id),
    title: p.title,
    image: p.featuredImage?.url ?? null,
    variants: p.variants.nodes.map((v) => {
      const price = rupeesToPaise(v.price) ?? 0;
      const compare = rupeesToPaise(v.compareAtPrice);
      return {
        id: numId(v.id),
        title: v.title === "Default Title" ? "" : v.title,
        pricePaise: price,
        comparePaise: compare && compare > price ? compare : null,
        available: v.availableForSale,
      };
    }),
  };
}

/** Product search for the dashboard picker. */
export async function searchProducts(store: Store, q: string) {
  const term = q.trim().replace(/[\\"():*]/g, " ").replace(/\s+/g, " ").trim();
  const query = term ? `status:active AND ${term.split(" ").map((w) => `title:*${w}*`).join(" AND ")}` : "status:active";
  const data = await adminGraphql<{ products: { nodes: ProductNode[] } }>(
    store,
    `query($q: String!) { products(first: 20, query: $q, sortKey: TITLE) { nodes { ${PRODUCT_FIELDS} } } }`,
    { q: query },
  );
  return data.products.nodes.map(toCatalog);
}

const upsellCache = new Map<string, { at: number; items: CatalogProduct[] }>();

/** Products shown under "You may also like": chosen list, or the newest active products. */
export async function fetchUpsellProducts(store: Store, chosenIds: string[]) {
  const key = `${store.id}:${chosenIds.join(",")}`;
  const hit = upsellCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.items;

  let items: CatalogProduct[];
  if (chosenIds.length) {
    const data = await adminGraphql<{ nodes: (ProductNode | null)[] }>(
      store,
      `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} status } } }`,
      { ids: chosenIds.map((id) => `gid://shopify/Product/${id}`) },
    );
    items = data.nodes.filter((n): n is ProductNode => Boolean(n?.id)).map(toCatalog);
  } else {
    const data = await adminGraphql<{ products: { nodes: ProductNode[] } }>(
      store,
      `{ products(first: 12, query: "status:active", sortKey: CREATED_AT, reverse: true) { nodes { ${PRODUCT_FIELDS} } } }`,
    );
    items = data.products.nodes.map(toCatalog);
  }
  items = items.filter((p) => p.variants.some((v) => v.available));
  upsellCache.set(key, { at: Date.now(), items });
  return items;
}

// ---------- order creation ----------

export async function createShopifyOrder(store: Store, order: Order) {
  const c = order.customer;
  const totalDiscount = order.paymentDiscount + order.couponDiscount + order.bankDiscount + order.offerDiscount;
  const isCod = order.paymentMethod === "cod";

  const codeParts = [
    order.paymentDiscount > 0 ? (isCod ? `COD${store.codDiscountPct}` : `PREPAID${store.prepaidDiscountPct}`) : null,
    order.couponCode,
    order.bankDiscount > 0 ? "BANKOFFER" : null,
    order.offerDiscount > 0 ? "MIXMATCH" : null,
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
      // Without this Shopify marks the item "Shipping not required" and the Delivery method shows nothing
      requiresShipping: true,
      // Free gifts from offers go in at ₹0
      ...(l.free ? { priceSet: money(0), properties: [{ name: "Free gift", value: l.offer ?? "Offer" }] } : {}),
    })),
    email: c.email || null,
    phone: `+91${c.phone}`,
    // Create / match the Shopify customer by phone (and email when given). Without this, orders without
    // an email show "No customer" in Shopify.
    customer: {
      toUpsert: {
        firstName: c.firstName,
        lastName: c.lastName || null,
        phone: `+91${c.phone}`,
        ...(c.email ? { email: c.email } : {}),
      },
    },
    shippingAddress: address,
    billingAddress: address,
    financialStatus: isCod ? "PENDING" : "PAID",
    tags: ["Growpefy", isCod ? "COD" : "Prepaid", order.couponCode, order.items.some((l) => l.free) ? "FreeGift" : null].filter(Boolean),
    note: `Checkout order ${order.id}${order.payuMihpayid ? `, PayU ${order.payuMihpayid}` : ""}`,
    // Without a shipping line Shopify shows "Shipping not required" and fulfilment apps skip the order
    shippingLines: [
      {
        title: order.shippingTitle || "Standard",
        code: order.shipping > 0 ? "STANDARD" : "FREE",
        source: "Growpefy",
        priceSet: money(order.shipping),
      },
    ],
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

  const create = (orderInput: Record<string, unknown>) => adminGraphql<{
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
      order: orderInput,
      options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: Boolean(c.email) },
    },
  );

  const { customer: _skip, ...withoutCustomer } = input;
  let data;
  try {
    data = await create(input);
  } catch (e) {
    // Older API versions (before 2025-01) don't know the customer field: create the order without it
    if (!(e instanceof Error && /customer/i.test(e.message))) throw e;
    console.warn(`[shopify] order ${order.id}: customer field not supported (${e.message}), retrying without it`);
    data = await create(withoutCustomer);
  }
  // If Shopify rejects only the customer details, still create the order
  if (!data.orderCreate.order && data.orderCreate.userErrors.some((e) => e.field?.includes("customer"))) {
    console.warn(`[shopify] order ${order.id}: customer rejected (${data.orderCreate.userErrors.map((e) => e.message).join("; ")}), retrying without it`);
    data = await create(withoutCustomer);
  }

  const r = data.orderCreate;
  if (r.userErrors.length || !r.order) {
    throw new Error(r.userErrors.map((e) => e.message).join("; ") || "orderCreate failed");
  }
  return r.order;
}
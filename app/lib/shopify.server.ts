import type { Order, Store } from "~/db/schema";
import { rupeesToPaise, type PricedLine } from "./pricing";
import { gatewayName } from "./gateways/catalog";

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

/** One order from the store's own Shopify checkout (orders Growpefy created are left out). */
export type NativeOrder = {
  id: string; name: string; createdAt: string; totalPaise: number; prepaid: boolean;
  financialStatus: string | null; gateway: string | null; cancelled: boolean;
};

/**
 * Orders placed on the store's own Shopify checkout since `sinceIso`, oldest first.
 * Shopify only returns the last 60 days unless the app has read_all_orders.
 */
export async function fetchNativeOrders(store: Store, sinceIso: string, maxPages = 40) {
  type Node = {
    id: string; name: string; createdAt: string; tags: string[]; cancelledAt: string | null; test: boolean;
    displayFinancialStatus: string | null; paymentGatewayNames: string[];
    currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  };
  type Page = { orders: { edges: { node: Node }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
  const out: NativeOrder[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: Page = await adminGraphql<Page>(store,
      `query($first:Int!,$after:String,$q:String!){orders(first:$first,after:$after,query:$q,sortKey:CREATED_AT){edges{node{id name createdAt tags cancelledAt test displayFinancialStatus paymentGatewayNames currentTotalPriceSet{shopMoney{amount currencyCode}}}} pageInfo{hasNextPage endCursor}}}`,
      { first: 250, after: cursor, q: `created_at:>='${sinceIso}'` });
    for (const { node } of data.orders.edges) {
      if (node.test || node.tags.some((t) => t.toLowerCase() === "growpefy")) continue;
      const gateways = node.paymentGatewayNames ?? [];
      const status = node.displayFinancialStatus ?? null;
      const cod = gateways.some((g) => /cash on delivery|\bcod\b|manual/i.test(g));
      out.push({
        id: node.id.replace(/\D/g, ""), name: node.name, createdAt: node.createdAt,
        totalPaise: Math.round(Number(node.currentTotalPriceSet.shopMoney.amount) * 100),
        prepaid: !cod && (status === "PAID" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED" || status === "PARTIALLY_PAID"),
        financialStatus: status, gateway: gateways.join(", ").slice(0, 120) || null, cancelled: Boolean(node.cancelledAt),
      });
    }
    if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) return { orders: out, complete: true };
    cursor = data.orders.pageInfo.endCursor;
  }
  return { orders: out, complete: false };
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
  const isPartial = order.paymentMethod === "partial";
  const feeLabel = isPartial ? "Partial COD charges" : isCod ? "COD charges" : "Payment charges";

  const codeParts = [
    order.paymentDiscount > 0 ? (isPartial ? "PARTIALCOD" : isCod ? `COD${store.codDiscountPct}` : `PREPAID${store.prepaidDiscountPct}`) : null,
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
    })).concat(order.paymentFee > 0 ? [
      // Payment method fee (e.g. COD charges) as its own line
      { title: feeLabel, quantity: 1, priceSet: money(order.paymentFee), requiresShipping: false, taxable: false } as never,
    ] : []),
    email: c.email || null,
    phone: `+91${c.phone}`,
    // Create / match the Shopify customer. Shopify's customer upsert needs an email (or a customer id), so
    // orders without an email skip it and keep the phone and address on the order itself.
    ...(c.email ? {
      customer: {
        toUpsert: {
          firstName: c.firstName,
          lastName: c.lastName || null,
          phone: `+91${c.phone}`,
          email: c.email,
        },
      },
    } : {}),
    shippingAddress: address,
    billingAddress: address,
    financialStatus: isCod ? "PENDING" : isPartial ? "PARTIALLY_PAID" : "PAID",
    tags: ["Growpefy", isCod ? "COD" : isPartial ? "Partial COD" : "Prepaid", order.couponCode, order.items.some((l) => l.free) ? "FreeGift" : null].filter(Boolean),
    note: `Checkout order ${order.id}${order.gatewayRef || order.payuMihpayid ? `, ${gatewayName(order.gateway ?? "payu")} ${order.gatewayRef ?? order.payuMihpayid}` : ""}${isPartial ? `. Partial COD: advance ₹${((order.amountPaid ?? order.advance ?? 0) / 100).toFixed(2)} paid online, collect ₹${((order.total - (order.advance ?? 0)) / 100).toFixed(2)} on delivery` : ""}`,
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
        gateway: gatewayName(order.gateway ?? "payu"),
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
// ---------- fulfillment tracking (for courier sync) ----------

export type OrderTracking = {
  orderId: string;
  tags: string[];
  cancelled: boolean;
  /** Latest fulfillment first. */
  fulfillments: { status: string | null; updatedAt: string | null; tracking: { number: string; company: string | null; url: string | null }[] }[];
  tracking: { number: string; company: string | null; url: string | null }[];
};

/** AWB numbers, courier names and fulfillment statuses for up to 50 orders (Order GIDs). */
export async function fetchFulfillmentTracking(store: Store, orderGids: string[]): Promise<OrderTracking[]> {
  if (!orderGids.length) return [];
  type F = { displayStatus: string | null; updatedAt: string | null; trackingInfo: { number: string | null; company: string | null; url: string | null }[] };
  const data = await adminGraphql<{ nodes: ({ id: string; tags: string[]; cancelledAt: string | null; fulfillments: F[] } | null)[] }>(
    store,
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id tags cancelledAt fulfillments(first: 5) { displayStatus updatedAt trackingInfo(first: 3) { number company url } } } } }`,
    { ids: orderGids.slice(0, 50) },
  );
  return data.nodes
    .filter((n): n is NonNullable<typeof n> => Boolean(n?.id))
    .map((n) => {
      const fulfillments = [...(n.fulfillments ?? [])]
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
        .map((f) => ({
          status: f.displayStatus,
          updatedAt: f.updatedAt,
          tracking: (f.trackingInfo ?? []).filter((t) => t.number).map((t) => ({ number: String(t.number).trim(), company: t.company, url: t.url })),
        }));
      return { orderId: n.id, tags: n.tags ?? [], cancelled: Boolean(n.cancelledAt), fulfillments, tracking: fulfillments.flatMap((f) => f.tracking) };
    });
}

// ---------- order updates (WhatsApp confirmation replies) ----------

export const orderGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`);

/** Adds tags to a Shopify order. Never throws; returns an error message or null. */
export async function tagShopifyOrder(store: Store, shopifyOrderId: string, tags: string[]) {
  try {
    const d = await adminGraphql<{ tagsAdd: { userErrors: { message: string }[] } }>(
      store,
      `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
      { id: orderGid(shopifyOrderId), tags },
    );
    return d.tagsAdd.userErrors[0]?.message ?? null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Cancels a Shopify order (customer cancelled on WhatsApp): no refund, items restocked, no Shopify email. */
export async function cancelShopifyOrder(store: Store, shopifyOrderId: string, note: string) {
  try {
    const d = await adminGraphql<{ orderCancel: { orderCancelUserErrors?: { message: string }[]; userErrors?: { message: string }[] } }>(
      store,
      `mutation($id: ID!, $note: String) {
        orderCancel(orderId: $id, reason: CUSTOMER, refund: false, restock: true, notifyCustomer: false, staffNote: $note) {
          orderCancelUserErrors { message }
        }
      }`,
      { id: orderGid(shopifyOrderId), note },
    );
    return d.orderCancel.orderCancelUserErrors?.[0]?.message ?? null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------- dropshipping ----------

/** SKU of each variant (variant id → SKU, empty when the variant has none). */
export async function fetchVariantSkus(store: Store, variantIds: string[]) {
  const ids = [...new Set(variantIds.filter(Boolean))].slice(0, 100);
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const data = await adminGraphql<{ nodes: ({ id: string; sku: string | null } | null)[] }>(
    store,
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id sku } } }`,
    { ids: ids.map((v) => (v.startsWith("gid://") ? v : `gid://shopify/ProductVariant/${v}`)) },
  );
  for (const n of data.nodes) if (n?.id) out.set(numId(n.id), (n.sku ?? "").trim());
  return out;
}

export type FulfilResult = { ok: true; already: boolean } | { ok: false; cancelled?: boolean; error: string };

/**
 * Marks every open fulfillment order of a Shopify order as fulfilled with a tracking number.
 * The customer gets no Shopify shipping email.
 */
export async function fulfilShopifyOrder(store: Store, shopifyOrderId: string, tracking: { number: string; company: string }): Promise<FulfilResult> {
  type FO = { id: string; status: string };
  const q = await adminGraphql<{ order: { cancelledAt: string | null; displayFulfillmentStatus: string; fulfillmentOrders: { nodes: FO[] } } | null }>(
    store,
    `query($id: ID!) { order(id: $id) { cancelledAt displayFulfillmentStatus fulfillmentOrders(first: 20) { nodes { id status } } } }`,
    { id: orderGid(shopifyOrderId) },
  );
  const o = q.order;
  if (!o) return { ok: false, error: "Order not found in Shopify" };
  if (o.cancelledAt) return { ok: false, cancelled: true, error: "Order is cancelled in Shopify" };
  const open = o.fulfillmentOrders.nodes.filter((f) => f.status === "OPEN" || f.status === "IN_PROGRESS");
  if (!open.length) {
    if (o.displayFulfillmentStatus === "FULFILLED") return { ok: true, already: true };
    const held = o.fulfillmentOrders.nodes.find((f) => f.status === "ON_HOLD" || f.status === "SCHEDULED");
    return { ok: false, error: held ? `Fulfillment is ${held.status.toLowerCase().replace("_", " ")} in Shopify` : "Nothing to fulfil in Shopify" };
  }
  const d = await adminGraphql<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: { message: string }[] } }>(
    store,
    `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
    { f: { lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })), notifyCustomer: false, trackingInfo: { number: tracking.number, company: tracking.company } } },
  );
  const err = d.fulfillmentCreate.userErrors[0]?.message;
  if (err || !d.fulfillmentCreate.fulfillment) return { ok: false, error: err ?? "fulfillmentCreate failed" };
  return { ok: true, already: false };
}

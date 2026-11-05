// One place that picks Shopify or WooCommerce for a store. Everything else calls these.
import type { Order, Store } from "~/db/schema";
import type { FulfilResult } from "./shopify.server";
import * as shopify from "./shopify.server";
import * as woo from "./woo.server";
import { catalogLines, catalogSkus, isCatalogVariant, placeCatalogOrder } from "./catalog.server";

// Growpefy Store lines/orders ("gp:" ids) are served from our own catalog, whatever platform the store was connected with.
const isGpOrder = (id: string) => id.includes("gp:");

export type Platform = "shopify" | "woocommerce";
export const PLATFORM_NAME: Record<Platform, string> = { shopify: "Shopify", woocommerce: "WooCommerce" };

export const isWoo = (s: Pick<Store, "platform">) => s.platform === "woocommerce";
export const platformName = (s: Pick<Store, "platform">) => PLATFORM_NAME[isWoo(s) ? "woocommerce" : "shopify"];

/** Store has working credentials, so we can read products and create orders. */
export function storeConnected(s: Store) {
  return isWoo(s) ? Boolean(s.wooSecret) : Boolean(s.adminToken || (s.clientId && s.clientSecret));
}

export function testConnection(s: Store): Promise<{ name: string; currencyCode: string }> {
  return isWoo(s) ? woo.testConnection(s) : shopify.testConnection(s);
}

export async function fetchLines(s: Store, items: { variantId: string; quantity: number }[]) {
  const own = items.filter((i) => isCatalogVariant(i.variantId));
  const rest = items.filter((i) => !isCatalogVariant(i.variantId));
  const [a, b] = await Promise.all([
    own.length ? catalogLines(s, own) : [],
    rest.length ? (isWoo(s) ? woo.fetchLines(s, rest) : shopify.fetchLines(s, rest)) : [],
  ]);
  const byId = new Map([...a, ...b].map((l) => [l.variantId, l]));
  return items.flatMap((i) => (byId.has(i.variantId) ? [byId.get(i.variantId)!] : []));
}

export function searchProducts(s: Store, q: string) {
  return isWoo(s) ? woo.searchProducts(s, q) : shopify.searchProducts(s, q);
}

export function fetchUpsellProducts(s: Store, chosenIds: string[]) {
  return isWoo(s) ? woo.fetchUpsellProducts(s, chosenIds) : shopify.fetchUpsellProducts(s, chosenIds);
}

/** Creates the order in the store's platform. `name` is what the store calls it (#1001). */
export function createStoreOrder(s: Store, order: Order): Promise<{ id: string; name: string }> {
  if (order.items.length && order.items.every((l) => isCatalogVariant(l.variantId))) return placeCatalogOrder(s, order);
  return isWoo(s) ? woo.createOrder(s, order) : shopify.createShopifyOrder(s, order);
}

export async function tagStoreOrder(s: Store, orderId: string, tags: string[]): Promise<string | null> {
  if (isGpOrder(orderId)) return null;
  return isWoo(s) ? woo.tagOrder(s, orderId, tags) : shopify.tagShopifyOrder(s, orderId, tags);
}

export async function cancelStoreOrder(s: Store, orderId: string, note: string): Promise<string | null> {
  if (isGpOrder(orderId)) return null;
  return isWoo(s) ? woo.cancelOrder(s, orderId, note) : shopify.cancelShopifyOrder(s, orderId, note);
}

export async function fetchVariantSkus(s: Store, variantIds: string[]) {
  const rest = variantIds.filter((v) => !isCatalogVariant(v));
  const [own, other] = await Promise.all([catalogSkus(s, variantIds), rest.length ? (isWoo(s) ? woo.fetchVariantSkus(s, rest) : shopify.fetchVariantSkus(s, rest)) : new Map<string, string>()]);
  return new Map([...other, ...own]);
}

/** Tracking + status for store orders. `orderId` in the result is the same string the caller passed. */
export async function fetchFulfillmentTracking(s: Store, orderIds: string[]) {
  orderIds = orderIds.filter((id) => !isGpOrder(id));
  if (!orderIds.length) return [];
  return isWoo(s) ? woo.fetchTracking(s, orderIds) : shopify.fetchFulfillmentTracking(s, orderIds);
}

export async function fulfilStoreOrder(s: Store, orderId: string, tracking: { number: string; company: string }): Promise<FulfilResult> {
  if (isGpOrder(orderId)) return { ok: true, already: false };
  return isWoo(s) ? woo.fulfilOrder(s, orderId, tracking) : shopify.fulfilShopifyOrder(s, orderId, tracking);
}

export const clearTokenCache = shopify.clearTokenCache;
export const orderGid = shopify.orderGid;
export type { CatalogProduct, OrderTracking, FulfilResult } from "./shopify.server";

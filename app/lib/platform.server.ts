// One place that picks Shopify or WooCommerce for a store. Everything else calls these.
import type { Order, Store } from "~/db/schema";
import * as shopify from "./shopify.server";
import * as woo from "./woo.server";

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

export function fetchLines(s: Store, items: { variantId: string; quantity: number }[]) {
  return isWoo(s) ? woo.fetchLines(s, items) : shopify.fetchLines(s, items);
}

export function searchProducts(s: Store, q: string) {
  return isWoo(s) ? woo.searchProducts(s, q) : shopify.searchProducts(s, q);
}

export function fetchUpsellProducts(s: Store, chosenIds: string[]) {
  return isWoo(s) ? woo.fetchUpsellProducts(s, chosenIds) : shopify.fetchUpsellProducts(s, chosenIds);
}

/** Creates the order in the store's platform. `name` is what the store calls it (#1001). */
export function createStoreOrder(s: Store, order: Order): Promise<{ id: string; name: string }> {
  return isWoo(s) ? woo.createOrder(s, order) : shopify.createShopifyOrder(s, order);
}

export function tagStoreOrder(s: Store, orderId: string, tags: string[]) {
  return isWoo(s) ? woo.tagOrder(s, orderId, tags) : shopify.tagShopifyOrder(s, orderId, tags);
}

export function cancelStoreOrder(s: Store, orderId: string, note: string) {
  return isWoo(s) ? woo.cancelOrder(s, orderId, note) : shopify.cancelShopifyOrder(s, orderId, note);
}

export function fetchVariantSkus(s: Store, variantIds: string[]) {
  return isWoo(s) ? woo.fetchVariantSkus(s, variantIds) : shopify.fetchVariantSkus(s, variantIds);
}

/** Tracking + status for store orders. `orderId` in the result is the same string the caller passed. */
export function fetchFulfillmentTracking(s: Store, orderIds: string[]) {
  return isWoo(s) ? woo.fetchTracking(s, orderIds) : shopify.fetchFulfillmentTracking(s, orderIds);
}

export function fulfilStoreOrder(s: Store, orderId: string, tracking: { number: string; company: string }) {
  return isWoo(s) ? woo.fulfilOrder(s, orderId, tracking) : shopify.fulfilShopifyOrder(s, orderId, tracking);
}

export const clearTokenCache = shopify.clearTokenCache;
export const orderGid = shopify.orderGid;
export type { CatalogProduct, OrderTracking, FulfilResult } from "./shopify.server";

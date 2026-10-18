import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CheckoutTheme } from "~/lib/theme";

/** A product reference saved with rules / coupons / upsells (for display + matching). */
export type ProductRef = { id: string; title: string; image: string | null };

/** Store owners who log in to the dashboard. The super admin logs in via env vars. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(), // lowercase
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per connected Shopify store. */
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shopDomain: text("shop_domain").notNull(), // xyz.myshopify.com
  storefrontUrl: text("storefront_url").notNull(), // https://brand.com
  checkoutDomain: text("checkout_domain").unique(), // e.g. checkout.brand.com (CNAME -> Railway)
  // Shopify auth: either a static Admin API token (shpat_...) or client id + secret
  adminToken: text("admin_token"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  apiVersion: text("api_version").notNull().default("2025-07"),
  // Branding
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").notNull().default("#111827"),
  supportPhone: text("support_phone"),
  theme: jsonb("theme").$type<Partial<CheckoutTheme>>().notNull().default({}), // checkout design, see lib/theme.ts
  // Discounts (whole percentages)
  prepaidDiscountPct: integer("prepaid_discount_pct").notNull().default(70),
  codDiscountPct: integer("cod_discount_pct").notNull().default(10),
  codEnabled: boolean("cod_enabled").notNull().default(true),
  codCooldownHours: integer("cod_cooldown_hours").notNull().default(6), // 1 .. 8760
  codBlockAfterPrepaid: boolean("cod_block_after_prepaid").notNull().default(true),
  // Checkout upsell ("You may also like")
  upsellEnabled: boolean("upsell_enabled").notNull().default(true),
  upsellProducts: jsonb("upsell_products").$type<ProductRef[]>().notNull().default([]),
  // Mix & Match deal: any `mixBuyQty` items in the cart → `mixFreeQty` of them free (cheapest or priciest)
  mixEnabled: boolean("mix_enabled").notNull().default(false),
  mixBuyQty: integer("mix_buy_qty").notNull().default(3), // min 2
  mixFreeQty: integer("mix_free_qty").notNull().default(1), // 1 .. mixBuyQty-1
  mixFreeWhich: text("mix_free_which").notNull().default("low"), // low | high
  mixTitle: text("mix_title"), // shown at checkout; default "Buy 3, Get 2 Free"
  // PayU
  payuKey: text("payu_key"),
  payuSalt: text("payu_salt"),
  payuMode: text("payu_mode").notNull().default("test"), // test | live
  // Meta (Facebook) ads
  metaAdAccountId: text("meta_ad_account_id"), // digits only, without act_
  metaAccessToken: text("meta_access_token"), // System User token: ads_read (+ ads_management for CAPI)
  metaPixelId: text("meta_pixel_id"),
  metaCapiToken: text("meta_capi_token"), // optional; falls back to metaAccessToken
  metaApiVersion: text("meta_api_version").notNull().default("v23.0"),
  metaFireCodPurchase: boolean("meta_fire_cod_purchase").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Coupon codes, per store. Money fields are whole rupees. */
export const coupons = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // stored uppercase
    description: text("description"),
    type: text("type").notNull().default("percent"), // percent | flat
    value: integer("value").notNull(),
    minCartRupees: integer("min_cart_rupees").notNull().default(0),
    maxDiscountRupees: integer("max_discount_rupees"),
    stackable: boolean("stackable").notNull().default(true),
    paymentRestriction: text("payment_restriction").notNull().default("any"), // any | prepaid | cod
    showInList: boolean("show_in_list").notNull().default(true),
    products: jsonb("products").$type<ProductRef[]>(), // null/empty = all products
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("coupons_store_code_idx").on(t.storeId, t.code)],
);

/**
 * Free gift offers: "Buy 1 get 1", "Buy 2 get 1"…
 * When the cart has at least minQty of the qualifying products (or of anything, buyMode "any"),
 * each free product is added at ₹0 (freeQty each). With repeat on, buy 4 of a "buy 2 get 1" gets 2.
 */
export const freeOffers = pgTable("free_offers", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  buyMode: text("buy_mode").notNull().default("products"), // products | any
  buyProducts: jsonb("buy_products").$type<ProductRef[]>().notNull().default([]),
  minQty: integer("min_qty").notNull().default(1),
  freeProducts: jsonb("free_products").$type<ProductRef[]>().notNull(),
  freeQty: integer("free_qty").notNull().default(1),
  repeat: boolean("repeat").notNull().default(false),
  paymentRestriction: text("payment_restriction").notNull().default("any"), // any | prepaid | cod
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Product-level payment discounts. Lines not matched by a rule use the store default. */
export const discountRules = pgTable("discount_rules", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  products: jsonb("products").$type<ProductRef[]>().notNull(),
  type: text("type").notNull().default("percent"), // percent | flat (₹ off each item)
  prepaidPct: integer("prepaid_pct").notNull(), // % off, or rupees off per item when type = flat
  codPct: integer("cod_pct").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-store memory of a customer (by phone) for COD rules. */
export const customerFlags = pgTable(
  "customer_flags",
  {
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(), // 10 digits
    prepaidAt: timestamp("prepaid_at", { withTimezone: true }),
    lastCodAt: timestamp("last_cod_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.phone] })],
);

/** Bank / card offers. Enforced by PayU's Offer Engine via payu_offer_key. */
export const bankOffers = pgTable("bank_offers", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  bankName: text("bank_name").notNull(), // e.g. Kotak, RBL
  title: text("title").notNull(), // e.g. "Extra 10% off on Kotak credit cards"
  type: text("type").notNull().default("percent"), // percent | flat (display estimate)
  value: integer("value").notNull(),
  maxDiscountRupees: integer("max_discount_rupees"),
  minCartRupees: integer("min_cart_rupees").notNull().default(0),
  payuOfferKey: text("payu_offer_key"),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cart snapshot sent from the storefront. Prices are re-read from Shopify. */
export const checkoutSessions = pgTable("checkout_sessions", {
  id: text("id").primaryKey(),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  items: jsonb("items").$type<{ variantId: string; quantity: number }[]>().notNull(),
  tracking: jsonb("tracking").$type<TrackingInfo>(),
  // Captured while the customer fills the form (for abandoned checkout recovery)
  customer: jsonb("customer").$type<Partial<OrderCustomer>>(),
  cartSnapshot: jsonb("cart_snapshot").$type<{ title: string; variantTitle: string | null; image: string | null; quantity: number; pricePaise: number }[]>(),
  cartValue: integer("cart_value"), // paise, selling price before discounts
  paymentAttempted: boolean("payment_attempted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Store shipping rules. The cheapest matching rule applies; no rules = free delivery. */
export const shippingRates = pgTable("shipping_rates", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // shown to customer, e.g. "Standard delivery"
  pricePaise: integer("price_paise").notNull().default(0),
  minOrderRupees: integer("min_order_rupees").notNull().default(0),
  maxOrderRupees: integer("max_order_rupees"), // null = no upper limit
  states: jsonb("states").$type<string[]>().notNull().default([]), // province codes; empty = all India
  pincodePrefixes: jsonb("pincode_prefixes").$type<string[]>().notNull().default([]),
  paymentMethod: text("payment_method").notNull().default("any"), // any | prepaid | cod
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Raw payment notifications (PayU webhooks, callbacks, verifications) for audit/debugging. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
    orderId: text("order_id"),
    source: text("source").notNull(), // webhook | callback | verify
    kind: text("kind").notNull(), // payment | refund | unknown
    status: text("status"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payment_events_store_idx").on(t.storeId, t.createdAt)],
);

export type TrackingInfo = {
  fbp?: string;
  fbc?: string;
  ip?: string;
  ua?: string;
  sourceUrl?: string;
};

export type OrderCustomer = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string; // Shopify province code, e.g. UP
  pincode: string;
};

export type OrderLine = {
  variantId: string;
  productId?: string;
  title: string;
  variantTitle: string | null;
  image: string | null;
  quantity: number;
  pricePaise: number;
  comparePaise: number | null;
  free?: boolean; // free gift from an offer (price 0)
  offer?: string; // offer name, for free gifts
};

/** Orders placed through this checkout. Money fields are paise. */
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // also used as PayU txnid
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    status: text("status").notNull(), // pending_payment | paid | failed | cod_placed
    paymentMethod: text("payment_method").notNull(), // prepaid | cod
    customer: jsonb("customer").$type<OrderCustomer>().notNull(),
    items: jsonb("items").$type<OrderLine[]>().notNull(),
    subtotal: integer("subtotal").notNull(),
    paymentDiscount: integer("payment_discount").notNull().default(0),
    couponCode: text("coupon_code"),
    couponDiscount: integer("coupon_discount").notNull().default(0),
    bankDiscount: integer("bank_discount").notNull().default(0),
    offerDiscount: integer("offer_discount").notNull().default(0), // Mix & Match free items
    shipping: integer("shipping").notNull().default(0), // paise, included in total
    shippingTitle: text("shipping_title"),
    total: integer("total").notNull(), // amount sent to PayU / collected on COD (items + shipping)
    refunded: integer("refunded").notNull().default(0), // paise
    refundStatus: text("refund_status"), // partial | full | pending
    amountPaid: integer("amount_paid"),
    payuMihpayid: text("payu_mihpayid"),
    payuRaw: jsonb("payu_raw").$type<Record<string, string>>(),
    shopifyOrderId: text("shopify_order_id"),
    shopifyOrderName: text("shopify_order_name"),
    error: text("error"),
    tracking: jsonb("tracking").$type<TrackingInfo>(),
    capiSentAt: timestamp("capi_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_store_created_idx").on(t.storeId, t.createdAt),
    index("orders_session_idx").on(t.sessionId),
    index("orders_store_phone_idx").on(t.storeId, sql`(customer->>'phone')`),
  ],
);

/** Meta ad account balance readings, used to detect prepaid recharges. Money is paise. */
export const metaSnapshots = pgTable(
  "meta_snapshots",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    availablePaise: bigint("available_paise", { mode: "number" }).notNull(), // prepaid funds left
    spentPaise: bigint("spent_paise", { mode: "number" }).notNull(), // lifetime amount_spent
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meta_snapshots_store_idx").on(t.storeId, t.takenAt)],
);

/** Meta ad account recharges. amount = what was paid (incl. GST), credit = what reached the ad account. */
export const metaRecharges = pgTable(
  "meta_recharges",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    creditPaise: bigint("credit_paise", { mode: "number" }).notNull(),
    source: text("source").notNull(), // auto | manual
    note: text("note"),
    rechargedAt: timestamp("recharged_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meta_recharges_store_idx").on(t.storeId, t.rechargedAt)],
);

export type Store = typeof stores.$inferSelect;
export type MetaRecharge = typeof metaRecharges.$inferSelect;
export type FreeOffer = typeof freeOffers.$inferSelect;
export type User = typeof users.$inferSelect;
export type DiscountRule = typeof discountRules.$inferSelect;
export type ShippingRate = typeof shippingRates.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type BankOffer = typeof bankOffers.$inferSelect;
export type Order = typeof orders.$inferSelect;

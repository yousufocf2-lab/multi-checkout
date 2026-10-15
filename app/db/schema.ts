import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** One row per connected Shopify store. */
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
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
  // Discounts (whole percentages)
  prepaidDiscountPct: integer("prepaid_discount_pct").notNull().default(70),
  codDiscountPct: integer("cod_discount_pct").notNull().default(10),
  codEnabled: boolean("cod_enabled").notNull().default(true),
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
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("coupons_store_code_idx").on(t.storeId, t.code)],
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  title: string;
  variantTitle: string | null;
  image: string | null;
  quantity: number;
  pricePaise: number;
  comparePaise: number | null;
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
    total: integer("total").notNull(), // amount sent to PayU / collected on COD
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
  (t) => [index("orders_store_created_idx").on(t.storeId, t.createdAt)],
);

export type Store = typeof stores.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type BankOffer = typeof bankOffers.$inferSelect;
export type Order = typeof orders.$inferSelect;

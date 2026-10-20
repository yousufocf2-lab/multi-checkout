import type { PaymentMethodsSettings } from "~/lib/payment-methods";
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
import type { KycData, KycStatus } from "~/lib/kyc";
import type { RtoShieldSettings, ShipStatus } from "~/lib/rto-shield";

/** A product reference saved with rules / coupons / upsells (for display + matching). */
export type ProductRef = { id: string; title: string; image: string | null };

/** Store owners who log in to the dashboard. The super admin logs in via env vars. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique(), // lowercase; null when the owner signed up with a mobile number
  phone: text("phone").unique(), // 10 digits; null when the owner signed up with email
  signupWith: text("signup_with").notNull().default("email"), // email | phone (that field can't be edited)
  name: text("name").notNull(), // brand name at signup
  passwordHash: text("password_hash"), // null for OTP-only accounts
  kyc: jsonb("kyc").$type<KycData>().notNull().default({}),
  kycStatus: text("kyc_status").$type<KycStatus>().notNull().default("pending"),
  kycSubmittedAt: timestamp("kyc_submitted_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** OTPs for store owner signup / login (hashed). */
export const ownerOtps = pgTable(
  "owner_otps",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(), // phone | email
    target: text("target").notNull(), // 10-digit phone or lowercase email
    purpose: text("purpose").notNull(), // signup | login
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("owner_otps_target_idx").on(t.target, t.createdAt)],
);

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
  // Payment methods tab: Prepaid / COD / Partial COD on/off, discount or fee, coupons, show rules (lib/payment-methods.ts)
  paymentMethods: jsonb("payment_methods").$type<Partial<PaymentMethodsSettings>>().notNull().default({}),
  // RTO Suite
  codCooldownEnabled: boolean("cod_cooldown_enabled").notNull().default(true),
  otpEnabled: boolean("otp_enabled").notNull().default(false),
  otpPrepaid: boolean("otp_prepaid").notNull().default(false),
  otpCod: boolean("otp_cod").notNull().default(true),
  otpTiming: text("otp_timing").notNull().default("end"), // start (right after the mobile number) | end (before placing the order)
  blockEnabled: boolean("block_enabled").notNull().default(false),
  blockCodOnly: boolean("block_cod_only").notNull().default(true), // true: blocked customers lose COD only; false: can't order at all
  confirmEnabled: boolean("confirm_enabled").notNull().default(false),
  confirmWhatsapp: boolean("confirm_whatsapp").notNull().default(true),
  confirmWaPrepaid: boolean("confirm_wa_prepaid").notNull().default(true),
  confirmWaCod: boolean("confirm_wa_cod").notNull().default(true),
  confirmCall: boolean("confirm_call").notNull().default(false), // unlocks after 100 orders
  // RTO Shield: COD / order blocks from shipment history (unlocks when a courier is connected)
  rtoShield: jsonb("rto_shield").$type<Partial<RtoShieldSettings>>().notNull().default({}),
  // Checkout upsell ("You may also like")
  upsellEnabled: boolean("upsell_enabled").notNull().default(true),
  upsellProducts: jsonb("upsell_products").$type<ProductRef[]>().notNull().default([]),
  // Mix & Match deal: any `mixBuyQty` items in the cart → `mixFreeQty` of them free (cheapest or priciest)
  mixEnabled: boolean("mix_enabled").notNull().default(false),
  mixBuyQty: integer("mix_buy_qty").notNull().default(3), // min 2
  mixFreeQty: integer("mix_free_qty").notNull().default(1), // 1 .. mixBuyQty-1
  mixFreeWhich: text("mix_free_which").notNull().default("low"), // low | high
  mixTitle: text("mix_title"), // shown at checkout; default "Buy 3, Get 2 Free"
  mixKeepPrepaid: boolean("mix_keep_prepaid").notNull().default(true), // keep online payment discount when the deal applies
  mixKeepCod: boolean("mix_keep_cod").notNull().default(true), // keep COD discount when the deal applies
  // Per payment method: mixFreeQty / mixFreeWhich are for online payment, these for COD
  mixPrepaidOn: boolean("mix_prepaid_on").notNull().default(true),
  mixCodOn: boolean("mix_cod_on").notNull().default(true),
  mixCodFreeQty: integer("mix_cod_free_qty").notNull().default(1),
  mixCodFreeWhich: text("mix_cod_free_which").notNull().default("low"), // low | high
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

/** RTO Suite block list: one row per blocked phone / email / pincode / city / state / country (values normalised). */
export const blockedCustomers = pgTable(
  "blocked_customers",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // phone | email | pincode | city | state | country
    value: text("value").notNull(),
    source: text("source").notNull().default("manual"), // manual | csv
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("blocked_customers_uniq").on(t.storeId, t.kind, t.value),
  }),
);

/** Courier accounts connected by a store (API token from the courier's own panel). */
/** Courier login. Passwords are sealed (AES-GCM) before saving. Shopify-tracked couriers have no creds. */
export type CourierCreds = { token?: string; clientName?: string; email?: string; password?: string; clientId?: string; username?: string; label?: string };
export const courierAccounts = pgTable(
  "courier_accounts",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    courier: text("courier").notNull(), // see app/lib/courier-catalog.ts
    creds: jsonb("creds").$type<CourierCreds>().notNull(),
    status: text("status").notNull().default("connected"), // connected | error
    lastError: text("last_error"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("courier_accounts_store_courier").on(t.storeId, t.courier)],
);

/** Phones the store has let through RTO Shield (manual unblock). */
export const rtoShieldExempt = pgTable(
  "rto_shield_exempt",
  {
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.phone] })],
);

/**
 * Customer addresses saved at checkout, shared across every store on Growpefy (keyed by phone).
 * Shown masked until the customer verifies the phone with an OTP.
 */
export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: serial("id").primaryKey(),
    phone: text("phone").notNull(),
    addrKey: text("addr_key").notNull(), // normalised address1 + pincode, to avoid duplicates
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    email: text("email").notNull().default(""),
    address1: text("address1").notNull(),
    address2: text("address2").notNull().default(""),
    city: text("city").notNull(),
    state: text("state").notNull(), // province code
    pincode: text("pincode").notNull(),
    sourceStoreId: integer("source_store_id").references(() => stores.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_addresses_phone_key").on(t.phone, t.addrKey), index("customer_addresses_phone_idx").on(t.phone, t.lastUsedAt)],
);

/** Checkout OTPs (hashed). A verified row lets that session place an order with that phone. */
export const checkoutOtps = pgTable(
  "checkout_otps",
  {
    id: text("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySession: index("checkout_otps_session_idx").on(t.sessionId, t.phone),
  }),
);

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
  addrLookups: integer("addr_lookups").notNull().default(0), // saved-address lookups (rate limit)
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
    paymentMethod: text("payment_method").notNull(), // prepaid | cod | partial
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
    advance: integer("advance"), // Partial COD: paise paid online now; the rest (total - advance) is collected on delivery
    paymentFee: integer("payment_fee").notNull().default(0), // fee for the payment method (e.g. COD charges), included in total
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
    saveAddress: boolean("save_address").notNull().default(false), // customer agreed to save the address for next time
    // Shipment (from the connected courier)
    awb: text("awb"),
    courier: text("courier"),
    shipStatus: text("ship_status").$type<ShipStatus>(),
    shipStatusRaw: text("ship_status_raw"),
    shipStatusAt: timestamp("ship_status_at", { withTimezone: true }),
    shipCheckedAt: timestamp("ship_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_store_created_idx").on(t.storeId, t.createdAt),
    index("orders_store_ship_idx").on(t.storeId, t.shipStatus),
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

// ---------------- Wallet (platform billing) ----------------

/** Charges in paise; saleFeeBps is basis points of the order total (100 = 1%). */
export type WalletRates = { saleFeeBps: number; otp: number; waConfirm: number; waTracking: number; waPromo: number };
export type MessagingSettings = {
  msg91AuthKey?: string; msg91TemplateId?: string;
  // MSG91 OTP Widget (works without DLT): widget ID + token auth, verified server-side with the auth key
  msg91WidgetId?: string; msg91TokenAuth?: string; msg91OtpLength?: number;
  waPhoneNumberId?: string; waToken?: string; waTemplate?: string; waLang?: string;
};
export type BillingDetails = { name?: string; gstin?: string; address?: string; state?: string; email?: string; phone?: string };

/** One row (id = 1): default rate card, our business details for invoices, our PayU account for recharges. */
export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey(),
  rates: jsonb("rates").$type<WalletRates>().notNull(),
  minRechargePaise: integer("min_recharge_paise").notNull().default(200000),
  defaultNegativeLimitPaise: integer("default_negative_limit_paise").notNull().default(50000),
  defaultLowAlertPaise: integer("default_low_alert_paise").notNull().default(50000),
  billing: jsonb("billing").$type<BillingDetails & { sac?: string; invoicePrefix?: string }>().notNull().default({}),
  payuKey: text("payu_key"),
  payuSalt: text("payu_salt"),
  payuMode: text("payu_mode").notNull().default("test"),
  messaging: jsonb("messaging").$type<MessagingSettings>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Prepaid wallet per store. balancePaise is a cache of the ledger; it can go negative (checkout never stops). */
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().unique().references(() => stores.id, { onDelete: "cascade" }),
  balancePaise: bigint("balance_paise", { mode: "number" }).notNull().default(0),
  negativeLimitPaise: integer("negative_limit_paise").notNull().default(50000), // e.g. 50000 = can go to −₹500
  lowAlertPaise: integer("low_alert_paise").notNull().default(50000),
  rates: jsonb("rates").$type<Partial<WalletRates>>(), // per-store override, null = platform default
  reverseFeeOnRefund: boolean("reverse_fee_on_refund").notNull().default(false),
  billing: jsonb("billing").$type<BillingDetails>().notNull().default({}),
  status: text("status").notNull().default("active"), // active | suspended
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only ledger. Never updated or deleted. (type, ref_type, ref_id) is unique so retries never double charge. */
export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: serial("id").primaryKey(),
    walletId: integer("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
    // recharge | sale_fee | otp | wa_confirm | wa_tracking | wa_promo | refund_reversal | manual_credit | manual_debit
    type: text("type").notNull(),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(), // + credit, − debit
    balanceAfterPaise: bigint("balance_after_paise", { mode: "number" }).notNull(),
    refType: text("ref_type").notNull(), // order | recharge | message | manual
    refId: text("ref_id").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_tx_ref_idx").on(t.type, t.refType, t.refId),
    index("wallet_tx_wallet_idx").on(t.walletId, t.createdAt),
  ],
);

/** Wallet top-ups paid to us through PayU. GST is on top: pay ₹2,360 → ₹2,000 credit. */
export const walletRecharges = pgTable(
  "wallet_recharges",
  {
    id: serial("id").primaryKey(),
    walletId: integer("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
    txnid: text("txnid").notNull().unique(),
    creditPaise: bigint("credit_paise", { mode: "number" }).notNull(), // added to the wallet
    gstPaise: bigint("gst_paise", { mode: "number" }).notNull(),
    totalPaise: bigint("total_paise", { mode: "number" }).notNull(), // charged on PayU
    status: text("status").notNull().default("pending"), // pending | paid | failed
    mihpayid: text("mihpayid"),
    invoiceNo: text("invoice_no").unique(),
    billing: jsonb("billing").$type<BillingDetails & { taxType?: "igst" | "cgst_sgst" }>(),
    createdBy: text("created_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wallet_recharges_wallet_idx").on(t.walletId, t.createdAt)],
);

export type Store = typeof stores.$inferSelect;
export type CourierAccount = typeof courierAccounts.$inferSelect;
export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type BlockedCustomer = typeof blockedCustomers.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type WalletRecharge = typeof walletRecharges.$inferSelect;
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type MetaRecharge = typeof metaRecharges.$inferSelect;
export type FreeOffer = typeof freeOffers.$inferSelect;
export type User = typeof users.$inferSelect;
export type DiscountRule = typeof discountRules.$inferSelect;
export type ShippingRate = typeof shippingRates.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type BankOffer = typeof bankOffers.$inferSelect;
export type Order = typeof orders.$inferSelect;

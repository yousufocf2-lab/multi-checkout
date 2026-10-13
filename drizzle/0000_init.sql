CREATE TABLE "bank_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"bank_name" text NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'percent' NOT NULL,
	"value" integer NOT NULL,
	"max_discount_rupees" integer,
	"min_cart_rupees" integer DEFAULT 0 NOT NULL,
	"payu_offer_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'percent' NOT NULL,
	"value" integer NOT NULL,
	"min_cart_rupees" integer DEFAULT 0 NOT NULL,
	"max_discount_rupees" integer,
	"stackable" boolean DEFAULT true NOT NULL,
	"payment_restriction" text DEFAULT 'any' NOT NULL,
	"show_in_list" boolean DEFAULT true NOT NULL,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"session_id" text,
	"status" text NOT NULL,
	"payment_method" text NOT NULL,
	"customer" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"payment_discount" integer DEFAULT 0 NOT NULL,
	"coupon_code" text,
	"coupon_discount" integer DEFAULT 0 NOT NULL,
	"bank_discount" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"amount_paid" integer,
	"payu_mihpayid" text,
	"payu_raw" jsonb,
	"shopify_order_id" text,
	"shopify_order_name" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"shop_domain" text NOT NULL,
	"storefront_url" text NOT NULL,
	"admin_token" text,
	"client_id" text,
	"client_secret" text,
	"api_version" text DEFAULT '2025-07' NOT NULL,
	"logo_url" text,
	"primary_color" text DEFAULT '#111827' NOT NULL,
	"support_phone" text,
	"prepaid_discount_pct" integer DEFAULT 70 NOT NULL,
	"cod_discount_pct" integer DEFAULT 10 NOT NULL,
	"cod_enabled" boolean DEFAULT true NOT NULL,
	"payu_key" text,
	"payu_salt" text,
	"payu_mode" text DEFAULT 'test' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "bank_offers" ADD CONSTRAINT "bank_offers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_store_code_idx" ON "coupons" USING btree ("store_id","code");--> statement-breakpoint
CREATE INDEX "orders_store_created_idx" ON "orders" USING btree ("store_id","created_at");
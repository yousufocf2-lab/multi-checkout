ALTER TABLE "checkout_sessions" ADD COLUMN "tracking" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "capi_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "meta_ad_account_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "meta_access_token" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "meta_pixel_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "meta_capi_token" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "meta_api_version" text DEFAULT 'v23.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "meta_fire_cod_purchase" boolean DEFAULT true NOT NULL;
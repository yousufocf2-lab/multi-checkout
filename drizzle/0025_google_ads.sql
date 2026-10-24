ALTER TABLE "orders" ADD COLUMN "google_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_ads_customer_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_login_customer_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_refresh_token" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_account_email" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_conversion_action" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_conversion_action_name" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_tag_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_tag_label" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "google_fire_cod" boolean DEFAULT true NOT NULL;
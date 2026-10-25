ALTER TABLE "callback_requests" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "platform" text DEFAULT 'shopify' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "woo_secret" text;
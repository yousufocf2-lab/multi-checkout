ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "widget_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "media" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'customer' NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT false NOT NULL;

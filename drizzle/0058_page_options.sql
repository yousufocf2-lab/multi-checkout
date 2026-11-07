ALTER TABLE "store_pages" ADD COLUMN IF NOT EXISTS "seo_title" text;
--> statement-breakpoint
ALTER TABLE "store_pages" ADD COLUMN IF NOT EXISTS "seo_description" text;
--> statement-breakpoint
ALTER TABLE "store_pages" ADD COLUMN IF NOT EXISTS "layout" text DEFAULT 'narrow' NOT NULL;
--> statement-breakpoint
ALTER TABLE "store_pages" ADD COLUMN IF NOT EXISTS "hide_title" boolean DEFAULT false NOT NULL;

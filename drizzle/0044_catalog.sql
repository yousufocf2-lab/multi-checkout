-- Growpefy Store: business type + own catalog (products / dishes / courses / rooms / services / events)
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "business_type" text DEFAULT 'store' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "storefront_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "country" text DEFAULT 'IN' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'INR' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"kind" text DEFAULT 'store' NOT NULL,
	"title" text NOT NULL,
	"handle" text NOT NULL,
	"description_html" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"vendor" text,
	"product_type" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_handle_idx" ON "catalog_items" ("store_id","handle");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_items_source_idx" ON "catalog_items" ("store_id","source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_items_store_idx" ON "catalog_items" ("store_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL REFERENCES "catalog_items"("id") ON DELETE cascade,
	"store_id" integer NOT NULL,
	"title" text DEFAULT 'Default' NOT NULL,
	"option_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sku" text,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"compare_at_paise" integer,
	"stock" integer,
	"weight_grams" integer,
	"image_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"source_id" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_variants_item_idx" ON "catalog_variants" ("item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_variants_sku_idx" ON "catalog_variants" ("store_id","sku");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"title" text NOT NULL,
	"handle" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_categories_handle_idx" ON "catalog_categories" ("store_id","handle");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_categories_source_idx" ON "catalog_categories" ("store_id","source_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_category_items" (
	"category_id" integer NOT NULL REFERENCES "catalog_categories"("id") ON DELETE cascade,
	"item_id" integer NOT NULL REFERENCES "catalog_items"("id") ON DELETE cascade,
	"position" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY ("category_id","item_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_category_items_item_idx" ON "catalog_category_items" ("item_id");

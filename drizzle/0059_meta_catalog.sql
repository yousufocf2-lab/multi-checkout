ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "meta_catalog_id" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "meta_catalog_on" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "meta_catalog_synced_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "meta_catalog_error" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "meta_catalog_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_catalog_items" (
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "retailer_id" text NOT NULL,
  "hash" text NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("store_id", "retailer_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "courier_ref" text;

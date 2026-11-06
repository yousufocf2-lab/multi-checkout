-- Store profile (business details, contact, defaults), order ID format and locations
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "business" jsonb;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "contact_email" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'Asia/Kolkata' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "unit_system" text DEFAULT 'metric' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "weight_unit" text DEFAULT 'kg' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "order_prefix" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "order_suffix" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "order_start" integer DEFAULT 1001 NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "order_seq" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"kind" text DEFAULT 'warehouse' NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phone" text,
	"fulfils_online" boolean DEFAULT true NOT NULL,
	"pickup" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_locations_store_idx" ON "store_locations" ("store_id");

-- Draft orders made by store owners
CREATE TABLE IF NOT EXISTS "draft_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"number" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discount" jsonb,
	"shipping_paise" integer DEFAULT 0 NOT NULL,
	"shipping_title" text,
	"note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_id" text,
	"session_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "draft_orders_number_idx" ON "draft_orders" ("store_id","number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "draft_orders_store_idx" ON "draft_orders" ("store_id","status");

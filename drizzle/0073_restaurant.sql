ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "restaurant" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fulfilment" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "table_no" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "kitchen_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "kitchen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_store_kitchen_idx" ON "orders" ("store_id","kitchen_status");

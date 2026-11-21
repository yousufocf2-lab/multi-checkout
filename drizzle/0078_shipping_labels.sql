ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "label_printed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "label_batch" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_label_batch_idx" ON "orders" ("store_id", "label_batch");

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "ship_rule" jsonb;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "call_rr" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_to" integer;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "call_status" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "call_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "call_by" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "follow_up_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "call_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_assigned_idx" ON "orders" ("store_id", "assigned_to");

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "auto_ship" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_by" text;

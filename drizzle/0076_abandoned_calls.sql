ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_assigned_to" integer;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_assigned_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_status" text;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_by" text;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_follow_up_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_note" text;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_cart" jsonb;
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "call_order_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_sessions_call_idx" ON "checkout_sessions" ("store_id", "call_assigned_to");
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "abandon_rr" integer NOT NULL DEFAULT 0;

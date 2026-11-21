-- Out for delivery + NDR: attempts, delivery-day calling (Ready / Follow-up / Denied) and re-attempt requests
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ndr_reason" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ndr_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reattempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_assigned_to" integer;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_call_status" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_call_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_call_by" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_follow_up_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ofd_call_attempt" integer;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "ofd_rr" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "orders" SET "delivered_at" = "ship_status_at" WHERE "ship_status" = 'delivered' AND "delivered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_ofd_idx" ON "orders" ("store_id", "ofd_at") WHERE "ofd_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ofd_call_events" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "member_id" integer,
  "actor" text NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "outcome" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ofd_call_events_store_idx" ON "ofd_call_events" ("store_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ofd_call_events_order_idx" ON "ofd_call_events" ("order_id");

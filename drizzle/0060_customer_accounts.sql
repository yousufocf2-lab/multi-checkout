ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_note" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_note" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "timeline" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "account_settings" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_customers" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "first_name" text DEFAULT '' NOT NULL,
  "last_name" text DEFAULT '' NOT NULL,
  "phone" text,
  "email" text,
  "phone_verified_at" timestamp with time zone,
  "email_verified_at" timestamp with time zone,
  "password_hash" text,
  "address" jsonb,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_customers_phone_key" ON "store_customers" ("store_id", "phone") WHERE phone is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_customers_email_key" ON "store_customers" ("store_id", "email") WHERE email is not null;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_otps" (
  "id" text PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "target" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "ip" text,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_otps_target_idx" ON "customer_otps" ("store_id", "target", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_customer_phone_idx" ON "orders" ("store_id", (customer->>'phone'));

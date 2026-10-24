ALTER TABLE "orders" ADD COLUMN "gateway" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gateway_ref" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pay_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "gateways" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Stores that already use PayU keep it as their primary gateway
UPDATE "stores" SET "gateways" = jsonb_build_array(jsonb_build_object('id', 'payu', 'mode', "payu_mode", 'on', true, 'creds', jsonb_build_object('key', "payu_key", 'salt', "payu_salt"))) WHERE "payu_key" IS NOT NULL AND "payu_key" <> '' AND "payu_salt" IS NOT NULL AND "payu_salt" <> '';--> statement-breakpoint
-- Orders paid before this change were all PayU
UPDATE "orders" SET "gateway" = 'payu', "gateway_ref" = "payu_mihpayid" WHERE "payu_mihpayid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_gateway_ref_idx" ON "orders" ("gateway_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_pay_attempts_idx" ON "orders" USING gin ("pay_attempts");

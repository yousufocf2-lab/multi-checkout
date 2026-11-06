-- Smart Checkout (activation + consent), checkout field rules, tipping and order tips
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "smart_checkout" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "smart_activated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "smart_consent" jsonb;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "checkout_rules" jsonb;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "tipping" jsonb;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Stores already using Smart Checkout features keep them: they start activated (consent marked automatic)
UPDATE "stores" SET
  "smart_checkout" = true,
  "smart_activated_at" = now(),
  "smart_consent" = jsonb_build_object('by', 'Growpefy (existing features)', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'terms', 'v1', 'auto', true)
WHERE "smart_checkout" = false AND (
  "otp_enabled" = true
  OR "prepaid_discount_pct" > 0
  OR "cod_discount_pct" > 0
  OR coalesce("payment_methods"->'partial'->>'on', 'false') = 'true'
  OR coalesce("payment_methods"->'prepaid'->>'adjust', 'off') IN ('discount', 'fee')
  OR coalesce("payment_methods"->'cod'->>'adjust', 'off') IN ('discount', 'fee')
  OR ("mix_enabled" = true AND "mix_prepaid_on" <> "mix_cod_on")
  OR EXISTS (SELECT 1 FROM "discount_rules" d WHERE d."store_id" = "stores"."id" AND d."active" = true AND d."prepaid_pct" <> d."cod_pct")
  OR EXISTS (SELECT 1 FROM "coupons" c WHERE c."store_id" = "stores"."id" AND c."active" = true AND c."payment_restriction" <> 'any')
  OR EXISTS (SELECT 1 FROM "free_offers" f WHERE f."store_id" = "stores"."id" AND f."active" = true AND f."payment_restriction" <> 'any')
  OR EXISTS (SELECT 1 FROM "shipping_rates" r WHERE r."store_id" = "stores"."id" AND r."active" = true AND r."payment_method" <> 'any')
);

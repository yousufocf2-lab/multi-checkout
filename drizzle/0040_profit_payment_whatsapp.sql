-- Direct payments: I accept / I reject buttons on WhatsApp
ALTER TABLE "profit_payments" ADD COLUMN IF NOT EXISTS "wa_phone" text;
ALTER TABLE "profit_payments" ADD COLUMN IF NOT EXISTS "responded_via" text;

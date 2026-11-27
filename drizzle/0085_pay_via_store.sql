-- A store can take online payments through another store's website (Shopify App Proxy), e.g. while testing
-- with that store's gateway account. The order stays in its own store; only the payment page and return URL change.
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "pay_via_store_id" integer REFERENCES "stores"("id") ON DELETE SET NULL;

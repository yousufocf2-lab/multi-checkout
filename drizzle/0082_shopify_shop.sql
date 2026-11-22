-- Growpefy stores can connect a Shopify store just to read its products and customers
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "shopify_shop" text;

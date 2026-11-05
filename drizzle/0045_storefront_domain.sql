-- Growpefy Store: the store's own website domain
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "storefront_domain" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "storefront_dns_target" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "storefront_domain_status" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stores_storefront_domain_unique" ON "stores" ("storefront_domain");

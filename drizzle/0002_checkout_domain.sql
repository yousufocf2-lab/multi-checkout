ALTER TABLE "stores" ADD COLUMN "checkout_domain" text;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_checkout_domain_unique" UNIQUE("checkout_domain");
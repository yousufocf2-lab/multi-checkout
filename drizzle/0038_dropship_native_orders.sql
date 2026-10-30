ALTER TABLE "dropship_orders" DROP CONSTRAINT IF EXISTS "dropship_orders_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "dropship_orders" ADD COLUMN "source" text DEFAULT 'growpefy' NOT NULL;--> statement-breakpoint
ALTER TABLE "dropship_orders" ADD COLUMN "shopify_order_id" text;--> statement-breakpoint
ALTER TABLE "dropship_orders" ADD COLUMN "order_name" text;--> statement-breakpoint
ALTER TABLE "dropship_orders" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "dropship_orders" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "dropship_orders" ADD COLUMN "total_paise" integer;--> statement-breakpoint
-- Dropshipping stores had a fixed 20% Growpefy share; it's now a setting, so keep their current 20%
UPDATE "stores" SET "profit_share_bps" = 2000 WHERE "dropship_enabled" = true;

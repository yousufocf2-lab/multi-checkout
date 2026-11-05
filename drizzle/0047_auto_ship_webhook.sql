-- Automatic shipment booking for website orders, and the custom order webhook
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_error" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_book_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "order_webhook_url" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "order_webhook_secret" text;

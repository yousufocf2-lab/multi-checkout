ALTER TABLE "orders" ADD COLUMN "manual_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "orders" ADD COLUMN "checkout_channel" text;

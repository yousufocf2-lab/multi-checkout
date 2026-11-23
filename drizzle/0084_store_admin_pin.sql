-- Super admin PIN per store: when set, the Growpefy admin must enter it before opening the store
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "admin_pin_hash" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "admin_pin_len" smallint;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "admin_pin_contact" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "admin_pin_set_at" timestamp with time zone;

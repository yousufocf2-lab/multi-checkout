ALTER TABLE "orders" ADD COLUMN "confirm_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "confirm_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "wa_message_id" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "confirm_auto_cancel" boolean DEFAULT false NOT NULL;
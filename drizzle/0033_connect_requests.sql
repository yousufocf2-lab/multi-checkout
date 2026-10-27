ALTER TABLE "stores" ADD COLUMN "connect_status" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "connect_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "connect_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "install_url" text;
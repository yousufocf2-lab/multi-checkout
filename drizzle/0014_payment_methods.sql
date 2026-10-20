ALTER TABLE "orders" ADD COLUMN "advance" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_fee" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "payment_methods" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "otp_timing" text DEFAULT 'end' NOT NULL;
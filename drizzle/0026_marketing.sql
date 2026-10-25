ALTER TABLE "callback_requests" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "marketing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "attribution" jsonb;
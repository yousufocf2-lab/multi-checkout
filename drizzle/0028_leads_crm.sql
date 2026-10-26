CREATE TABLE "lead_crm" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"demo_at" timestamp with time zone,
	"stores_count" integer,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"form_name" text,
	"ad_name" text,
	"campaign_name" text,
	"platform" text,
	"name" text,
	"phone" text,
	"email" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_crm_ref_idx" ON "lead_crm" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "lead_crm_demo_idx" ON "lead_crm" USING btree ("status","demo_at");--> statement-breakpoint
CREATE INDEX "meta_leads_created_idx" ON "meta_leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "meta_leads_phone_idx" ON "meta_leads" USING btree ("phone");--> statement-breakpoint
-- Auto-detected Meta recharges: the available balance already includes GST, so the recharge is the rounded rise itself
UPDATE "meta_recharges" SET "amount_paise" = round("credit_paise" / 100.0) * 100, "credit_paise" = round(round("credit_paise" / 100.0) * 100 / 1.18) WHERE "source" = 'auto';

CREATE TABLE "store_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"purpose" text DEFAULT 'wa_verify' NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "recovery_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "recovery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "wa_verify" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "recovery" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "popup_checkout" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_documents_store_idx" ON "store_documents" USING btree ("store_id","purpose");--> statement-breakpoint
-- Stores already live keep sending WhatsApp messages; new stores need admin verification first
UPDATE "stores" SET "wa_verify" = jsonb_build_object('status', 'approved', 'decidedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'decidedBy', 'Existing store');
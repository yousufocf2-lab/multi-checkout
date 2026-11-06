CREATE TABLE "billing_accounts" (
	"store_id" integer PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_invoice_at" timestamp with time zone NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_gst_paise" bigint DEFAULT 0 NOT NULL,
	"legacy_debt_paise" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"invoice_no" text NOT NULL,
	"plan_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"gst_paise" bigint NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_gst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"due_paise" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"payment_txnid" text,
	"payment_mihpayid" text,
	"billing" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_invoice_no_unique" UNIQUE("invoice_no"),
	CONSTRAINT "billing_invoices_payment_txnid_unique" UNIQUE("payment_txnid")
);
--> statement-breakpoint
CREATE TABLE "billing_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"invoice_id" integer,
	"type" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_invoice_id_billing_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoice_period_idx" ON "billing_invoices" USING btree ("store_id","period_start");
--> statement-breakpoint
CREATE INDEX "billing_invoice_due_idx" ON "billing_invoices" USING btree ("store_id","status","due_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_ref_idx" ON "billing_usage" USING btree ("type","ref_type","ref_id");
--> statement-breakpoint
CREATE INDEX "billing_usage_period_idx" ON "billing_usage" USING btree ("store_id","invoice_id","created_at");

CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"rates" jsonb NOT NULL,
	"min_recharge_paise" integer DEFAULT 200000 NOT NULL,
	"default_negative_limit_paise" integer DEFAULT 50000 NOT NULL,
	"default_low_alert_paise" integer DEFAULT 50000 NOT NULL,
	"billing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payu_key" text,
	"payu_salt" text,
	"payu_mode" text DEFAULT 'test' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_recharges" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"txnid" text NOT NULL,
	"credit_paise" bigint NOT NULL,
	"gst_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mihpayid" text,
	"invoice_no" text,
	"billing" jsonb,
	"created_by" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_recharges_txnid_unique" UNIQUE("txnid"),
	CONSTRAINT "wallet_recharges_invoice_no_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"balance_after_paise" bigint NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"balance_paise" bigint DEFAULT 0 NOT NULL,
	"negative_limit_paise" integer DEFAULT 50000 NOT NULL,
	"low_alert_paise" integer DEFAULT 50000 NOT NULL,
	"rates" jsonb,
	"reverse_fee_on_refund" boolean DEFAULT false NOT NULL,
	"billing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_store_id_unique" UNIQUE("store_id")
);
--> statement-breakpoint
ALTER TABLE "wallet_recharges" ADD CONSTRAINT "wallet_recharges_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_recharges_wallet_idx" ON "wallet_recharges" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_ref_idx" ON "wallet_transactions" USING btree ("type","ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "wallet_tx_wallet_idx" ON "wallet_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "wallet_invoice_seq" START 1;
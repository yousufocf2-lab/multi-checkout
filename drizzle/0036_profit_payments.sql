CREATE TABLE "profit_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"amount_paise" integer NOT NULL,
	"payment_date" text NOT NULL,
	"note" text,
	"created_by_role" text NOT NULL,
	"created_by" text NOT NULL,
	"confirm_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"otp_hash" text,
	"otp_expires_at" timestamptz,
	"attempts" integer DEFAULT 0 NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "profit_payments_store_date_idx" ON "profit_payments" USING btree ("store_id", "payment_date");
CREATE INDEX "profit_payments_store_status_idx" ON "profit_payments" USING btree ("store_id", "status");

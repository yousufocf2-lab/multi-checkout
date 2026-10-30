ALTER TABLE "dropship_orders" ADD COLUMN "packing_paise" integer DEFAULT 0 NOT NULL;
ALTER TABLE "stores" ADD COLUMN "profit_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "stores" ADD COLUMN "profit_share_bps" integer DEFAULT 5000 NOT NULL;
ALTER TABLE "stores" ADD COLUMN "profit_enabled_at" timestamptz;
CREATE TABLE "profit_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"settlement_id" text NOT NULL,
	"settlement_date" text NOT NULL,
	"settlement_amount" integer NOT NULL,
	"utr_number" text,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "profit_settlements_store_id_unique" ON "profit_settlements" USING btree ("store_id", "settlement_id");
CREATE INDEX "profit_settlements_store_date_idx" ON "profit_settlements" USING btree ("store_id", "settlement_date");

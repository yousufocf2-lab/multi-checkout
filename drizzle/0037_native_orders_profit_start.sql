CREATE TABLE "shopify_native_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"total_paise" integer NOT NULL,
	"prepaid" boolean NOT NULL,
	"financial_status" text,
	"gateway" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "profit_start_date" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "profit_settled_from" text;--> statement-breakpoint
ALTER TABLE "shopify_native_orders" ADD CONSTRAINT "shopify_native_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopify_native_orders_store_created_idx" ON "shopify_native_orders" USING btree ("store_id","created_at");

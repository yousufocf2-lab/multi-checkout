CREATE TABLE "payment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer,
	"order_id" text,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"status" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"name" text NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"min_order_rupees" integer DEFAULT 0 NOT NULL,
	"max_order_rupees" integer,
	"states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pincode_prefixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_method" text DEFAULT 'any' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "customer" jsonb;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "cart_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "cart_value" integer;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "payment_attempted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_title" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_store_idx" ON "payment_events" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_session_idx" ON "orders" USING btree ("session_id");
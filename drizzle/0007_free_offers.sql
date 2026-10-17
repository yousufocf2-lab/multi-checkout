CREATE TABLE "free_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"name" text NOT NULL,
	"buy_mode" text DEFAULT 'products' NOT NULL,
	"buy_products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_qty" integer DEFAULT 1 NOT NULL,
	"free_products" jsonb NOT NULL,
	"free_qty" integer DEFAULT 1 NOT NULL,
	"repeat" boolean DEFAULT false NOT NULL,
	"payment_restriction" text DEFAULT 'any' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "free_offers" ADD CONSTRAINT "free_offers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
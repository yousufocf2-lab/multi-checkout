CREATE TABLE "customer_flags" (
	"store_id" integer NOT NULL,
	"phone" text NOT NULL,
	"prepaid_at" timestamp with time zone,
	"last_cod_at" timestamp with time zone,
	CONSTRAINT "customer_flags_store_id_phone_pk" PRIMARY KEY("store_id","phone")
);
--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"name" text NOT NULL,
	"products" jsonb NOT NULL,
	"prepaid_pct" integer NOT NULL,
	"cod_pct" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "products" jsonb;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "cod_cooldown_hours" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "cod_block_after_prepaid" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "upsell_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "upsell_products" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_flags" ADD CONSTRAINT "customer_flags_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_store_phone_idx" ON "orders" USING btree ("store_id",(customer->>'phone'));
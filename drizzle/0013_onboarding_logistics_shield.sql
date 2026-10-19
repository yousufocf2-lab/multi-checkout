CREATE TABLE "courier_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"courier" text NOT NULL,
	"creds" jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"addr_key" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address1" text NOT NULL,
	"address2" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pincode" text NOT NULL,
	"source_store_id" integer,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_otps" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rto_shield_exempt" (
	"store_id" integer NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rto_shield_exempt_store_id_phone_pk" PRIMARY KEY("store_id","phone")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "addr_lookups" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "save_address" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "awb" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "courier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_status_raw" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "rto_shield" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_with" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kyc" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kyc_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kyc_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD CONSTRAINT "courier_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rto_shield_exempt" ADD CONSTRAINT "rto_shield_exempt_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courier_accounts_store_courier" ON "courier_accounts" USING btree ("store_id","courier");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_phone_key" ON "customer_addresses" USING btree ("phone","addr_key");--> statement-breakpoint
CREATE INDEX "customer_addresses_phone_idx" ON "customer_addresses" USING btree ("phone","last_used_at");--> statement-breakpoint
CREATE INDEX "owner_otps_target_idx" ON "owner_otps" USING btree ("target","created_at");--> statement-breakpoint
CREATE INDEX "orders_store_ship_idx" ON "orders" USING btree ("store_id","ship_status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");--> statement-breakpoint
UPDATE "users" SET "kyc_status" = 'approved', "kyc_submitted_at" = now() WHERE "kyc_status" = 'pending';
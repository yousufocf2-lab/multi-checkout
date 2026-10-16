CREATE TABLE "meta_recharges" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"amount_paise" bigint NOT NULL,
	"credit_paise" bigint NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"recharged_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"available_paise" bigint NOT NULL,
	"spent_paise" bigint NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "theme" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_recharges" ADD CONSTRAINT "meta_recharges_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_snapshots" ADD CONSTRAINT "meta_snapshots_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_recharges_store_idx" ON "meta_recharges" USING btree ("store_id","recharged_at");--> statement-breakpoint
CREATE INDEX "meta_snapshots_store_idx" ON "meta_snapshots" USING btree ("store_id","taken_at");
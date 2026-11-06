-- Page speed from real shoppers on Growpefy Store websites
CREATE TABLE IF NOT EXISTS "storefront_vitals" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"page" text,
	"device" text NOT NULL,
	"lcp" integer,
	"inp" integer,
	"cls" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storefront_vitals_store_idx" ON "storefront_vitals" ("store_id","created_at");

-- Growpefy Store: each store's theme design (live, draft, recent versions)
CREATE TABLE IF NOT EXISTS "store_themes" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL UNIQUE REFERENCES "stores"("id") ON DELETE cascade,
	"theme" text DEFAULT 'swift' NOT NULL,
	"live" jsonb,
	"draft" jsonb,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);

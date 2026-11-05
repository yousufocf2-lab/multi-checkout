-- Growpefy Store: website pages (policies, about, contact)
CREATE TABLE IF NOT EXISTS "store_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"title" text NOT NULL,
	"handle" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"in_footer" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_pages_handle_idx" ON "store_pages" ("store_id","handle");

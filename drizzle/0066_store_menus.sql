CREATE TABLE IF NOT EXISTS "store_menus" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "handle" text NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "in_header" boolean NOT NULL DEFAULT false,
  "in_footer" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_menus_handle_idx" ON "store_menus" ("store_id", "handle");

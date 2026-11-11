CREATE TABLE IF NOT EXISTS "store_theme_library" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_theme_library_store_updated_idx" ON "store_theme_library" ("store_id", "updated_at");

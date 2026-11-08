CREATE TABLE IF NOT EXISTS "store_files" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "key" text NOT NULL UNIQUE,
  "url" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "mime" text NOT NULL,
  "bytes" integer NOT NULL DEFAULT 0,
  "width" integer,
  "height" integer,
  "alt" text NOT NULL DEFAULT '',
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_files_store_idx" ON "store_files" ("store_id", "created_at");
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "files_synced_at" timestamptz;

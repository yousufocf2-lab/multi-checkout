CREATE TABLE IF NOT EXISTS "store_subscribers" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "source" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_subscribers_email_idx" ON "store_subscribers" ("store_id", "email");

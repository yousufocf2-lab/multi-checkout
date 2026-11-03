-- Checkout diagnostics: what customers did inside each checkout
CREATE TABLE IF NOT EXISTS "checkout_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"order_id" text,
	"type" text NOT NULL,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "checkout_events_store_idx" ON "checkout_events" ("store_id","at");
CREATE INDEX IF NOT EXISTS "checkout_events_session_idx" ON "checkout_events" ("session_id","at");

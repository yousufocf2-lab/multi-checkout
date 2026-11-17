CREATE TABLE "order_call_events" (
  "id" serial PRIMARY KEY,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "order_id" text NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "actor" text NOT NULL,
  "member_id" integer,
  "kind" text NOT NULL,
  "provider" text,
  "provider_ref" text,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "order_call_events_store_idx" ON "order_call_events" ("store_id", "kind", "created_at");
--> statement-breakpoint
CREATE INDEX "order_call_events_order_idx" ON "order_call_events" ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_call_events_open_skip_idx" ON "order_call_events" ("store_id", "order_id", "member_id") WHERE "kind" = 'skip' AND "resolved_at" IS NULL;

-- A store can connect the same courier more than once (e.g. three Delhivery accounts), tried in its chosen order
DROP INDEX IF EXISTS "courier_accounts_store_courier";
--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "courier_accounts" ADD COLUMN IF NOT EXISTS "auto_ship" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE "courier_accounts" a SET "priority" = r.n FROM (SELECT id, row_number() OVER (PARTITION BY store_id ORDER BY created_at, id) AS n FROM "courier_accounts") r WHERE r.id = a.id AND a."priority" = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courier_accounts_store_idx" ON "courier_accounts" ("store_id", "priority");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "courier_account_id" integer;
--> statement-breakpoint
UPDATE "orders" o SET "courier_account_id" = a.id FROM "courier_accounts" a WHERE a.store_id = o.store_id AND a.courier = o.courier AND o."courier_account_id" IS NULL AND (o.awb IS NOT NULL OR o.courier_ref IS NOT NULL);

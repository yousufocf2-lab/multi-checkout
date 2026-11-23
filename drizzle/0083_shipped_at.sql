-- When an order got its shipment (AWB or courier order), so "Shipped" can be counted by the day it shipped
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipped_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "orders" SET "shipped_at" = coalesce(least("ship_book_at", "label_printed_at", "ship_status_at"), "created_at")
  WHERE "shipped_at" IS NULL AND ("awb" IS NOT NULL OR "courier_ref" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION orders_set_shipped_at() RETURNS trigger AS $$
BEGIN
  IF NEW.shipped_at IS NULL AND (NEW.awb IS NOT NULL OR NEW.courier_ref IS NOT NULL) THEN
    NEW.shipped_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orders_shipped_at ON "orders";
--> statement-breakpoint
CREATE TRIGGER orders_shipped_at BEFORE INSERT OR UPDATE OF "awb", "courier_ref" ON "orders"
  FOR EACH ROW EXECUTE FUNCTION orders_set_shipped_at();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_store_shipped_at" ON "orders" ("store_id", "shipped_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_store_call_at" ON "orders" ("store_id", "call_at");

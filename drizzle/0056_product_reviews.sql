CREATE TABLE "product_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "product_id" integer NOT NULL REFERENCES "catalog_items"("id") ON DELETE CASCADE,
  "author_name" text NOT NULL,
  "email" text,
  "rating" integer NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "product_reviews_store_status_idx" ON "product_reviews" USING btree ("store_id", "status");
CREATE INDEX "product_reviews_product_status_idx" ON "product_reviews" USING btree ("product_id", "status");

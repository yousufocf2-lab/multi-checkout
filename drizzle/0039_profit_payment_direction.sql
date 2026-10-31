-- Direct payments both ways: the store paying Growpefy its share (existing entries), or Growpefy giving the store money
ALTER TABLE "profit_payments" ADD COLUMN IF NOT EXISTS "direction" text DEFAULT 'to_growpefy' NOT NULL;

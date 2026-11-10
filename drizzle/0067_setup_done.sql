ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "setup_done" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "special_logic" jsonb DEFAULT '{}'::jsonb NOT NULL;

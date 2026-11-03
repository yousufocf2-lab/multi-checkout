-- Passkeys: Face ID / fingerprint login to the dashboard
CREATE TABLE IF NOT EXISTS "passkeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"kind" text NOT NULL,
	"ref_id" integer NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "passkeys_credential_idx" ON "passkeys" ("credential_id");
CREATE INDEX IF NOT EXISTS "passkeys_owner_idx" ON "passkeys" ("kind","ref_id");

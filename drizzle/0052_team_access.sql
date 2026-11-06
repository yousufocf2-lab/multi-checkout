-- Team & access: collaborators (request code, expiry) and the team activity log
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'staff' NOT NULL;
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "company" text;
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "collab_code" text;
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "collab_open" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collaborator_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL REFERENCES "stores"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"company" text,
	"message" text,
	"perms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"member_id" integer,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collaborator_requests_store_idx" ON "collaborator_requests" ("store_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"owner_id" integer,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_activity_owner_idx" ON "team_activity" ("scope","owner_id","created_at");

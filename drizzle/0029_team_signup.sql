CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"owner_id" integer,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'custom' NOT NULL,
	"perms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"store_ids" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup" jsonb;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_members_owner_idx" ON "team_members" USING btree ("scope","owner_id");
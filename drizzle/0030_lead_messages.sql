CREATE TABLE "lead_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"msg" text NOT NULL,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider_id" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_messages_once" ON "lead_messages" USING btree ("msg","channel","target");--> statement-breakpoint
CREATE INDEX "lead_messages_due_idx" ON "lead_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "lead_messages_ref_idx" ON "lead_messages" USING btree ("kind","ref_id");
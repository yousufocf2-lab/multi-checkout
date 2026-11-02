-- Growpefy's own WhatsApp inbox (super admin)
CREATE TABLE IF NOT EXISTS "admin_wa_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unread" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_wa_conv_phone_idx" ON "admin_wa_conversations" ("phone");
CREATE INDEX IF NOT EXISTS "admin_wa_conv_last_idx" ON "admin_wa_conversations" ("last_message_at");
CREATE TABLE IF NOT EXISTS "admin_wa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL REFERENCES "admin_wa_conversations"("id") ON DELETE CASCADE,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"wa_message_id" text,
	"status" text,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "admin_wa_msg_conv_idx" ON "admin_wa_messages" ("conversation_id","created_at");
CREATE INDEX IF NOT EXISTS "admin_wa_msg_wamid_idx" ON "admin_wa_messages" ("wa_message_id");

CREATE TABLE "wa_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unread" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"wa_message_id" text,
	"status" text,
	"order_id" text,
	"sent_by" text,
	"charged_paise" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD CONSTRAINT "wa_conversations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wa_conv_store_phone_idx" ON "wa_conversations" USING btree ("store_id","phone");--> statement-breakpoint
CREATE INDEX "wa_conv_phone_idx" ON "wa_conversations" USING btree ("phone","last_message_at");--> statement-breakpoint
CREATE INDEX "wa_msg_conv_idx" ON "wa_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_msg_wamid_idx" ON "wa_messages" USING btree ("wa_message_id");
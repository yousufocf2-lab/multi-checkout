ALTER TABLE "orders" ADD COLUMN "offer_discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_buy_qty" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_free_qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_free_which" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_title" text;
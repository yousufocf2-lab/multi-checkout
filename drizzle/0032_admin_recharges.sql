ALTER TABLE "wallet_recharges" ADD COLUMN "source" text DEFAULT 'payu' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_recharges" ADD COLUMN "note" text;
ALTER TABLE "stores" ADD COLUMN "mix_prepaid_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_cod_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_cod_free_qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "mix_cod_free_which" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
UPDATE "stores" SET "mix_cod_free_qty" = "mix_free_qty", "mix_cod_free_which" = "mix_free_which";
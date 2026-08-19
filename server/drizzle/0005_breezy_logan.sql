ALTER TABLE "accounting_suppliers" ADD COLUMN "tipo_soggetto" varchar(32);--> statement-breakpoint
ALTER TABLE "accounting_suppliers" ADD COLUMN "regime_forfettario" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_suppliers" ADD COLUMN "aliquota_ritenuta" numeric(5, 2);
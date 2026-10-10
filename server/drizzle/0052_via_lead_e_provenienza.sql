-- Le tabelle e le colonne di prima, ora che i loro dati stanno in persone, trattative, attivita
-- e consensi (migrazione 0051): i lead e il loro diario, la provenienza scritta sul socio, il
-- consenso marketing unico.

ALTER TABLE "lead_attivita" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "lead_attivita" CASCADE;--> statement-breakpoint
DROP TABLE "leads" CASCADE;--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_lead_canale_id_canali_contatto_id_fk";
--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "consenso_marketing";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "consenso_marketing_data";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "lead_canale_id";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "lead_data_contatto";
-- I lead escono dall'applicazione (17/11/2026). Il codice è nel branch archivio/lead e nel tag
-- archivio/lead-2026-11; i dati no: per scelta, nessun backup.
--
-- - persone che non sono soci: erano solo contatti. Con loro se ne vanno, in cascata, il loro
--   diario, i consensi e gli avvisi. Le persone dei soci (anche ex) restano.
-- - attivita.trattativa_id: il diario resta, senza il legame alla trattativa.
-- - trattative, canali_contatto: le tabelle dei lead.
-- - ruoli.permessi: via il modulo crm_leads.
--
-- Scritta a mano: drizzle-kit chiede conferme interattive, che in questo ambiente non ci sono.
DELETE FROM "persone" p WHERE NOT EXISTS (SELECT 1 FROM "members" m WHERE m."persona_id" = p."id");--> statement-breakpoint
ALTER TABLE "attivita" DROP COLUMN IF EXISTS "trattativa_id";--> statement-breakpoint
DROP TABLE IF EXISTS "trattative" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "canali_contatto" CASCADE;--> statement-breakpoint
UPDATE "ruoli" SET "permessi" = "permessi" - 'crm_leads' WHERE "permessi" ? 'crm_leads';

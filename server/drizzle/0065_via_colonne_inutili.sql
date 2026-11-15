-- Via le colonne che nessuno leggeva né mostrava, e i documenti dei soci.
--
-- - organizations: ragione_sociale, piva_cf, logo_url — mai scritte né lette.
-- - members: gdpr_consent, gdpr_consent_date — sempre vero e la data d'iscrizione: senza
--   l'informativa firmata non ci si iscrive.
-- - trattative: assegnata_a_id, interesse_categoria_id — nessuna schermata le compilava.
-- - member_documents, e con lei consensi.documento_id: i documenti sono usciti dall'applicazione a
--   novembre 2026. Un consenso dato in reception, la cui prova era il modulo fra i documenti, da
--   oggi non vale più (shared/consensi.js, consensoProvato).
--
-- Scritta a mano: drizzle-kit chiede conferme interattive, che in questo ambiente non ci sono.
-- I dati se ne vanno con le colonne: prima di lanciarla, backup del database (vedi README).
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "ragione_sociale";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "piva_cf";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "logo_url";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN IF EXISTS "gdpr_consent";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN IF EXISTS "gdpr_consent_date";--> statement-breakpoint
ALTER TABLE "trattative" DROP COLUMN IF EXISTS "assegnata_a_id";--> statement-breakpoint
ALTER TABLE "trattative" DROP COLUMN IF EXISTS "interesse_categoria_id";--> statement-breakpoint
ALTER TABLE "consensi" DROP COLUMN IF EXISTS "documento_id";--> statement-breakpoint
DROP TABLE IF EXISTS "member_documents" CASCADE;

ALTER TABLE "clients" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_suppliers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "banks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "causali_operative" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exercise_closures" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_assets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_attachments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_lines" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loan_installments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loans" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "liquidazioni_pt" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payslips" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "richieste_ferie_permesso" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sedute_pt" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timbrature" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "turni" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_profile_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_year_data" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parametri_fiscali" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_templates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "clients" CASCADE;--> statement-breakpoint
DROP TABLE "accounting_suppliers" CASCADE;--> statement-breakpoint
DROP TABLE "banks" CASCADE;--> statement-breakpoint
DROP TABLE "causali_operative" CASCADE;--> statement-breakpoint
DROP TABLE "chart_of_accounts" CASCADE;--> statement-breakpoint
DROP TABLE "exercise_closures" CASCADE;--> statement-breakpoint
DROP TABLE "fixed_assets" CASCADE;--> statement-breakpoint
DROP TABLE "journal_attachments" CASCADE;--> statement-breakpoint
DROP TABLE "journal_entries" CASCADE;--> statement-breakpoint
DROP TABLE "journal_lines" CASCADE;--> statement-breakpoint
DROP TABLE "loan_installments" CASCADE;--> statement-breakpoint
DROP TABLE "loans" CASCADE;--> statement-breakpoint
DROP TABLE "purchase_orders" CASCADE;--> statement-breakpoint
DROP TABLE "liquidazioni_pt" CASCADE;--> statement-breakpoint
DROP TABLE "payroll_runs" CASCADE;--> statement-breakpoint
DROP TABLE "payslips" CASCADE;--> statement-breakpoint
DROP TABLE "richieste_ferie_permesso" CASCADE;--> statement-breakpoint
DROP TABLE "sedute_pt" CASCADE;--> statement-breakpoint
DROP TABLE "timbrature" CASCADE;--> statement-breakpoint
DROP TABLE "turni" CASCADE;--> statement-breakpoint
DROP TABLE "fiscal_profile_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE "fiscal_year_data" CASCADE;--> statement-breakpoint
DROP TABLE "invoices" CASCADE;--> statement-breakpoint
DROP TABLE "parametri_fiscali" CASCADE;--> statement-breakpoint
DROP TABLE "receipt_templates" CASCADE;--> statement-breakpoint
DROP TABLE "receipts" CASCADE;--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "regime_fiscale";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "partita_iva";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "codice_fiscale";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "regime_fiscale_codice";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "indirizzo_via";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "indirizzo_civico";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "indirizzo_cap";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "indirizzo_comune";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "indirizzo_provincia";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "indirizzo_nazione";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "gestione_iva";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN IF EXISTS "cliente_id";--> statement-breakpoint
ALTER TABLE "courses" DROP COLUMN IF EXISTS "tipo_incarico";--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN IF EXISTS "collaboratore_id";--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN IF EXISTS "fornitore_id";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "soglia_settimanale_ore";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "giorni_ferie_anno";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "tipo_contratto";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "importo_fisso";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "percentuale";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "importo_seduta";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "importo_autocertificato_altri_enti";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "data_autocertificazione";--> statement-breakpoint
ALTER TABLE "collaboratori" DROP COLUMN IF EXISTS "destinazione_tfr";
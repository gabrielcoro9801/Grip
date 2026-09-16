-- Si smonta la prima versione dei lead (0026) e si completa l'anagrafica dei soci.
--
-- Scritta a mano sull'output di drizzle-kit: quello toglieva `full_name` prima di aver
-- ricavato nome e cognome, e metteva NOT NULL su colonne ancora vuote. Su un database con
-- dei soci sarebbe fallita alla quarta riga, o peggio avrebbe perso i nomi.

-- 1. Le prove dei lead: escono dalle prenotazioni prima che `member_id` torni obbligatorio.
DELETE FROM "bookings" WHERE "lead_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_un_intestatario";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_presenza_valida";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_lead_id_leads_id_fk";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "lead_id";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "presenza";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint

-- 2. La pipeline dei lead. I dati erano di prova: la tabella rinasce diversa nella 0028.
DROP TABLE IF EXISTS "lead_attivita" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "leads" CASCADE;--> statement-breakpoint

-- 3. Nome e cognome dei soci, ricavati dal nome completo: la prima parola è il nome, il resto
-- il cognome. Sbaglia sui nomi doppi ("Maria Grazia Rossi"), che si correggono dalla scheda.
ALTER TABLE "members" ADD COLUMN "nome" varchar(120);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "cognome" varchar(120);--> statement-breakpoint
UPDATE "members" SET
	"nome" = split_part(regexp_replace(trim("full_name"), '\s+', ' ', 'g'), ' ', 1),
	"cognome" = trim(substr(
		regexp_replace(trim("full_name"), '\s+', ' ', 'g'),
		length(split_part(regexp_replace(trim("full_name"), '\s+', ' ', 'g'), ' ', 1)) + 1
	));--> statement-breakpoint
UPDATE "members" SET "nome" = coalesce("nome", ''), "cognome" = coalesce("cognome", '');--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "nome" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "cognome" SET NOT NULL;--> statement-breakpoint

-- Da qui il nome completo non si scrive più: lo calcola il database.
ALTER TABLE "members" DROP COLUMN "full_name";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "full_name" varchar(255) GENERATED ALWAYS AS (trim(nome || ' ' || cognome)) STORED;--> statement-breakpoint

ALTER TABLE "members" ADD COLUMN "codice_fiscale" varchar(16);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "sesso" varchar(8);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_codice_fiscale_univoco" ON "members" USING btree (upper("codice_fiscale")) WHERE "members"."codice_fiscale" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_sesso_valido" CHECK ("members"."sesso" IS NULL OR "members"."sesso" IN ('M', 'F', 'altro'));--> statement-breakpoint

-- 4. I tipi di documento, prima testo libero. Il backfill precede il vincolo; quello che non
-- è né certificato né documento di identità diventa "altro", e il vecchio valore resta come
-- titolo perché non se ne perda il senso ("Contratto", "Modulo Privacy").
ALTER TABLE "member_documents" ADD COLUMN "titolo" varchar(255);--> statement-breakpoint
UPDATE "member_documents" SET "document_type" = 'certificato_medico'
WHERE lower(trim("document_type")) IN ('certificato medico', 'medical certificate');--> statement-breakpoint
UPDATE "member_documents" SET "document_type" = 'documento_identita'
WHERE lower(trim("document_type")) IN ('documento identità', 'documento identita', 'documento di identità', 'documento di identita');--> statement-breakpoint
UPDATE "member_documents" SET "titolo" = coalesce(nullif(trim("document_type"), ''), 'Documento'), "document_type" = 'altro'
WHERE "document_type" IS NULL OR "document_type" NOT IN ('certificato_medico', 'documento_identita');--> statement-breakpoint
ALTER TABLE "member_documents" ALTER COLUMN "document_type" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "member_documents" ALTER COLUMN "document_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member_documents" ADD CONSTRAINT "member_documents_tipo_valido" CHECK ("member_documents"."document_type" IN ('certificato_medico', 'documento_identita', 'altro'));

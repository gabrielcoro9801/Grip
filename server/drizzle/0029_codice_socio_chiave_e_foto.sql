-- Il codice socio diventa obbligatorio e univoco: la chiave con cui la palestra riconosce un
-- socio, accanto all'id tecnico. Prima i vincoli, però, vanno messi a posto i dati: soci nati
-- senza codice (modulo aperto prima di caricare l'ente) e, in teoria, codici doppi lasciati
-- dal vecchio calcolo nel browser.
--
-- 1. Codici doppi: resta a chi li ha avuti per primo, gli altri li riassegna il passo 2.
WITH doppi AS (
	SELECT "id", row_number() OVER (PARTITION BY "codice_socio" ORDER BY "created_date", "id") AS n
	FROM "members" WHERE "codice_socio" IS NOT NULL
)
UPDATE "members" SET "codice_socio" = NULL FROM doppi WHERE "members"."id" = doppi."id" AND doppi.n > 1;
--> statement-breakpoint
-- 2. Chi non ha codice lo riceve dopo il più alto già usato — dai soci o dal contatore, se il
--    contatore è andato più avanti — in ordine di iscrizione.
WITH base AS (
	SELECT GREATEST(
		COALESCE((SELECT MAX(CAST(NULLIF(regexp_replace("codice_socio", '\D', '', 'g'), '') AS INTEGER)) FROM "members"), 0),
		COALESCE((SELECT MAX("value") FROM "numbering_counters" WHERE "scope" = 'codice_socio'), 0)
	) AS massimo
), nuovi AS (
	SELECT "id", row_number() OVER (ORDER BY "created_date", "id") AS n
	FROM "members" WHERE "codice_socio" IS NULL
)
UPDATE "members" SET "codice_socio" = lpad((base.massimo + nuovi.n)::text, 6, '0')
FROM base, nuovi WHERE "members"."id" = nuovi."id";
--> statement-breakpoint
-- 3. Il contatore riparte dopo i codici appena assegnati, non da dove si era fermato.
UPDATE "numbering_counters"
SET "value" = GREATEST("value", COALESCE((SELECT MAX(CAST(NULLIF(regexp_replace("codice_socio", '\D', '', 'g'), '') AS INTEGER)) FROM "members"), 0))
WHERE "scope" = 'codice_socio';
--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "codice_socio" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "foto_url" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_codice_socio_univoco" UNIQUE("codice_socio");

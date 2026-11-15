-- Utenti e istruttori diventano una cosa sola: l'istruttore è un account con la spunta
-- «istruttore». La tabella `instructors` si toglie, e i corsi puntano all'account.
--
-- Scritta a mano: drizzle-kit chiede conferme interattive, che in questo ambiente non ci sono.
-- Prima di lanciarla: backup del database (vedi README).

-- 1. Le colonne nuove di staff_accounts.
ALTER TABLE "staff_accounts" ADD COLUMN "istruttore" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "telefono" varchar(64);--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "codice_fiscale" varchar(16);--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "partita_iva" varchar(11);--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "protetto" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 2. Chi era collegato a un istruttore diventa istruttore, e si porta dietro i suoi dati. Il
-- telefono no: i vecchi non erano controllati, e si riscrivono.
UPDATE "staff_accounts" s SET
	"istruttore" = true,
	"codice_fiscale" = i."codice_fiscale",
	"partita_iva" = i."partita_iva",
	"note" = i."notes"
FROM "instructors" i
WHERE s."instructor_id" = i."id";--> statement-breakpoint

-- 3. I corsi passano dall'istruttore all'account collegato. Chi non aveva un account perde
-- l'istruttore: il corso resta, senza istruttore, e l'amministratore lo riassegna.
ALTER TABLE "courses" DROP CONSTRAINT IF EXISTS "courses_instructor_id_instructors_id_fk";--> statement-breakpoint
UPDATE "courses" c SET "instructor_id" = s."id"
FROM "staff_accounts" s
WHERE s."instructor_id" = c."instructor_id";--> statement-breakpoint
UPDATE "courses" SET "instructor_id" = NULL
WHERE "instructor_id" IS NOT NULL AND "instructor_id" NOT IN (SELECT "id" FROM "staff_accounts");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_instructor_id_staff_accounts_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."staff_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 4. Via il collegamento vecchio e la tabella.
DROP INDEX IF EXISTS "staff_accounts_instructor_id_idx";--> statement-breakpoint
ALTER TABLE "staff_accounts" DROP COLUMN IF EXISTS "instructor_id";--> statement-breakpoint
DROP TABLE IF EXISTS "instructors";--> statement-breakpoint

-- 5. I permessi salvati nei nuovi moduli. Per ogni ruolo:
--    calendar → calendario, prenotazioni, corsi, sale (stesse azioni);
--    admin_users → utenti, ruoli, impostazioni;
--    crm_members o crm_leads in lettura → dashboard in lettura;
--    lezioni_istruttore e crm_documents si tolgono.
DO $$
DECLARE
	r record;
	nuovi jsonb;
BEGIN
	FOR r IN SELECT "id", "permessi" FROM "ruoli" LOOP
		nuovi := r."permessi" - 'lezioni_istruttore' - 'crm_documents' - 'calendar' - 'admin_users';
		IF r."permessi" ? 'calendar' THEN
			nuovi := nuovi || jsonb_build_object(
				'calendario', r."permessi"->'calendar',
				'prenotazioni', r."permessi"->'calendar',
				'corsi', r."permessi"->'calendar',
				'sale', r."permessi"->'calendar');
		END IF;
		IF r."permessi" ? 'admin_users' THEN
			nuovi := nuovi || jsonb_build_object(
				'utenti', r."permessi"->'admin_users',
				'ruoli', r."permessi"->'admin_users',
				'impostazioni', r."permessi"->'admin_users');
		END IF;
		IF (nuovi->'crm_members') ? 'view' OR (nuovi->'crm_leads') ? 'view' THEN
			nuovi := nuovi || '{"dashboard": ["view"]}'::jsonb;
		END IF;
		UPDATE "ruoli" SET "permessi" = nuovi WHERE "id" = r."id";
	END LOOP;
END $$;--> statement-breakpoint

-- 6. Il ruolo di sistema istruttore prende i predefiniti nuovi. Il ruolo admin si chiama
-- Administrator (il nome tecnico «admin» non cambia).
UPDATE "ruoli" SET "permessi" = '{"calendario": ["view", "edit", "suoi"], "prenotazioni": ["view", "edit", "suoi"], "corsi": ["view", "suoi"]}'::jsonb
WHERE "sistema" = true AND "nome" = 'istruttore';--> statement-breakpoint
UPDATE "ruoli" SET "label" = 'Administrator' WHERE "nome" = 'admin';

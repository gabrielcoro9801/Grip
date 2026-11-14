-- 0062_portale: il rifacimento del portale soci (docs/piani/portale.md). Una sola migrazione per
-- tutto il ramo D. Nessun DROP: member_documents, qr_accessi e consensi restano con i loro dati.
-- Il SQL scritto a mano (i controlli, i dati, i CHECK con condizione) è anche in _bozze/0062.sql.

-- 1. La categoria del corso diventa obbligatoria: il portale apre i corsi per categoria. Prima
-- si controlla, e se un corso ne è senza ci si ferma con il suo nome: va sistemato a mano.
DO $$
DECLARE senza text;
BEGIN
	SELECT string_agg("name", ', ' ORDER BY "name") INTO senza FROM "courses" WHERE "category_id" IS NULL;
	IF senza IS NOT NULL THEN
		RAISE EXCEPTION 'Corsi senza categoria: %. Dagli una categoria prima della migrazione 0062.', senza;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint

-- 2. Il consenso dei genitori diventa una spunta in anagrafica (R4): firmato per chi aveva il
-- documento caricato.
ALTER TABLE "members" ADD COLUMN "consenso_genitori_firmato" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "members" m SET "consenso_genitori_firmato" = true
WHERE EXISTS (SELECT 1 FROM "member_documents" d WHERE d."member_id" = m."id" AND d."document_type" = 'consenso_genitori');--> statement-breakpoint

-- 3. Le prenotazioni: perché le ha disdette la palestra (la sospensione), e l'offerta di un posto
-- a chi è in lista d'attesa. Le disdette di prima restano senza motivo: non si riprenotano.
ALTER TABLE "bookings" ADD COLUMN "motivo_disdetta" varchar(16);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "posto_offerto_fino_a" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_motivo_disdetta_valido" CHECK ("bookings"."motivo_disdetta" IS NULL OR "bookings"."motivo_disdetta" IN ('sospensione'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offerta_solo_in_attesa" CHECK ("bookings"."posto_offerto_fino_a" IS NULL OR "bookings"."status" = 'waitlisted');--> statement-breakpoint

-- 4. Le notifiche sanno di che lezione o di che fissa parlano. Le vecchie restano senza.
ALTER TABLE "notifiche" ADD COLUMN "lezione_id" uuid;--> statement-breakpoint
ALTER TABLE "notifiche" ADD COLUMN "fissa_id" uuid;--> statement-breakpoint
ALTER TABLE "notifiche" ADD CONSTRAINT "notifiche_lezione_id_sessions_id_fk" FOREIGN KEY ("lezione_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifiche" ADD CONSTRAINT "notifiche_fissa_id_prenotazioni_fisse_id_fk" FOREIGN KEY ("fissa_id") REFERENCES "public"."prenotazioni_fisse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifiche_lezione_id_idx" ON "notifiche" USING btree ("lezione_id");--> statement-breakpoint
CREATE INDEX "notifiche_fissa_id_idx" ON "notifiche" USING btree ("fissa_id");--> statement-breakpoint

-- 5. Niente più fisse senza fine. Quelle attive (nate dal portale) finiscono al minore fra la
-- fine dell'abbonamento che copre oggi e l'ultima lezione della sessione. La fine si legge da
-- `end_date`, senza lo slittamento delle sospensioni: è la data più corta, e al peggio il socio
-- riceve «Allunga». Senza un abbonamento oggi, o con una fine prima dell'inizio, si chiudono.
-- Attenzione a LEAST, che ignora i NULL: un abbonamento che manca non deve diventare «fino
-- all'ultima lezione».
UPDATE "prenotazioni_fisse" f SET "al" = fine."al"
FROM (
	SELECT x."id",
		CASE WHEN x."copertura" IS NULL OR x."ultima" IS NULL THEN NULL ELSE LEAST(x."copertura", x."ultima") END AS "al"
	FROM (
		SELECT pf."id",
			(SELECT max(COALESCE(s."end_date", DATE '9999-12-31')) FROM "subscriptions" s
				WHERE s."member_id" = pf."member_id"
					AND s."start_date" <= (now() AT TIME ZONE 'Europe/Rome')::date
					AND COALESCE(s."end_date", DATE '9999-12-31') >= (now() AT TIME ZONE 'Europe/Rome')::date) AS "copertura",
			(SELECT max(l."date") FROM "sessions" l WHERE l."event_id" = pf."event_id" AND l."status" = 'active') AS "ultima"
		FROM "prenotazioni_fisse" pf
		WHERE pf."attiva" AND pf."al" IS NULL
	) x
) fine
WHERE f."id" = fine."id" AND fine."al" IS NOT NULL AND fine."al" >= f."dal";--> statement-breakpoint
UPDATE "prenotazioni_fisse" SET "attiva" = false, "terminata_il" = (now() AT TIME ZONE 'Europe/Rome')::date
WHERE "attiva" AND "al" IS NULL;--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ADD CONSTRAINT "prenotazioni_fisse_attiva_con_fine" CHECK ("prenotazioni_fisse"."attiva" = false OR "prenotazioni_fisse"."al" IS NOT NULL);--> statement-breakpoint

-- 6. I documenti escono dall'applicazione: il permesso `crm_documents` dai ruoli salvati (salvando
-- un ruolo, un modulo sconosciuto si rifiuta), e i segnali e la soglia dei documenti dalle
-- impostazioni della palestra.
UPDATE "ruoli" SET "permessi" = "permessi" - 'crm_documents' WHERE "permessi" ? 'crm_documents';--> statement-breakpoint
UPDATE "organizations" SET "impostazioni" = jsonb_set(
	"impostazioni", '{segnali_spenti}',
	COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements("impostazioni"->'segnali_spenti') c
		WHERE c #>> '{}' NOT IN ('documento_scaduto', 'documento_in_scadenza')), '[]'::jsonb))
WHERE jsonb_typeof("impostazioni"->'segnali_spenti') = 'array';--> statement-breakpoint
UPDATE "organizations" SET "impostazioni" = "impostazioni" #- '{soglie,documentoInScadenzaGiorni}'
WHERE "impostazioni"->'soglie' ? 'documentoInScadenzaGiorni';

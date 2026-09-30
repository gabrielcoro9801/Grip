-- Vincoli che finora valevano solo perché il codice stava attento.
--
-- 1. Un account del portale per socio, e verso un socio che esiste.
-- 2. Una prenotazione viva per socio e lezione (oggi la garantisce solo il lock in transazione).
-- 3. Un codice d'accesso attivo per socio.
-- 4. Gli orari degli allenamenti con il fuso, come nelle altre tabelle.
--
-- Account e prenotazioni doppi vanno guardati da una persona: la migrazione si ferma dicendo
-- quali, come la 0038, invece di un errore di Postgres che non spiega niente. I codici d'accesso
-- doppi invece si sistemano da soli: resta attivo il più recente, gli altri passano a revocato.
-- Non si perde niente — il codice che il socio vede sul telefono lo calcola il server a ogni
-- minuto da quello attivo.
DO $$
DECLARE doppi text;
BEGIN
	SELECT string_agg(linked_member_id::text, ', ') INTO doppi
	FROM (SELECT linked_member_id FROM staff_accounts WHERE linked_member_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
	IF doppi IS NOT NULL THEN
		RAISE EXCEPTION 'Più account del portale collegati allo stesso socio (members.id): %. Tienine uno per socio, poi riavvia.', doppi;
	END IF;

	SELECT string_agg(a.email, ', ') INTO doppi
	FROM staff_accounts a
	WHERE a.linked_member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = a.linked_member_id);
	IF doppi IS NOT NULL THEN
		RAISE EXCEPTION 'Account collegati a un socio che non esiste più: %. Scollegali o eliminali, poi riavvia.', doppi;
	END IF;

	SELECT string_agg(session_id::text || '/' || member_id::text, ', ') INTO doppi
	FROM (SELECT session_id, member_id FROM bookings WHERE status <> 'cancelled' GROUP BY 1, 2 HAVING count(*) > 1) d;
	IF doppi IS NOT NULL THEN
		RAISE EXCEPTION 'Prenotazioni doppie sulla stessa lezione (session_id/member_id): %. Annulla quelle in più, poi riavvia.', doppi;
	END IF;
END $$;--> statement-breakpoint
UPDATE "qr_accessi" q SET "stato" = 'revocato'
WHERE q."stato" = 'attivo'
	AND EXISTS (
		SELECT 1 FROM "qr_accessi" altro
		WHERE altro."cliente_id" = q."cliente_id" AND altro."stato" = 'attivo'
			AND (altro."data_generazione", altro."id") > (q."data_generazione", q."id")
	);--> statement-breakpoint
-- Drizzle ha sempre scritto questi istanti in UTC (toISOString): senza `USING`, Postgres li
-- rileggerebbe nel fuso della sessione, e un allenamento delle 18:30 diventerebbe delle 16:30.
ALTER TABLE "workout_sessions" ALTER COLUMN "iniziata_alle" SET DATA TYPE timestamp with time zone USING "iniziata_alle" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "iniziata_alle" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "workout_sessions" ALTER COLUMN "terminata_alle" SET DATA TYPE timestamp with time zone USING "terminata_alle" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD CONSTRAINT "staff_accounts_linked_member_id_members_id_fk" FOREIGN KEY ("linked_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qr_accessi_attivo_unico_idx" ON "qr_accessi" USING btree ("cliente_id") WHERE "qr_accessi"."stato" = 'attivo';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_attiva_unica_idx" ON "bookings" USING btree ("session_id","member_id") WHERE "bookings"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "staff_accounts_linked_member_id_idx" ON "staff_accounts" USING btree ("linked_member_id");

-- Bozza della 0059 (sessione_un_giorno): la parte scritta a mano, fuori dal journal.
--
-- Una sessione (un evento `weekly`) si ripete in un giorno solo: `events.giorno` prende il posto
-- di `days_of_week`. Le sessioni su più giorni si dividono: la riga tiene il primo giorno della
-- settimana (lunedì prima di domenica), e per ogni altro giorno nasce una sessione nuova, con gli
-- stessi corso, sala, orari, capienza e date. Le lezioni di quel giorno passano alla sessione
-- nuova; le fisse la seguono. Una sessione «per N lezioni» diventa «fino a una data», quella
-- della sua ultima lezione: il conto era su tutti i giorni insieme, e diviso non vale più.
--
-- Dove va, nella migrazione generata da `drizzle-kit generate`:
--   1. ALTER TABLE "events" ADD COLUMN "giorno" varchar(9);      (generato)
--   2. questo blocco;
--   3. i due ADD CONSTRAINT su "events" (giorno valido, settimanale con giorno);   (generati)
--   4. ALTER TABLE "events" DROP COLUMN "days_of_week";           (generato, per ultimo)
-- Legge `prenotazioni_fisse.giorni`, che toglie la 0060: l'ordine è obbligato.
--
-- Una lezione che non cade in nessun giorno della sua sessione (salvata un giorno prima, vedi
-- `npm run db:ripara-date-settimanali`, o spostata a mano) resta sulla riga di partenza: il
-- blocco le conta e lo dice in un NOTICE.

DO $$
DECLARE
	ordine CONSTANT text[] := ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
	e record;
	f record;
	giorni_evento text[];
	scelti text[];
	nuova uuid;
	per_giorno jsonb;
	g text;
	i int;
	fuori int;
	divise int := 0;
	nate int := 0;
BEGIN
	FOR e IN SELECT * FROM "events" WHERE "recurrence_type" = 'weekly' ORDER BY "created_date", "id" LOOP
		-- I giorni della sessione, in ordine di settimana, senza doppioni né nomi sconosciuti.
		SELECT array_agg(d ORDER BY array_position(ordine, d)) INTO giorni_evento
		FROM (
			SELECT DISTINCT d FROM jsonb_array_elements_text(
				CASE WHEN jsonb_typeof(e."days_of_week") = 'array' THEN e."days_of_week" ELSE '[]'::jsonb END
			) AS d
			WHERE d = ANY (ordine)
		) AS x;
		-- Una settimanale senza giorni non dovrebbe esistere: prende quello della sua prima lezione,
		-- o del suo inizio.
		IF giorni_evento IS NULL THEN
			giorni_evento := ARRAY[ordine[extract(isodow FROM coalesce(
				(SELECT min("date") FROM "sessions" WHERE "event_id" = e."id"), e."start_date"))::int]];
		END IF;

		UPDATE "events" SET "giorno" = giorni_evento[1] WHERE "id" = e."id";
		per_giorno := jsonb_build_object(giorni_evento[1], e."id");

		IF array_length(giorni_evento, 1) > 1 THEN
			divise := divise + 1;
			FOR i IN 2..array_length(giorni_evento, 1) LOOP
				g := giorni_evento[i];
				INSERT INTO "events" ("course_id", "room_id", "capacity", "recurrence_type", "giorno", "start_date",
						"end_condition", "end_date", "occurrence_count", "custom_dates", "start_time", "end_time", "created_date")
					VALUES (e."course_id", e."room_id", e."capacity", 'weekly', g, e."start_date",
						e."end_condition", e."end_date", e."occurrence_count", e."custom_dates", e."start_time", e."end_time", e."created_date")
					RETURNING "id" INTO nuova;
				nate := nate + 1;
				per_giorno := per_giorno || jsonb_build_object(g, nuova);
				-- Le lezioni di quel giorno della settimana passano alla sessione nuova.
				UPDATE "sessions" SET "event_id" = nuova
					WHERE "event_id" = e."id" AND extract(isodow FROM "date")::int = array_position(ordine, g);
			END LOOP;

			-- Le fisse: senza giorni scelti valgono per tutti, e si copiano su ogni sessione nuova;
			-- con i giorni scelti vanno su quelli (la riga sul primo, una copia per gli altri).
			FOR f IN SELECT * FROM "prenotazioni_fisse" WHERE "event_id" = e."id" LOOP
				IF jsonb_typeof(f."giorni") = 'array' AND jsonb_array_length(f."giorni") > 0 THEN
					SELECT array_agg(d ORDER BY array_position(ordine, d)) INTO scelti
					FROM (SELECT DISTINCT d FROM jsonb_array_elements_text(f."giorni") AS d WHERE d = ANY (giorni_evento)) AS x;
				ELSE
					scelti := giorni_evento;
				END IF;
				-- Giorni scelti che la sessione non ha: la fissa resta dov'è.
				CONTINUE WHEN scelti IS NULL;
				UPDATE "prenotazioni_fisse" SET "event_id" = (per_giorno ->> scelti[1])::uuid, "giorni" = NULL WHERE "id" = f."id";
				IF array_length(scelti, 1) > 1 THEN
					FOR i IN 2..array_length(scelti, 1) LOOP
						INSERT INTO "prenotazioni_fisse" ("member_id", "event_id", "giorni", "attiva", "creata_da",
								"avviso_inviato_per", "terminata_il", "created_date")
							VALUES (f."member_id", (per_giorno ->> scelti[i])::uuid, NULL, f."attiva", f."creata_da",
								f."avviso_inviato_per", f."terminata_il", f."created_date");
					END LOOP;
				END IF;
			END LOOP;
		END IF;

		SELECT count(*) INTO fuori FROM "sessions"
			WHERE "event_id" = e."id" AND extract(isodow FROM "date")::int <> array_position(ordine, giorni_evento[1]);
		IF fuori > 0 THEN
			RAISE NOTICE 'Sessione %: % lezioni fuori dal suo giorno (%), restano dove sono', e."id", fuori, giorni_evento[1];
		END IF;
	END LOOP;

	-- «Per N lezioni» diventa «fino all'ultima lezione».
	UPDATE "events" AS ev SET
		"end_condition" = 'by_date',
		"end_date" = coalesce((SELECT max(s."date") FROM "sessions" AS s WHERE s."event_id" = ev."id"), ev."start_date"),
		"occurrence_count" = NULL
	WHERE ev."recurrence_type" = 'weekly' AND ev."end_condition" = 'by_count';

	RAISE NOTICE 'Sessioni divise: %, sessioni nuove: %', divise, nate;
END $$;

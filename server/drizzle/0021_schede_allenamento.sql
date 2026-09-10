-- Le schede di allenamento diventano modelli riusabili + schede di un socio, e ogni
-- esercizio della scheda porta le proprie serie.
--
-- Scritta a mano perché drizzle-kit, davanti a una colonna aggiunta e due tolte sulla
-- stessa tabella, chiede in interattivo se sia un rinomino — e perché la parte che conta
-- qui non è il DDL ma la conversione dei dati già presenti, che generate non sa scrivere.

--> statement-breakpoint
-- 1. Il catalogo esercizi: una descrizione al posto dei valori predefiniti.
ALTER TABLE "exercises" ADD COLUMN "description" text;--> statement-breakpoint

-- 2. La scheda: modello del catalogo oppure scheda di un socio.
--    `member_id` perde il vincolo NOT NULL perché un modello non è di nessuno.
ALTER TABLE "exercise_plans" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_plans" ADD COLUMN "template_origin_id" uuid;--> statement-breakpoint
ALTER TABLE "exercise_plans" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint

-- 3. I gruppi muscolari passano dai nove nomi inglesi al catalogo di
--    shared/gruppiMuscolari.js. Le corrispondenze non sono tutte esatte — "Legs" copriva
--    quadricipiti, femorali, glutei e polpacci insieme, "Back" dorsali e trapezi — quindi
--    ogni riga finisce sul gruppo più vicino e andrà rivista a mano dove serve: meglio un
--    gruppo approssimato e visibile che una riga che sparisce dai filtri.
UPDATE "exercises" SET "muscle_group" = CASE "muscle_group"
	WHEN 'Chest' THEN 'petto'
	WHEN 'Back' THEN 'dorsali'
	WHEN 'Shoulders' THEN 'spalle'
	WHEN 'Biceps' THEN 'bicipiti'
	WHEN 'Triceps' THEN 'tricipiti'
	WHEN 'Legs' THEN 'quadricipiti'
	WHEN 'Core' THEN 'addominali'
	WHEN 'Full Body' THEN 'corpo_intero'
	WHEN 'Cardio' THEN 'cardio'
END
WHERE "muscle_group" IN ('Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Full Body', 'Cardio');--> statement-breakpoint

-- Quello che non era nell'elenco inglese — righe scritte a mano, o mai categorizzate —
-- finisce su "altro", che è un gruppo vero del catalogo e non un buco.
UPDATE "exercises" SET "muscle_group" = 'altro'
WHERE "muscle_group" IS NULL OR "muscle_group" NOT IN (
	'addominali', 'avambracci', 'bicipiti', 'collo', 'dorsali', 'schiena_bassa',
	'schiena_alta', 'petto', 'spalle', 'trapezi', 'tricipiti',
	'abduttori', 'adduttori', 'femorali', 'glutei', 'polpacci', 'quadricipiti',
	'cardio', 'corpo_intero', 'altro'
);--> statement-breakpoint

UPDATE "workout_logs" SET "muscle_group" = CASE "muscle_group"
	WHEN 'Chest' THEN 'petto'
	WHEN 'Back' THEN 'dorsali'
	WHEN 'Shoulders' THEN 'spalle'
	WHEN 'Biceps' THEN 'bicipiti'
	WHEN 'Triceps' THEN 'tricipiti'
	WHEN 'Legs' THEN 'quadricipiti'
	WHEN 'Core' THEN 'addominali'
	WHEN 'Full Body' THEN 'corpo_intero'
	WHEN 'Cardio' THEN 'cardio'
END
WHERE "muscle_group" IN ('Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Core', 'Full Body', 'Cardio');--> statement-breakpoint

-- 4. Il contenuto delle schede già assegnate.
--
--    Prima un esercizio era una riga sola — `sets: 3, reps: "10"` — e le tre serie
--    esistevano solo come numero. Ora ogni serie è una riga sua, quindi `sets` viene
--    espanso: 3×10 diventa tre righe da 10 ripetizioni, con lo stesso RPE su ognuna.
--    È la lettura fedele di quello che il vecchio formato voleva dire.
--
--    Il `peso` per esercizio non ha più un posto: nel nuovo formato la serie porta
--    ripetizioni e RPE, il carico lo registra il socio allenandosi. Le schede esistenti lo
--    perdono, ed è l'unica informazione che questa migrazione non conserva.
--    Le due aggregazioni — le serie dentro l'esercizio, gli esercizi dentro la scheda —
--    stanno in due CTE distinte e non una annidata nell'altra: l'aggregato interno
--    leggerebbe una colonna del livello esterno, e Postgres lo tratterebbe come un
--    aggregato dentro un aggregato, che non accetta.
WITH esploso AS (
	-- Una riga per ogni serie da creare: l'esercizio ripetuto `sets` volte.
	-- Un `sets` mancante o non numerico vale una serie: perdere l'esercizio sarebbe peggio
	-- che mostrarne una sola.
	SELECT p."id" AS scheda_id, t.ord, t.vecchio, s.n
	FROM "exercise_plans" p
	CROSS JOIN LATERAL jsonb_array_elements(p."exercises") WITH ORDINALITY AS t(vecchio, ord)
	CROSS JOIN LATERAL generate_series(1, GREATEST(
		COALESCE(NULLIF(regexp_replace(COALESCE(t.vecchio->>'sets', ''), '\D', '', 'g'), '')::int, 1),
		1
	)) AS s(n)
	WHERE jsonb_typeof(p."exercises") = 'array' AND jsonb_array_length(p."exercises") > 0
),
con_serie AS (
	SELECT scheda_id, ord, vecchio, jsonb_agg(jsonb_build_object(
		'reps', COALESCE(vecchio->>'reps', ''),
		'rpe', CASE WHEN jsonb_typeof(vecchio->'rpe') = 'number'
			THEN vecchio->'rpe' ELSE 'null'::jsonb END
	) ORDER BY n) AS serie
	FROM esploso
	GROUP BY scheda_id, ord, vecchio
),
convertite AS (
	SELECT scheda_id, jsonb_agg(
		jsonb_build_object(
			-- Le schede vecchie non avevano un legame col catalogo: l'esercizio era solo
			-- un nome copiato. Resta nullo, e la scheda continua a mostrare quel nome.
			'exercise_id', NULL::uuid,
			'exercise_name', vecchio->>'exercise_name',
			'muscle_group', COALESCE(m.codice, 'altro'),
			'recupero_secondi', NULL::integer,
			'note', '',
			'serie', serie
		) ORDER BY ord
	) AS esercizi
	FROM con_serie
	LEFT JOIN (VALUES
		('Chest', 'petto'),
		('Back', 'dorsali'),
		('Shoulders', 'spalle'),
		('Biceps', 'bicipiti'),
		('Triceps', 'tricipiti'),
		('Legs', 'quadricipiti'),
		('Core', 'addominali'),
		('Full Body', 'corpo_intero'),
		('Cardio', 'cardio')
	) AS m(inglese, codice) ON m.inglese = vecchio->>'muscle_group'
	GROUP BY scheda_id
)
UPDATE "exercise_plans" p SET "exercises" = c.esercizi
FROM convertite c WHERE c.scheda_id = p."id";--> statement-breakpoint

-- 5. Serie e ripetizioni predefinite non hanno più senso sul catalogo: sono una proprietà
--    della scheda, non dell'esercizio. Si tolgono solo ora, a conversione avvenuta.
ALTER TABLE "exercises" DROP COLUMN IF EXISTS "default_sets";--> statement-breakpoint
ALTER TABLE "exercises" DROP COLUMN IF EXISTS "default_reps";

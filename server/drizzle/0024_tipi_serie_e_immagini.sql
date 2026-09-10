-- Due aggiunte che il jsonb delle schede non può coprire da solo.
--
-- Superset e circuiti non compaiono qui: sono un campo `gruppo` sull'esercizio dentro
-- `routines`, e il jsonb non ha bisogno di una migrazione per accoglierlo.

--> statement-breakpoint
-- 1. L'immagine dell'esercizio. Il percorso è quello che restituisce /api/uploads, servito
--    da /uploads/* — che in produzione sta sul volume persistente, non nel container.
ALTER TABLE "exercises" ADD COLUMN "image_url" varchar(512);--> statement-breakpoint

-- 2. Come contava una serie eseguita.
--
--    La scheda dice già di che tipo è ogni serie, ma la scheda cambia: se fra due mesi il
--    riscaldamento diventa una serie di lavoro, tutti gli allenamenti passati si
--    ricalcolerebbero da soli e il confronto con il mese scorso cambierebbe senza che
--    nessuno abbia toccato quegli allenamenti. Il tipo va congelato quando la serie viene
--    eseguita, come già si fa col nome dell'esercizio.
ALTER TABLE "workout_logs" ADD COLUMN "tipo_serie" varchar(16) DEFAULT 'normale';--> statement-breakpoint

-- Le righe già registrate sono tutte serie di lavoro: quando sono state scritte i tipi non
-- esistevano, e nessuno le ha mai marcate come riscaldamento.
UPDATE "workout_logs" SET "tipo_serie" = 'normale' WHERE "tipo_serie" IS NULL;

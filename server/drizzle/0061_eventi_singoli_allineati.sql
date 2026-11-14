-- Un evento singolo (recurrence_type = 'single') riprende sala, giorno, orario e capienza della sua
-- lezione. Fino a qui una lezione singola modificata dalla sua pagina cambiava solo `sessions`, e
-- l'uso delle sale, che legge anche `events`, vedeva la sala di partenza ancora occupata.
-- Solo gli eventi con una lezione sola: se ne avessero di più non si saprebbe quale seguire.
UPDATE "events" e
SET "room_id" = s."room_id", "start_date" = s."date", "start_time" = s."start_time",
    "end_time" = s."end_time", "capacity" = s."capacity"
FROM "sessions" s
WHERE e."recurrence_type" = 'single'
  AND s."event_id" = e."id"
  AND (SELECT count(*) FROM "sessions" x WHERE x."event_id" = e."id") = 1
  AND (e."room_id", e."start_date", e."start_time", e."end_time", e."capacity")
      IS DISTINCT FROM (s."room_id", s."date", s."start_time", s."end_time", s."capacity");

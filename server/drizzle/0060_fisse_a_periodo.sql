ALTER TABLE "bookings" ADD COLUMN "prenotazione_fissa_id" uuid;--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ADD COLUMN "dal" date;--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ADD COLUMN "al" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_prenotazione_fissa_id_prenotazioni_fisse_id_fk" FOREIGN KEY ("prenotazione_fissa_id") REFERENCES "public"."prenotazioni_fisse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_prenotazione_fissa_id_idx" ON "bookings" USING btree ("prenotazione_fissa_id");--> statement-breakpoint
-- Bozza della 0060 (fisse_a_periodo): la parte scritta a mano, fuori dal journal.
--
-- Una prenotazione fissa vale da una data (`dal`) a un'altra (`al`, vuota = senza fine). Le fisse
-- di prima cominciano il giorno in cui sono nate e restano senza fine: si comportano come prima.
-- Ogni prenotazione sa da quale fissa è nata (`bookings.prenotazione_fissa_id`): cancellando la
-- fissa si disdicono solo quelle.
--
-- Dove va, nella migrazione generata da `drizzle-kit generate`:
--   1. ALTER TABLE "prenotazioni_fisse" ADD COLUMN "dal" date;   (generato con NOT NULL: il NOT NULL
--      si toglie da qui, la tabella può avere righe, e si rimette al passo 3)
--      ALTER TABLE "prenotazioni_fisse" ADD COLUMN "al" date;    (generato)
--      ALTER TABLE "bookings" ADD COLUMN "prenotazione_fissa_id" uuid;, la sua FK e il suo indice (generati)
--   2. questi due UPDATE;
--   3. ALTER TABLE "prenotazioni_fisse" ALTER COLUMN "dal" SET NOT NULL;   (scritto a mano)
--      e il CHECK "prenotazioni_fisse_periodo_valido" (generato);
--   4. ALTER TABLE "prenotazioni_fisse" DROP COLUMN "giorni";     (generato, per ultimo)
--
-- La ricostruzione è un'ipotesi (vedi docs/piani/corsi.md, «Rischi»): una prenotazione del socio
-- su una lezione della sessione della fissa, fatta da quando la fissa è nata (e, se è stata
-- terminata, fino a quel giorno), è della fissa. Una prenotazione fatta a mano in quel periodo
-- risulta «Fissa»: cancellando la fissa si disdice anche lei. Se un socio ha avuto più fisse sulla
-- stessa sessione, la prenotazione va alla più recente nata prima di lei.

UPDATE "prenotazioni_fisse" SET "dal" = ("created_date" AT TIME ZONE 'Europe/Rome')::date WHERE "dal" IS NULL;
--> statement-breakpoint
UPDATE "bookings" AS b SET "prenotazione_fissa_id" = scelta."fissa_id"
FROM (
	SELECT DISTINCT ON (p."id") p."id" AS "booking_id", f."id" AS "fissa_id"
	FROM "bookings" AS p
	JOIN "sessions" AS s ON s."id" = p."session_id"
	JOIN "prenotazioni_fisse" AS f ON f."member_id" = p."member_id" AND f."event_id" = s."event_id"
	WHERE p."created_date" >= f."created_date"
		AND s."date" >= f."dal"
		AND (f."terminata_il" IS NULL OR (p."created_date" AT TIME ZONE 'Europe/Rome')::date <= f."terminata_il")
	ORDER BY p."id", f."created_date" DESC
) AS scelta
WHERE b."id" = scelta."booking_id" AND b."prenotazione_fissa_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ALTER COLUMN "dal" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ADD CONSTRAINT "prenotazioni_fisse_periodo_valido" CHECK ("prenotazioni_fisse"."al" IS NULL OR "prenotazioni_fisse"."al" >= "prenotazioni_fisse"."dal");--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" DROP COLUMN "giorni";
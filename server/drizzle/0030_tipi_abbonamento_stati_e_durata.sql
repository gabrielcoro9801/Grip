-- I tipi di abbonamento: durata in giorni, mesi o anni, una data massima di vendita, uno stato
-- al posto di "attivo sì/no", e niente più ingressi (Grip non prevede carnet).
--
-- Le colonne nuove nascono vuote e si riempiono da quelle vecchie, che la migrazione 0031 toglie.
ALTER TABLE "plans" ADD COLUMN "durata_valore" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "durata_unita" varchar(8);--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "vendibile_fino_al" date;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "stato" varchar(12) DEFAULT 'attivo' NOT NULL;--> statement-breakpoint
-- I giorni diventano anni o mesi quando lo erano chiaramente: 365 → 1 anno, 30/90/180 → 1/3/6
-- mesi. Il resto resta in giorni.
UPDATE "plans" SET
	"durata_valore" = CASE
		WHEN "duration_days" % 365 = 0 THEN "duration_days" / 365
		WHEN "duration_days" % 30 = 0 THEN "duration_days" / 30
		ELSE "duration_days" END,
	"durata_unita" = CASE
		WHEN "duration_days" % 365 = 0 THEN 'anni'
		WHEN "duration_days" % 30 = 0 THEN 'mesi'
		ELSE 'giorni' END,
	"stato" = CASE WHEN "is_active" THEN 'attivo' ELSE 'sospeso' END;--> statement-breakpoint
UPDATE "plans" SET "durata_valore" = 1, "durata_unita" = 'mesi' WHERE "durata_valore" IS NULL OR "durata_valore" < 1;--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "durata_valore" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "durata_unita" SET NOT NULL;--> statement-breakpoint
-- Le note diventano di 140 caratteri: quelle più lunghe si accorciano, non si perde la riga.
ALTER TABLE "plans" ALTER COLUMN "description" SET DATA TYPE varchar(140) USING left("description", 140);--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "sessions_remaining";--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_durata_unita_valida" CHECK ("plans"."durata_unita" IN ('giorni', 'mesi', 'anni'));--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_durata_positiva" CHECK ("plans"."durata_valore" > 0);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_stato_valido" CHECK ("plans"."stato" IN ('attivo', 'sospeso', 'annullato'));

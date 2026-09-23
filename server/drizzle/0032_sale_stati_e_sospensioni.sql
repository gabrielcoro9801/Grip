-- Le sale: due stati (attiva o sospesa), la sospensione come periodo da data a data, e le note
-- di 140 caratteri come quelle degli abbonamenti.
--
-- La capienza la toglie la migrazione 0033: qui non serve più a nessuno, ma gli eventi la
-- ereditano ancora finché il codice nuovo non è quello in esecuzione.
--
-- Le note più lunghe si accorciano, non si perde la riga.
ALTER TABLE "rooms" ALTER COLUMN "description" SET DATA TYPE varchar(140) USING left("description", 140);--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "stato" varchar(12) DEFAULT 'attivo' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "sospesa_dal" date;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "sospesa_al" date;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_stato_valido" CHECK ("rooms"."stato" IN ('attivo', 'sospeso'));--> statement-breakpoint
-- Sospesa vuol dire "da questo giorno a quest'altro": una sospensione senza date, o delle date
-- su una sala attiva, sarebbero due modi di dire una cosa che il resto del codice legge in un
-- modo solo.
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_sospensione_coerente" CHECK (("rooms"."stato" = 'sospeso' AND "rooms"."sospesa_dal" IS NOT NULL AND "rooms"."sospesa_al" IS NOT NULL AND "rooms"."sospesa_al" >= "rooms"."sospesa_dal")
			OR ("rooms"."stato" = 'attivo' AND "rooms"."sospesa_dal" IS NULL AND "rooms"."sospesa_al" IS NULL));

-- Una sala può anche essere annullata: la stanza non c'è più, o non è più una sala, e non ci si
-- programma più niente. È definitivo, ed è la ragione per cui esiste accanto a "sospesa".
--
-- Serve perché una sala che ha ospitato lezioni vere non si può eliminare senza togliere il
-- "dove" a un pezzo di calendario già accaduto. Annullarla la toglie di mezzo da qui in avanti
-- e lascia il passato dov'è.
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_stato_valido";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_sospensione_coerente";--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_stato_valido" CHECK ("rooms"."stato" IN ('attivo', 'sospeso', 'annullato'));--> statement-breakpoint
-- Le date sono la sospensione: ci sono se e solo se la sala è sospesa. Prima il vincolo diceva
-- "attivo", che con un terzo stato avrebbe rifiutato ogni sala annullata.
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_sospensione_coerente" CHECK (("rooms"."stato" = 'sospeso' AND "rooms"."sospesa_dal" IS NOT NULL AND "rooms"."sospesa_al" IS NOT NULL AND "rooms"."sospesa_al" >= "rooms"."sospesa_dal")
			OR ("rooms"."stato" <> 'sospeso' AND "rooms"."sospesa_dal" IS NULL AND "rooms"."sospesa_al" IS NULL));

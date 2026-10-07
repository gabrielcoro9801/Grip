-- Le note di un contatto (140 caratteri), e da dove viene un socio nato da un contatto:
-- canale e giorno del primo contatto, scritti dalla trasformazione. Servono ad Andamento
-- per contare le conversioni, visto che il lead poi si cancella.
ALTER TABLE "members" ADD COLUMN "lead_canale_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "lead_data_contatto" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "note" varchar(140);--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_lead_canale_id_canali_contatto_id_fk" FOREIGN KEY ("lead_canale_id") REFERENCES "public"."canali_contatto"("id") ON DELETE restrict ON UPDATE no action;
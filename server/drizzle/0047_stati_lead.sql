-- Gli stati dei lead (shared/lead.js) e il loro diario. I lead esistenti partono da "nuovo",
-- dal giorno in cui ci hanno contattato.
CREATE TABLE "lead_attivita" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"tipo" varchar(24) NOT NULL,
	"canale" varchar(16),
	"esito" varchar(32),
	"nota" varchar(140),
	"autore_id" uuid,
	"autore_nome" varchar(255) NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "stato" varchar(24) DEFAULT 'nuovo' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "stato_dal" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tentativi_senza_risposta" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ultimo_contatto_il" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ultima_risposta_il" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "richiamare_il" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "motivo_chiusura" varchar(32);--> statement-breakpoint
ALTER TABLE "lead_attivita" ADD CONSTRAINT "lead_attivita_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_attivita" ADD CONSTRAINT "lead_attivita_autore_id_staff_accounts_id_fk" FOREIGN KEY ("autore_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_attivita_lead_id_idx" ON "lead_attivita" USING btree ("lead_id","created_date");--> statement-breakpoint
CREATE INDEX "leads_stato_idx" ON "leads" USING btree ("stato");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stato_valido" CHECK ("leads"."stato" IN ('nuovo', 'in_attesa', 'in_conversazione', 'da_richiamare', 'non_raggiungibile', 'non_interessato'));--> statement-breakpoint
UPDATE "leads" SET "stato_dal" = "data_contatto";

-- Le prenotazioni fisse: un posto tenuto ogni settimana in una serie.
CREATE TABLE "prenotazioni_fisse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"giorni" jsonb,
	"attiva" boolean DEFAULT true NOT NULL,
	"creata_da" varchar(255),
	"avviso_inviato_per" date,
	"terminata_il" date,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ADD CONSTRAINT "prenotazioni_fisse_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prenotazioni_fisse" ADD CONSTRAINT "prenotazioni_fisse_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prenotazioni_fisse_member_id_idx" ON "prenotazioni_fisse" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "prenotazioni_fisse_event_id_idx" ON "prenotazioni_fisse" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prenotazioni_fisse_attiva_unica_idx" ON "prenotazioni_fisse" USING btree ("member_id","event_id") WHERE "prenotazioni_fisse"."attiva";
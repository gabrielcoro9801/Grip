CREATE TABLE "messaggi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"persona_id" uuid,
	"playbook" varchar(32) NOT NULL,
	"canale" varchar(16) NOT NULL,
	"destinatario" varchar(255),
	"oggetto" varchar(200),
	"testo" text NOT NULL,
	"chiave" varchar(255) NOT NULL,
	"stato" varchar(20) NOT NULL,
	"motivo" varchar(255),
	"costo_centesimi" integer DEFAULT 0 NOT NULL,
	"id_fornitore" varchar(255),
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"inviato_il" timestamp with time zone,
	CONSTRAINT "messaggi_canale_valido" CHECK ("messaggi"."canale" IN ('app', 'email', 'sms')),
	CONSTRAINT "messaggi_stato_valido" CHECK ("messaggi"."stato" IN ('simulato', 'in_coda', 'inviato', 'consegnato', 'fallito', 'bloccato_consenso', 'bloccato_budget', 'bloccato_silenzio'))
);
--> statement-breakpoint
CREATE TABLE "modelli_messaggio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook" varchar(32) NOT NULL,
	"canale" varchar(16) NOT NULL,
	"oggetto" varchar(200),
	"testo" text NOT NULL,
	"autore_nome" varchar(255) NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segreti_canali" (
	"organization_id" uuid NOT NULL,
	"canale" varchar(16) NOT NULL,
	"cifrato" text NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segreti_canali_organization_id_canale_pk" PRIMARY KEY("organization_id","canale")
);
--> statement-breakpoint
ALTER TABLE "consensi" DROP CONSTRAINT "consensi_fonte_valida";--> statement-breakpoint
ALTER TABLE "messaggi" ADD CONSTRAINT "messaggi_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaggi" ADD CONSTRAINT "messaggi_persona_id_persone_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelli_messaggio" ADD CONSTRAINT "modelli_messaggio_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segreti_canali" ADD CONSTRAINT "segreti_canali_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaggi_chiave_unica" ON "messaggi" USING btree ("chiave");--> statement-breakpoint
CREATE INDEX "messaggi_organization_id_created_date_idx" ON "messaggi" USING btree ("organization_id","created_date");--> statement-breakpoint
CREATE INDEX "messaggi_persona_id_idx" ON "messaggi" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "messaggi_in_coda_idx" ON "messaggi" USING btree ("created_date") WHERE "messaggi"."stato" = 'in_coda';--> statement-breakpoint
CREATE UNIQUE INDEX "modelli_messaggio_unico" ON "modelli_messaggio" USING btree ("organization_id","playbook","canale");--> statement-breakpoint
ALTER TABLE "consensi" ADD CONSTRAINT "consensi_fonte_valida" CHECK ("consensi"."fonte" IN ('portale', 'reception', 'form', 'disiscrizione'));--> statement-breakpoint
-- La sezione Comunicazioni (modulo crm_comunicazioni): solo l'amministratore. I ruoli salvati
-- sostituiscono la matrice predefinita invece di completarla (lib/ruoli.js): senza questa riga
-- il modulo non esisterebbe per nessuno sulle installazioni già avviate. Gli altri ruoli non lo
-- ricevono: un modulo che manca vale "nessun accesso".
UPDATE "ruoli" SET "permessi" = "permessi" || '{"crm_comunicazioni": ["view", "edit"]}'::jsonb
WHERE "sistema" = true AND "nome" = 'admin' AND NOT ("permessi" ? 'crm_comunicazioni');

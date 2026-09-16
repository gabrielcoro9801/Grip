CREATE TABLE IF NOT EXISTS "lead_attivita" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"tipo" varchar(32) NOT NULL,
	"testo" text DEFAULT '' NOT NULL,
	"autore_id" uuid,
	"autore_nome" varchar(255) DEFAULT '' NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_attivita_tipo_valido" CHECK ("lead_attivita"."tipo" IN ('nota', 'chiamata', 'incontro', 'cambio_stato', 'prova'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(64),
	"fonte" varchar(32) DEFAULT 'altro' NOT NULL,
	"fonte_dettaglio" text,
	"corso_interesse_id" uuid,
	"obiettivo" text,
	"note" text,
	"stato" varchar(32) DEFAULT 'nuovo' NOT NULL,
	"motivo_perdita" varchar(32),
	"prossima_azione_il" date,
	"prossima_azione_nota" text,
	"consenso_privacy" boolean DEFAULT false NOT NULL,
	"consenso_privacy_data" date,
	"consenso_marketing" boolean DEFAULT false NOT NULL,
	"consenso_marketing_data" date,
	"convertito_member_id" uuid,
	"convertito_il" timestamp with time zone,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_stato_valido" CHECK ("leads"."stato" IN ('nuovo', 'contattato', 'prova_prenotata', 'prova_svolta', 'proposta', 'iscritto', 'perso')),
	CONSTRAINT "leads_fonte_valida" CHECK ("leads"."fonte" IN ('passaggio', 'telefono', 'instagram', 'facebook', 'sito', 'passaparola', 'altro'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "consenso_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "consenso_marketing_data" date;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "presenza" varchar(16);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_attivita" ADD CONSTRAINT "lead_attivita_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_corso_interesse_id_courses_id_fk" FOREIGN KEY ("corso_interesse_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_convertito_member_id_members_id_fk" FOREIGN KEY ("convertito_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_attivita_lead_idx" ON "lead_attivita" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_stato_idx" ON "leads" USING btree ("stato");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_un_intestatario" CHECK (num_nonnulls("bookings"."member_id", "bookings"."lead_id") = 1);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_presenza_valida" CHECK ("bookings"."presenza" IS NULL OR "bookings"."presenza" IN ('presente', 'assente'));--> statement-breakpoint
-- I ruoli salvati sostituiscono la matrice predefinita invece di completarla (vedi
-- caricaMatrice in src/lib/ruoli.js): senza queste righe il modulo dei lead non esisterebbe
-- per nessuno sulle installazioni già avviate. Si tocca solo chi non ne ha già una
-- definizione, così una scelta fatta a mano non viene sovrascritta.
UPDATE "ruoli" SET "permessi" = "permessi" || '{"crm_leads": ["view", "edit"]}'::jsonb
WHERE "sistema" = true AND "nome" IN ('admin', 'reception') AND NOT ("permessi" ? 'crm_leads');--> statement-breakpoint
UPDATE "ruoli" SET "permessi" = "permessi" || '{"crm_leads": ["view"]}'::jsonb
WHERE "sistema" = true AND "nome" = 'istruttore' AND NOT ("permessi" ? 'crm_leads');

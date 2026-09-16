CREATE TABLE IF NOT EXISTS "canali_contatto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(80) NOT NULL,
	"attivo" boolean DEFAULT true NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canali_contatto_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" varchar(120) NOT NULL,
	"cognome" varchar(120) NOT NULL,
	"telefono" varchar(64),
	"email" varchar(255),
	"data_contatto" date NOT NULL,
	"canale_id" uuid NOT NULL,
	"sesso" varchar(8) NOT NULL,
	"anno_nascita" integer,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_sesso_valido" CHECK ("leads"."sesso" IN ('M', 'F', 'altro')),
	CONSTRAINT "leads_anno_nascita_valido" CHECK ("leads"."anno_nascita" IS NULL OR "leads"."anno_nascita" BETWEEN 1900 AND 2100)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_canale_id_canali_contatto_id_fk" FOREIGN KEY ("canale_id") REFERENCES "public"."canali_contatto"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_data_contatto_idx" ON "leads" USING btree ("data_contatto");--> statement-breakpoint
-- I canali di partenza. Sono dati, non codice: l'ente li rinomina, ne aggiunge, disattiva
-- quelli che non usa.
INSERT INTO "canali_contatto" ("nome") VALUES
	('Instagram'), ('Facebook'), ('Telefono'), ('Passaparola'), ('In sede'), ('Sito web')
ON CONFLICT ("nome") DO NOTHING;

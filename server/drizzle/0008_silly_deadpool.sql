CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"cliente_id" uuid NOT NULL,
	"cliente_name" varchar(255),
	"cliente_piva" varchar(32),
	"cliente_indirizzo" text,
	"journal_entry_id" uuid,
	"numero_progressivo" integer NOT NULL,
	"esercizio_fiscale" integer NOT NULL,
	"data_emissione" date NOT NULL,
	"descrizione" text,
	"imponibile" numeric(12, 2) NOT NULL,
	"iva" numeric(12, 2) DEFAULT '0' NOT NULL,
	"aliquota_iva" numeric(5, 2) DEFAULT '0' NOT NULL,
	"totale" numeric(12, 2) NOT NULL,
	"stato" varchar(16) DEFAULT 'emessa' NOT NULL,
	"pdf_url" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cliente_id_clients_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

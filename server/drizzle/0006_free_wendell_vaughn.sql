CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"numero_ordine" integer,
	"fornitore_id" uuid NOT NULL,
	"data_ordine" date NOT NULL,
	"descrizione" text NOT NULL,
	"importo_previsto" numeric(12, 2) NOT NULL,
	"conto_costo_id" uuid,
	"natura_fiscale" varchar(32),
	"stato" varchar(16) DEFAULT 'ordinato' NOT NULL,
	"data_consegna" date,
	"journal_entry_id" uuid,
	"numero_fattura" varchar(64),
	"data_fattura" date,
	"importo_fatturato" numeric(12, 2),
	"note" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_fornitore_id_accounting_suppliers_id_fk" FOREIGN KEY ("fornitore_id") REFERENCES "public"."accounting_suppliers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_conto_costo_id_chart_of_accounts_id_fk" FOREIGN KEY ("conto_costo_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

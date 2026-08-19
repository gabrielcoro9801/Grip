CREATE TABLE IF NOT EXISTS "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"periodo_anno" integer NOT NULL,
	"periodo_mese" integer NOT NULL,
	"journal_entry_id" uuid,
	"costo_totale" numeric(12, 2),
	"registrato_il" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"collaboratore_id" uuid NOT NULL,
	"periodo_anno" integer NOT NULL,
	"periodo_mese" integer NOT NULL,
	"retribuzione_lorda" numeric(12, 2) NOT NULL,
	"netto_dipendente" numeric(12, 2) NOT NULL,
	"ritenute_irpef" numeric(12, 2) DEFAULT '0' NOT NULL,
	"contributi_dipendente" numeric(12, 2) DEFAULT '0' NOT NULL,
	"trattenute_terzi" numeric(12, 2) DEFAULT '0' NOT NULL,
	"contributi_azienda" numeric(12, 2) DEFAULT '0' NOT NULL,
	"accantonamento_tfr" numeric(12, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collaboratori" ADD COLUMN "destinazione_tfr" varchar(16) DEFAULT 'azienda' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payslips" ADD CONSTRAINT "payslips_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payslips" ADD CONSTRAINT "payslips_collaboratore_id_collaboratori_id_fk" FOREIGN KEY ("collaboratore_id") REFERENCES "public"."collaboratori"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

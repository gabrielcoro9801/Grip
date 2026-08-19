CREATE TABLE IF NOT EXISTS "exercise_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"anno" integer NOT NULL,
	"chiuso_il" timestamp with time zone DEFAULT now() NOT NULL,
	"chiuso_da" varchar(255),
	"journal_entry_id" uuid,
	"risultato" numeric(12, 2),
	"note" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_closures" ADD CONSTRAINT "exercise_closures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_closures" ADD CONSTRAINT "exercise_closures_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

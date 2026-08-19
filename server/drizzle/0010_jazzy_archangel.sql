CREATE TABLE IF NOT EXISTS "journal_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"descrizione" varchar(255),
	"caricato_da" varchar(255),
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

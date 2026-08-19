CREATE TABLE IF NOT EXISTS "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"nome" varchar(255) NOT NULL,
	"iban" varchar(34),
	"referente" varchar(255),
	"email" varchar(255),
	"telefono" varchar(64),
	"note" text,
	"attivo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "banca_id" uuid;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "periodicita" varchar(16) DEFAULT 'mensile' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "banks" ADD CONSTRAINT "banks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "loans" ADD CONSTRAINT "loans_banca_id_banks_id_fk" FOREIGN KEY ("banca_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

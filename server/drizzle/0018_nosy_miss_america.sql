CREATE TABLE IF NOT EXISTS "ruoli" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"nome" varchar(32) NOT NULL,
	"label" varchar(64) NOT NULL,
	"descrizione" text,
	"permessi" jsonb DEFAULT '{}' NOT NULL,
	"capacita" jsonb DEFAULT '[]' NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ruoli" ADD CONSTRAINT "ruoli_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ruoli_nome_univoco" ON "ruoli" USING btree ("organization_id","nome");
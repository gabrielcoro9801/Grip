CREATE TABLE IF NOT EXISTS "numbering_counters" (
	"organization_id" uuid NOT NULL,
	"scope" varchar(32) NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "numbering_counters_organization_id_scope_pk" PRIMARY KEY("organization_id","scope")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "numbering_counters" ADD CONSTRAINT "numbering_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

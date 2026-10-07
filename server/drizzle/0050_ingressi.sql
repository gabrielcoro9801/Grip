-- Gli ingressi in palestra, controllati al bancone col QR: chi, quando, con quale esito.
CREATE TABLE "ingressi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"entrato_alle" timestamp with time zone DEFAULT now() NOT NULL,
	"esito" varchar(24) NOT NULL,
	"avvisi" jsonb,
	"metodo" varchar(12) NOT NULL,
	"registrato_da_id" uuid,
	"registrato_da_nome" varchar(255),
	CONSTRAINT "ingressi_esito_valido" CHECK ("ingressi"."esito" IN ('ammesso', 'ammesso_con_avvisi', 'ammesso_in_deroga'))
);
--> statement-breakpoint
ALTER TABLE "ingressi" ADD CONSTRAINT "ingressi_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingressi_member_id_entrato_alle_idx" ON "ingressi" USING btree ("member_id","entrato_alle");--> statement-breakpoint
CREATE INDEX "ingressi_entrato_alle_idx" ON "ingressi" USING btree ("entrato_alle");
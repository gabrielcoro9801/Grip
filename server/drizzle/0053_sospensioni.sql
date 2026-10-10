CREATE TABLE "sospensioni" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"dal" date NOT NULL,
	"al" date NOT NULL,
	"nota" varchar(500),
	"autore_nome" varchar(255) NOT NULL,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sospensioni_periodo_valido" CHECK ("sospensioni"."al" >= "sospensioni"."dal")
);
--> statement-breakpoint
ALTER TABLE "sospensioni" ADD CONSTRAINT "sospensioni_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sospensioni_member_id_idx" ON "sospensioni" USING btree ("member_id");
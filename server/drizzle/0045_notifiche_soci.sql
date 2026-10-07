-- Gli avvisi ai soci nel portale: per ora, una lezione prenotata che il calendario annulla.
CREATE TABLE "notifiche" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"tipo" varchar(32) NOT NULL,
	"titolo" varchar(160) NOT NULL,
	"testo" text NOT NULL,
	"letta_il" timestamp with time zone,
	"created_date" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifiche" ADD CONSTRAINT "notifiche_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifiche_member_id_created_date_idx" ON "notifiche" USING btree ("member_id","created_date");
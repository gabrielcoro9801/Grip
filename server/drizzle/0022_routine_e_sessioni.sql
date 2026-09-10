-- Una scheda diventa un insieme di **routine** (le giornate: "Giorno 1 — Spinta"), e
-- l'allenamento del socio diventa una cosa che si avvia, si cronometra e si spunta serie
-- per serie invece di essere riassunto a posteriori.
--
-- Scritta a mano come la 0021, e per lo stesso motivo: la parte che conta non è il DDL ma
-- la conversione di quello che c'è già.

--> statement-breakpoint
-- 1. Le routine. Ogni scheda esistente diventa una scheda con una routine sola, che
--    contiene gli esercizi che aveva: è l'unica lettura possibile: nessuno aveva ancora
--    detto come dividere quegli esercizi in giornate, e inventarsi una divisione
--    sarebbe peggio che lasciarli insieme.
ALTER TABLE "exercise_plans" ADD COLUMN "routines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

UPDATE "exercise_plans" SET "routines" = jsonb_build_array(
	jsonb_build_object('nome', 'Allenamento', 'note', '', 'esercizi', "exercises")
)
WHERE jsonb_typeof("exercises") = 'array' AND jsonb_array_length("exercises") > 0;--> statement-breakpoint

ALTER TABLE "exercise_plans" DROP COLUMN IF EXISTS "exercises";--> statement-breakpoint

-- 2. L'allenamento come sessione: quando è iniziato, quando è finito, quale routine.
--    `terminata_alle` nullo significa "in corso", ed è ciò che permette di riprendere una
--    sessione lasciata aperta invece di ricominciarla da capo.
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_name" varchar(255),
	"routine_index" integer,
	"routine_name" varchar(255),
	"iniziata_alle" timestamp DEFAULT now() NOT NULL,
	"terminata_alle" timestamp,
	"note" text
);--> statement-breakpoint

ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_member_id_members_id_fk"
	FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_id_exercise_plans_id_fk"
	FOREIGN KEY ("plan_id") REFERENCES "public"."exercise_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 3. Ogni riga di workout_logs era "un esercizio registrato a fine allenamento"; ora è una
--    serie sola, spuntata mentre la si fa, dentro una sessione.
--
--    Le righe già presenti restano com'erano, con la sessione nulla: sono registrazioni
--    fatte quando le sessioni non esistevano, e attribuirle a un allenamento inventato
--    darebbe una durata e un volume che nessuno ha mai misurato.
ALTER TABLE "workout_logs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "exercise_index" integer;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "set_index" integer;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_session_id_workout_sessions_id_fk"
	FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 4. Il mezzo punto di RPE. "@ 7.5 rpe" è notazione corrente fra chi programma: su una
--    colonna intera veniva troncato a 7, cioè registrato più facile di com'era.
ALTER TABLE "workout_logs" ALTER COLUMN "rpe_percepito" SET DATA TYPE numeric(3, 1);

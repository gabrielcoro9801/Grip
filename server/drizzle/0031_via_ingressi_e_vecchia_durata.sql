-- Tolte le colonne travasate dalla 0030: la durata in giorni, gli ingressi inclusi e "attivo sì/no".
ALTER TABLE "plans" DROP COLUMN IF EXISTS "duration_days";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "sessions_included";--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN IF EXISTS "is_active";
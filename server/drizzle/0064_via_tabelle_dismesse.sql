-- Via le tabelle delle funzioni uscite dall'applicazione: allenamento (ottobre 2026, tag
-- archivio/allenamento), comunicazioni automatiche (21/10/2026, tag archivio/comunicazioni) e
-- codici QR d'accesso (portale D-1). Nessuna rotta né entità le usava più.
--
-- Scritta a mano: drizzle-kit chiede conferme interattive, che in questo ambiente non ci sono.
-- I dati se ne vanno con le tabelle: prima di lanciarla, backup del database (vedi README).
DROP TABLE IF EXISTS "workout_logs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workout_sessions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "exercise_plans" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "exercises" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "messaggi" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "modelli_messaggio" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "segreti_canali" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "qr_accessi" CASCADE;

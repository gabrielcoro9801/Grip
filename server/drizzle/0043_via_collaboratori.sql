-- I collaboratori non esistono più: chi lavora nella struttura è un utente interno e basta.
-- Prima il collegamento dagli account (con il suo vincolo), poi l'anagrafica.
ALTER TABLE "staff_accounts" DROP COLUMN IF EXISTS "linked_collaboratore_id";--> statement-breakpoint
DROP TABLE IF EXISTS "collaboratori";

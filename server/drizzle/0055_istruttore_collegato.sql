ALTER TABLE "staff_accounts" ADD COLUMN "instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD CONSTRAINT "staff_accounts_instructor_id_instructors_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_accounts_instructor_id_idx" ON "staff_accounts" USING btree ("instructor_id");--> statement-breakpoint
-- La vista dell'istruttore (modulo lezioni_istruttore). I ruoli salvati sostituiscono la matrice
-- predefinita invece di completarla (src/lib/ruoli.js): senza queste righe il modulo non
-- esisterebbe per nessuno sulle installazioni già avviate.
--
-- L'istruttore non legge più le anagrafiche di tutti: vede i soci delle sue lezioni dalla sua
-- vista. Il ruolo di sistema si aggiorna solo se ha ancora i permessi predefiniti di prima; se la
-- palestra li ha cambiati a mano non si tocca, e riceve solo il modulo nuovo.
UPDATE "ruoli" SET "permessi" = '{"crm_members": [], "crm_documents": [], "crm_leads": [], "calendar": ["view", "edit"], "lezioni_istruttore": ["view", "edit"], "admin_users": [], "audit_log": []}'::jsonb
WHERE "sistema" = true AND "nome" = 'istruttore'
	AND "permessi" = '{"crm_members": ["view"], "crm_documents": ["view"], "crm_leads": ["view"], "calendar": ["view", "edit"], "admin_users": [], "audit_log": []}'::jsonb;--> statement-breakpoint
UPDATE "ruoli" SET "permessi" = "permessi" || '{"lezioni_istruttore": ["view", "edit"]}'::jsonb
WHERE "sistema" = true AND "nome" = 'istruttore' AND NOT ("permessi" ? 'lezioni_istruttore');

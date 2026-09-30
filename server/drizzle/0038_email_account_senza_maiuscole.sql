-- L'email di un account è unica senza guardare le maiuscole.
--
-- Il login confronta le email con lower(), ma il vincolo di unicità le distingueva: potevano
-- esistere "Mario@x.it" e "mario@x.it", e l'accesso ne sceglieva uno a caso.
--
-- Se ci sono già doppioni l'indice non si può creare: la migrazione si ferma dicendo quali, invece
-- di un errore di Postgres che non spiega niente. Vanno risolti a mano (uno dei due account si
-- rinomina o si elimina), poi si riavvia.
DO $$
DECLARE doppioni text;
BEGIN
	SELECT string_agg(e, ', ') INTO doppioni
	FROM (SELECT lower(email) AS e FROM staff_accounts GROUP BY 1 HAVING count(*) > 1) d;
	IF doppioni IS NOT NULL THEN
		RAISE EXCEPTION 'Account con la stessa email a meno delle maiuscole: %. Risolvili prima di questa migrazione.', doppioni;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_accounts_email_lower_idx" ON "staff_accounts" USING btree (lower("email"));

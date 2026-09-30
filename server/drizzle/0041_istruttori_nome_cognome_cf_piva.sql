-- Istruttori: nome e cognome separati, codice fiscale e partita IVA in due campi.
--
-- Il nome completo diventa calcolato dal database, come per i soci. Quelli già registrati si
-- dividono alla prima parola: "Luca Bianchi" → nome "Luca", cognome "Bianchi". Un nome di una
-- parola sola resta senza cognome: lo si completa alla prima modifica.
--
-- Il vecchio "tax_id" conteneva l'uno o l'altra: sedici caratteri sono un codice fiscale,
-- undici cifre una partita IVA. Quello che non si riconosce finisce nelle note, per non
-- perderlo. La colonna si toglie nella migrazione successiva (0042).
ALTER TABLE "instructors" ADD COLUMN "nome" varchar(120);--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "cognome" varchar(120);--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "codice_fiscale" varchar(16);--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "partita_iva" varchar(11);--> statement-breakpoint
UPDATE "instructors" SET
	"nome" = split_part(btrim("full_name"), ' ', 1),
	"cognome" = btrim(substr(btrim("full_name"), length(split_part(btrim("full_name"), ' ', 1)) + 1));--> statement-breakpoint
UPDATE "instructors" SET "codice_fiscale" = upper(regexp_replace("tax_id", '\s', '', 'g'))
WHERE upper(regexp_replace("tax_id", '\s', '', 'g')) ~ '^[A-Z0-9]{16}$';--> statement-breakpoint
UPDATE "instructors" SET "partita_iva" = regexp_replace(upper(regexp_replace("tax_id", '\s', '', 'g')), '^IT', '')
WHERE regexp_replace(upper(regexp_replace("tax_id", '\s', '', 'g')), '^IT', '') ~ '^[0-9]{11}$';--> statement-breakpoint
UPDATE "instructors" SET "notes" = concat_ws(' — ', nullif(btrim("notes"), ''), 'Codice fiscale / P.IVA registrato prima: ' || "tax_id")
WHERE nullif(btrim("tax_id"), '') IS NOT NULL AND "codice_fiscale" IS NULL AND "partita_iva" IS NULL;--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "nome" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "cognome" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "full_name";--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "full_name" varchar(255) GENERATED ALWAYS AS (trim(nome || ' ' || cognome)) STORED;

-- Il vecchio campo unico per codice fiscale e partita IVA: i valori sono stati spostati nei due
-- campi nuovi (o nelle note) dalla 0041.
ALTER TABLE "instructors" DROP COLUMN "tax_id";
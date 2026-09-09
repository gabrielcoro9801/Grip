-- natura_fiscale diventa un enum vincolato: istituzionale | commerciale | promiscua |
-- plusvalenza_patrimoniale. NULL resta legale — è il caso delle scritture tecniche
-- (chiusura esercizio, saldi, rate di finanziamento, compensi PT), che non movimentano
-- conti economici e quindi non hanno una natura fiscale da dichiarare. L'obbligatorietà
-- per le scritture che invece toccano ricavi o costi è verificata lato server
-- (shared/naturaFiscale.js): qui si garantisce solo che, se c'è un valore, sia uno dei
-- quattro ammessi.
--
-- Il backfill precede il CHECK per costruzione: se un valore fuori enum fosse già in
-- banca dati, il vincolo non si potrebbe nemmeno creare. Non tocca i NULL esistenti.
UPDATE "journal_entries"
SET "natura_fiscale" = NULL
WHERE "natura_fiscale" IS NOT NULL
  AND "natura_fiscale" NOT IN ('istituzionale', 'commerciale', 'promiscua', 'plusvalenza_patrimoniale');
--> statement-breakpoint
UPDATE "purchase_orders"
SET "natura_fiscale" = NULL
WHERE "natura_fiscale" IS NOT NULL
  AND "natura_fiscale" NOT IN ('istituzionale', 'commerciale', 'promiscua', 'plusvalenza_patrimoniale');
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_natura_fiscale_valida" CHECK ("journal_entries"."natura_fiscale" IS NULL OR "journal_entries"."natura_fiscale" IN ('istituzionale', 'commerciale', 'promiscua', 'plusvalenza_patrimoniale'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_natura_fiscale_valida" CHECK ("purchase_orders"."natura_fiscale" IS NULL OR "purchase_orders"."natura_fiscale" IN ('istituzionale', 'commerciale', 'promiscua', 'plusvalenza_patrimoniale'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

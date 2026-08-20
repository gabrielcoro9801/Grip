ALTER TABLE "chart_of_accounts" ADD COLUMN "ruolo_sistema" varchar(40);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_codice_univoco" ON "chart_of_accounts" USING btree ("organization_id","codice");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_ruolo_univoco" ON "chart_of_accounts" USING btree ("organization_id","ruolo_sistema") WHERE "chart_of_accounts"."ruolo_sistema" IS NOT NULL;--> statement-breakpoint
-- Assegna i ruoli ai piani dei conti già esistenti, partendo dalla numerazione predefinita
-- con cui erano stati seminati. Da qui in poi il legame vive in questa colonna e il codice
-- torna a essere libero: rinumerare un conto non tocca più il motore contabile.
--
-- La corrispondenza è la stessa dichiarata in shared/contiSistema.js. Vale solo per i conti
-- creati dal seed (`sistema = true`): se un ente ha creato a mano un conto "2.1" proprio,
-- non gli si attribuisce d'ufficio il ruolo di cassa.
UPDATE "chart_of_accounts" SET "ruolo_sistema" = CASE "codice"
	WHEN '2.1'  THEN 'cassa'
	WHEN '2.2'  THEN 'banca'
	WHEN '4.1'  THEN 'debiti_fornitori'
	WHEN '4.2'  THEN 'debiti_banche'
	WHEN '4.3'  THEN 'iva_debito'
	WHEN '4.4'  THEN 'dipendenti_retribuzioni'
	WHEN '4.5'  THEN 'erario_ritenute_dipendenti'
	WHEN '4.6'  THEN 'inps'
	WHEN '4.7'  THEN 'fondo_tfr'
	WHEN '4.9'  THEN 'terzi_trattenute'
	WHEN '4.10' THEN 'erario_ritenute_autonomi'
	WHEN '5.2'  THEN 'utili_a_nuovo'
	WHEN '6.7'  THEN 'plusvalenze'
	WHEN '7.5'  THEN 'interessi_passivi'
	WHEN '7.6'  THEN 'salari'
	WHEN '7.9'  THEN 'minusvalenze'
	WHEN '7.10' THEN 'oneri_sociali'
	WHEN '7.11' THEN 'accantonamento_tfr'
END
WHERE "sistema" = true;

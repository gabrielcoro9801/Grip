-- L'aliquota IVA ordinaria era scritta nelle causali predefinite come `iva: 22`, undici
-- volte. È un valore di legge — è stata 20%, poi 21%, poi 22% — e come gli altri deve
-- portare con sé la data da cui vale, o le causali di un ente creato oggi resterebbero
-- ferme a 22 anche dopo un cambio.
--
-- Resta comunque modificabile sulla singola causale: alcune operazioni hanno aliquote
-- ridotte proprie, e quello è un dato dell'operazione, non della legge generale.
INSERT INTO "parametri_fiscali" ("chiave", "valore", "valido_dal", "note") VALUES
	('aliquota_iva_ordinaria', 21, '2011-09-17',
	 'Aliquota ordinaria elevata dal 20% al 21% (D.L. 138/2011).'),
	('aliquota_iva_ordinaria', 22, '2013-10-01',
	 'Aliquota ordinaria elevata dal 21% al 22% (D.L. 63/2013).')
ON CONFLICT ("chiave", "valido_dal") DO NOTHING;

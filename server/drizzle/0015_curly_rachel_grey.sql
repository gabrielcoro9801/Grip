CREATE TABLE IF NOT EXISTS "parametri_fiscali" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chiave" varchar(64) NOT NULL,
	"valore" numeric(14, 4) NOT NULL,
	"valido_dal" date NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "parametri_fiscali_chiave_data" ON "parametri_fiscali" USING btree ("chiave","valido_dal");--> statement-breakpoint
-- Valori in vigore alla creazione dell'archivio.
--
-- Sono retrodatati al 2000 (tranne l'IRES, di cui è nota la decorrenza) per conservare
-- esattamente il comportamento che l'applicazione aveva finora, quando erano costanti
-- applicate a qualunque data. Le variazioni storiche anteriori NON sono caricate: se un
-- giorno servisse ricalcolare un esercizio vecchio, va aggiunta una riga con la propria
-- decorrenza, e questa continuerà a valere per il periodo successivo.
INSERT INTO "parametri_fiscali" ("chiave", "valore", "valido_dal", "note") VALUES
	('aliquota_ires', 24, '2017-01-01',
	 'Aliquota ordinaria, ridotta dal 27,5% al 24% a partire dal periodo d''imposta 2017 (L. 208/2015).'),
	('coefficiente_redditivita_398', 3, '2000-01-01',
	 'Art. 2 c. 5 L. 398/1991. Da confermare col commercialista per gli esercizi anteriori.'),
	('soglia_compensi_sportivi', 15000, '2000-01-01',
	 'Riforma dello sport, D.Lgs. 36/2021. Retrodatata per conservare il comportamento precedente: per esercizi anteriori al 2023 va verificata.'),
	('aliquota_ritenuta_acconto', 20, '2000-01-01',
	 'Art. 25 DPR 600/1973, ritenuta sui compensi di lavoro autonomo.')
ON CONFLICT ("chiave", "valido_dal") DO NOTHING;

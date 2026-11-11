CREATE TABLE "avvisi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"tipo" varchar(16) NOT NULL,
	"chiave" varchar(64) NOT NULL,
	"aperto_il" timestamp with time zone DEFAULT now() NOT NULL,
	"chiuso_il" timestamp with time zone,
	"esito" varchar(24),
	"autore_id" uuid,
	"autore_nome" varchar(255),
	"dati" jsonb
);
--> statement-breakpoint
ALTER TABLE "avvisi" ADD CONSTRAINT "avvisi_persona_id_persone_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avvisi" ADD CONSTRAINT "avvisi_autore_id_staff_accounts_id_fk" FOREIGN KEY ("autore_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "avvisi_persona_tipo_chiave_unico" ON "avvisi" USING btree ("persona_id","tipo","chiave");--> statement-breakpoint
CREATE INDEX "avvisi_tipo_chiuso_il_idx" ON "avvisi" USING btree ("tipo","chiuso_il");--> statement-breakpoint
-- La pulizia dei dati di Da fare (docs/piani/da-fare.md, «I dati che la 0058 cancella o cambia»).
-- I rientri che puntano ai «Fatto» del vecchio Da fare, prima dei «Fatto» stessi: punterebbero a righe che non ci sono più.
DELETE FROM "attivita" WHERE "tipo" = 'ingresso_dopo_contatto' AND "riferimento"->>'contatto' IN (
	SELECT "id"::text FROM "attivita" WHERE "tipo" = 'contatto' AND "esito" = 'fatto'
);--> statement-breakpoint
-- Il box «Fatto»; i contatti del bancone (salutato, proposto_rinnovo) restano.
DELETE FROM "attivita" WHERE "tipo" = 'contatto' AND "esito" = 'fatto';--> statement-breakpoint
-- La richiesta di rinnovo dal portale non c'è più.
DELETE FROM "attivita" WHERE "tipo" = 'richiesta_rinnovo';--> statement-breakpoint
-- Il diario dei segnali dei codici tolti: il giro non li scrive più, e senza pulizia al primo giro
-- scriverebbe una chiusura per ogni socio.
DELETE FROM "attivita" WHERE "tipo" IN ('segnale_aperto', 'segnale_chiuso') AND "esito" IN (
	'rinnovo_richiesto', 'no_show_ripetuti', 'ambientamento_giorno_7', 'ambientamento_pochi_ingressi', 'documento_mancante',
	'richiami_oggi', 'da_contattare', 'ultimo_tentativo', 'da_ricontattare', 'conversazioni_ferme', 'da_recuperare'
);--> statement-breakpoint
-- Lo scaduto cambia nome: la sua storia continua.
UPDATE "attivita" SET "esito" = 'scaduto' WHERE "tipo" IN ('segnale_aperto', 'segnale_chiuso') AND "esito" = 'scaduto_recuperabile';--> statement-breakpoint
-- I segnali spenti dalla palestra: chi aveva spento lo scaduto lo ritrova spento; via i codici tolti.
UPDATE "organizations" SET "impostazioni" = jsonb_set("impostazioni", '{segnali_spenti}', (
	SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN c = 'scaduto_recuperabile' THEN 'scaduto' ELSE c END), '[]'::jsonb)
	FROM jsonb_array_elements_text("impostazioni"->'segnali_spenti') AS c
	WHERE c NOT IN (
		'rinnovo_richiesto', 'no_show_ripetuti', 'ambientamento_giorno_7', 'ambientamento_pochi_ingressi', 'documento_mancante',
		'richiami_oggi', 'da_contattare', 'ultimo_tentativo', 'da_ricontattare', 'conversazioni_ferme', 'da_recuperare'
	)
)) WHERE jsonb_typeof("impostazioni"->'segnali_spenti') = 'array';--> statement-breakpoint
-- Le soglie dei segnali tolti. Le quattro nuove (scadutoGiorni, frequenzaRiapriGiorni,
-- compleannoPrimaGiorni, compleannoDopoGiorni) non si scrivono: valgono i predefiniti di shared/soglie.js.
UPDATE "organizations" SET "impostazioni" = "impostazioni"
	#- '{soglie,segnali,noShowSegnale}' #- '{soglie,segnali,primoControlloGiorni}'
	#- '{soglie,segnali,ingressiAmbientamento}' #- '{soglie,segnali,ambientamentoGiorni}'
WHERE jsonb_typeof("impostazioni"->'soglie'->'segnali') = 'object';

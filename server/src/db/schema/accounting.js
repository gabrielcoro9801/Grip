// Dominio contabilità: ChartOfAccount, CausaleOperativa, JournalEntry, JournalLine,
// Loan, LoanInstallment, AccountingSupplier, FixedAsset.
// Testata e righe di una registrazione vanno scritte insieme, in transazione: se ne
// occupa l'endpoint POST /api/journal-entries (server/src/routes/journalEntries.js),
// che assegna anche il numero di protocollo. Non vanno create tramite l'endpoint
// generico delle entità, che non può garantire l'atomicità fra le due tabelle.
import { pgTable, uuid, varchar, text, boolean, integer, numeric, date, timestamp, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './common.js';
import { clients } from './crm.js';

// Contatori dei numeri progressivi, uno per organizzazione e per tipo di documento.
// Incrementarli con un UPDATE che blocca la riga è ciò che rende impossibile assegnare
// due volte lo stesso numero: leggere il massimo esistente e sommare 1, come si faceva
// prima, dà lo stesso numero a due operazioni simultanee.
// `scope` permette di riusare lo stesso meccanismo per ricevute e codici socio.
export const numberingCounters = pgTable('numbering_counters', {
	organizationId: uuid('organization_id').notNull().references(() => organizations.id),
	scope: varchar('scope', { length: 32 }).notNull(),
	value: integer('value').notNull().default(0),
}, (table) => ({
	pk: primaryKey({ columns: [table.organizationId, table.scope] }),
}));

export const chartOfAccounts = pgTable('chart_of_accounts', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	// Chiave logica usata dal motore di business (es. "2.1" Cassa, "4.3" IVA a debito).
	// Univocità applicativa per organizzazione, non ancora un vincolo DB in questo scaffold
	// iniziale: da aggiungere con un unique index (organization_id, codice) prima del cutover.
	codice: varchar('codice', { length: 16 }).notNull(),
	nome: varchar('nome', { length: 255 }).notNull(),
	tipoConto: varchar('tipo_conto', { length: 32 }), // attivo | passivo | patrimonio_netto | ricavo | costo
	natura: varchar('natura', { length: 16 }), // dare | avere
	contoPadreId: uuid('conto_padre_id'),
	gestisceIva: boolean('gestisce_iva').default(false),
	sistema: boolean('sistema').notNull().default(false), // conti seed, non cancellabili
	attivo: boolean('attivo').notNull().default(true),
});

export const causaliOperative = pgTable('causali_operative', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	nomeVisibile: varchar('nome_visibile', { length: 255 }).notNull(),
	tipo: varchar('tipo', { length: 16 }).notNull(), // entrata | uscita
	icona: varchar('icona', { length: 32 }),
	contoContropartitaId: uuid('conto_contropartita_id').references(() => chartOfAccounts.id),
	richiedeControparte: boolean('richiede_controparte').notNull().default(false),
	tipoControparte: varchar('tipo_controparte', { length: 16 }), // cliente | fornitore
	gestisceIva: boolean('gestisce_iva').notNull().default(false),
	aliquotaIvaDefault: numeric('aliquota_iva_default', { precision: 5, scale: 2 }).default('22'),
	permetteACredito: boolean('permette_a_credito').notNull().default(false),
	contoCreditoDebitoId: uuid('conto_credito_debito_id').references(() => chartOfAccounts.id),
	puoEssereIstituzionale: boolean('puo_essere_istituzionale').notNull().default(false),
	sistema: boolean('sistema').notNull().default(false),
	attivo: boolean('attivo').notNull().default(true),
});

export const journalEntries = pgTable('journal_entries', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	// Progressivo per organizzazione — oggi calcolato client-side (race condition).
	// Da sostituire con una SEQUENCE dedicata per organizzazione prima del cutover.
	numeroProtocollo: integer('numero_protocollo'),
	dataCompetenza: date('data_competenza').notNull(),
	dataCassa: date('data_cassa'),
	descrizione: text('descrizione'),
	causale: varchar('causale', { length: 255 }),
	causaleOperativaId: uuid('causale_operativa_id').references(() => causaliOperative.id),
	// Enum "aperto" nel codice attuale (esteso runtime, es. "compenso_pt") -> testo libero.
	tipoOrigine: varchar('tipo_origine', { length: 64 }),
	stato: varchar('stato', { length: 16 }).notNull().default('bozza'), // bozza | confermata
	statoPagamento: varchar('stato_pagamento', { length: 16 }), // saldata | da_incassare | da_pagare
	dataScadenza: date('data_scadenza'),
	naturaFiscale: varchar('natura_fiscale', { length: 32 }), // commerciale | istituzionale | plusvalenza_patrimoniale
	// FK auto-referenziale: collega la scrittura originale (da_incassare/da_pagare) alla
	// scrittura di saldo generata da settleJournalEntry(). Il riferimento a `journalEntries`
	// dentro il proprio initializer funziona perché la callback è valutata pigramente da drizzle-kit.
	journalEntrySaldoId: uuid('journal_entry_saldo_id').references(() => journalEntries.id),
	riferimentoDocumento: text('riferimento_documento'),
	// Obbligatorio sulle registrazioni scritte a mano: sono l'unico modo per movimentare
	// conti scavalcando le causali, quindi devono dire perché sono state fatte.
	motivoManuale: text('motivo_manuale'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const journalLines = pgTable('journal_lines', {
	id: uuid('id').defaultRandom().primaryKey(),
	journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
	contoId: uuid('conto_id').notNull().references(() => chartOfAccounts.id),
	dare: numeric('dare', { precision: 12, scale: 2 }).notNull().default('0'),
	avere: numeric('avere', { precision: 12, scale: 2 }).notNull().default('0'),
	controparteTipo: varchar('controparte_tipo', { length: 16 }), // cliente | fornitore
	// FK polimorfica (-> clients.id o accounting_suppliers.id a seconda di controparte_tipo):
	// nessun vincolo referenziale rigido qui per lo stesso motivo.
	controparteId: uuid('controparte_id'),
	controparteESocio: boolean('controparte_e_socio'),
	importoIva: numeric('importo_iva', { precision: 12, scale: 2 }),
	aliquotaIva: numeric('aliquota_iva', { precision: 5, scale: 2 }),
	note: text('note'),
}, (table) => ({
	dareAvereEsclusivi: check(
		'dare_avere_esclusivi',
		sql`(${table.dare} = 0 AND ${table.avere} > 0) OR (${table.dare} > 0 AND ${table.avere} = 0)`
	),
}));

// Documenti allegati a una scrittura contabile: fatture, cedolini, quietanze, contratti.
//
// Sono più d'uno per scrittura di proposito: una registrazione aggregata — per esempio gli
// stipendi del mese — porta con sé un documento per dipendente. È il modo per tenere il
// registro leggibile senza perdere il dettaglio, che resta consultabile dove serve.
export const journalAttachments = pgTable('journal_attachments', {
	id: uuid('id').defaultRandom().primaryKey(),
	journalEntryId: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
	fileUrl: text('file_url').notNull(),
	fileName: varchar('file_name', { length: 255 }).notNull(),
	// A cosa si riferisce il documento, quando la scrittura ne ha molti: "Cedolino Mario Rossi".
	descrizione: varchar('descrizione', { length: 255 }),
	caricatoDa: varchar('caricato_da', { length: 255 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

// Esercizi chiusi. Una volta chiuso un anno, le sue scritture non si toccano più: i dati
// sono stati usati per una dichiarazione, e modificarli dopo significherebbe avere numeri
// diversi da quelli presentati, senza che nessuno se ne accorga.
export const exerciseClosures = pgTable('exercise_closures', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').notNull().references(() => organizations.id),
	anno: integer('anno').notNull(),
	chiusoIl: timestamp('chiuso_il', { withTimezone: true }).notNull().defaultNow(),
	chiusoDa: varchar('chiuso_da', { length: 255 }),
	// Scrittura che gira il risultato dell'esercizio a patrimonio netto: senza, l'anno
	// successivo il patrimonio non quadrerebbe più, perché mancherebbe l'utile o la
	// perdita maturati.
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
	risultato: numeric('risultato', { precision: 12, scale: 2 }),
	note: text('note'),
});

// Anagrafica delle banche e degli enti finanziatori. Prima era un campo di testo libero
// sul finanziamento: lo stesso istituto veniva scritto in modi diversi e non era possibile
// vedere quanto si deve complessivamente a ciascuno.
export const banks = pgTable('banks', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	nome: varchar('nome', { length: 255 }).notNull(),
	iban: varchar('iban', { length: 34 }),
	referente: varchar('referente', { length: 255 }),
	email: varchar('email', { length: 255 }),
	telefono: varchar('telefono', { length: 64 }),
	note: text('note'),
	attivo: boolean('attivo').notNull().default(true),
});

export const loans = pgTable('loans', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	bancaId: uuid('banca_id').references(() => banks.id),
	// Mantenuto per i finanziamenti inseriti prima dell'anagrafica banche: resta come
	// etichetta quando banca_id non è valorizzato.
	enteFinanziatore: varchar('ente_finanziatore', { length: 255 }).notNull(),
	capitaleErogato: numeric('capitale_erogato', { precision: 12, scale: 2 }).notNull(),
	tassoInteresse: numeric('tasso_interesse', { precision: 5, scale: 2 }),
	dataInizio: date('data_inizio').notNull(),
	numeroRateTotali: integer('numero_rate_totali').notNull(),
	// Serve a calcolare il piano: da questa dipendono il tasso di periodo e le scadenze.
	periodicita: varchar('periodicita', { length: 16 }).notNull().default('mensile'),
	note: text('note'),
});

export const loanInstallments = pgTable('loan_installments', {
	id: uuid('id').defaultRandom().primaryKey(),
	loanId: uuid('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
	numeroRata: integer('numero_rata').notNull(),
	dataScadenza: date('data_scadenza').notNull(),
	quotaCapitale: numeric('quota_capitale', { precision: 12, scale: 2 }).notNull(),
	quotaInteressi: numeric('quota_interessi', { precision: 12, scale: 2 }).notNull(),
	statoPagamento: varchar('stato_pagamento', { length: 16 }).notNull().default('da_pagare'), // da_pagare | pagata
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
});

export const accountingSuppliers = pgTable('accounting_suppliers', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	ragioneSociale: varchar('ragione_sociale', { length: 255 }).notNull(),
	pivaCf: varchar('piva_cf', { length: 32 }),
	iban: varchar('iban', { length: 34 }),
	contoCostoDefaultId: uuid('conto_costo_default_id').references(() => chartOfAccounts.id),
	email: varchar('email', { length: 255 }),
	telefono: varchar('telefono', { length: 64 }),
	attivo: boolean('attivo').notNull().default(true),
	// Da questi due campi dipende se un pagamento è soggetto a ritenuta d'acconto:
	// è dovuta sui professionisti persona fisica, non sulle società e non su chi è in
	// regime forfettario. Senza saperlo, il pagamento verrebbe fatto per l'intero importo
	// quando invece una quota va versata all'erario.
	tipoSoggetto: varchar('tipo_soggetto', { length: 32 }), // societa | professionista | ditta_individuale | altro
	regimeForfettario: boolean('regime_forfettario').notNull().default(false),
	aliquotaRitenuta: numeric('aliquota_ritenuta', { precision: 5, scale: 2 }), // di norma 20% sui professionisti
});

// Ordini ai fornitori. Esistono per separare il momento in cui si ordina da quello in cui
// il costo sorge davvero: ordinare non è un fatto contabile, ricevere sì. La scrittura
// nasce quindi alla consegna, non prima — altrimenti la contabilità registrerebbe costi
// per merce che potrebbe non arrivare mai.
//
// Lo stato "pagato" non è un campo: si legge dalla scrittura collegata, che il pagamento
// da Crediti/Debiti porta a "saldata". Tenerlo anche qui significherebbe avere due
// versioni della stessa verità, destinate prima o poi a divergere.
export const purchaseOrders = pgTable('purchase_orders', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	numeroOrdine: integer('numero_ordine'),
	fornitoreId: uuid('fornitore_id').notNull().references(() => accountingSuppliers.id),
	dataOrdine: date('data_ordine').notNull(),
	descrizione: text('descrizione').notNull(),
	importoPrevisto: numeric('importo_previsto', { precision: 12, scale: 2 }).notNull(),
	contoCostoId: uuid('conto_costo_id').references(() => chartOfAccounts.id),
	naturaFiscale: varchar('natura_fiscale', { length: 32 }), // istituzionale | commerciale | promiscua
	stato: varchar('stato', { length: 16 }).notNull().default('ordinato'), // ordinato | consegnato | fatturato | annullato
	dataConsegna: date('data_consegna'),
	// Valorizzata alla consegna: è la scrittura che rileva il costo e il debito.
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
	numeroFattura: varchar('numero_fattura', { length: 64 }),
	dataFattura: date('data_fattura'),
	importoFatturato: numeric('importo_fatturato', { precision: 12, scale: 2 }),
	note: text('note'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const fixedAssets = pgTable('fixed_assets', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	nome: varchar('nome', { length: 255 }).notNull(),
	valoreAcquisto: numeric('valore_acquisto', { precision: 12, scale: 2 }).notNull(),
	dataAcquisto: date('data_acquisto').notNull(),
	contoId: uuid('conto_id').references(() => chartOfAccounts.id),
	stato: varchar('stato', { length: 16 }).notNull().default('in_uso'), // in_uso | dismesso | venduto
	dataVendita: date('data_vendita'),
	valoreVendita: numeric('valore_vendita', { precision: 12, scale: 2 }),
	acquirente: varchar('acquirente', { length: 255 }),
});

// Le tabelle `revenues` ed `expenses` erano un registro riassuntivo parallelo alla
// partita doppia: ogni abbonamento veniva scritto due volte, una su JournalEntry/
// JournalLine e una qui. Sono state rimosse — la contabilità in partita doppia è
// l'unica fonte di verità, e ricavi e costi si ricavano dalle righe sui conti di
// tipo "ricavo" e "costo".

// Dominio contabilità: ChartOfAccount, CausaleOperativa, JournalEntry, JournalLine,
// Loan, LoanInstallment, AccountingSupplier, FixedAsset, Revenue, Expense.
// Vedi il report dedicato per il modello di partita doppia. Punto centrale segnalato:
// oggi JournalEntry + JournalLine vengono scritte con due chiamate separate,
// NON atomiche — qui aggiungiamo solo i vincoli a livello di riga (dare/avere mutuamente
// esclusivi); l'atomicità multi-tabella va garantita lato applicazione con una
// transazione DB quando si scrive tramite Drizzle (Fase 2 della roadmap).
import { pgTable, uuid, varchar, text, boolean, integer, numeric, date, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './common.js';
import { clients } from './crm.js';

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

export const loans = pgTable('loans', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	enteFinanziatore: varchar('ente_finanziatore', { length: 255 }).notNull(),
	capitaleErogato: numeric('capitale_erogato', { precision: 12, scale: 2 }).notNull(),
	tassoInteresse: numeric('tasso_interesse', { precision: 5, scale: 2 }),
	dataInizio: date('data_inizio').notNull(),
	numeroRateTotali: integer('numero_rate_totali').notNull(),
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

// Ledger riassuntivo/legacy separato da JournalEntry, usato per reportistica rapida
// in Dashboard/Finance. ⚠️ nessun organization_id osservato in nessuna call site:
// mantenuto nullable qui, da chiarire prima del cutover se sia davvero cross-tenant.
export const revenues = pgTable('revenues', {
	id: uuid('id').defaultRandom().primaryKey(),
	receiptId: uuid('receipt_id'), // FK -> receipts.id, aggiunta da fiscal.js per evitare import circolare
	memberName: varchar('member_name', { length: 255 }),
	planName: varchar('plan_name', { length: 255 }),
	amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
	date: date('date').notNull(),
	category: varchar('category', { length: 64 }),
});

export const expenses = pgTable('expenses', {
	id: uuid('id').defaultRandom().primaryKey(),
	category: varchar('category', { length: 32 }).notNull(), // Rent | Utilities | Equipment | Supplies | Insurance | Marketing | Maintenance | Other
	amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
	date: date('date').notNull(),
	description: text('description'),
	notes: text('notes'),
});

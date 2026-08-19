// Dominio fiscale: FiscalProfileSnapshot, FiscalYearData, ReceiptTemplate, Receipt.
import { pgTable, uuid, varchar, text, boolean, integer, numeric, date, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './common.js';
import { clients, members, subscriptions } from './crm.js';
import { journalEntries } from './accounting.js';

export const fiscalProfileSnapshots = pgTable('fiscal_profile_snapshots', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	dataDecorrenza: date('data_decorrenza').notNull(),
	formaGiuridica: varchar('forma_giuridica', { length: 64 }), // ASD | ASD con personalità giuridica | SSD
	dataCostituzione: date('data_costituzione'),
	dataChiusuraEsercizio: date('data_chiusura_esercizio'),
	enteAffiliazione: varchar('ente_affiliazione', { length: 255 }),
	numeroAffiliazione: varchar('numero_affiliazione', { length: 64 }),
	iscrittaRasd: boolean('iscritta_rasd'),
	numeroIscrizioneRasd: varchar('numero_iscrizione_rasd', { length: 64 }),
	iscrittaRunts: boolean('iscritta_runts'),
	qualificaRunts: varchar('qualifica_runts', { length: 64 }), // APS | ODV | Altro ente del Terzo Settore
	regimeFiscale: varchar('regime_fiscale', { length: 64 }),
	dataComunicazioneSiae: date('data_comunicazione_siae'),
	dataOpzione: date('data_opzione'),
	partitaIvaPosseduta: boolean('partita_iva_posseduta'),
	numeroPartitaIva: varchar('numero_partita_iva', { length: 32 }),
	dataAperturaPartitaIva: date('data_apertura_partita_iva'),
	note: text('note'),
	dataInserimento: timestamp('data_inserimento', { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalYearData = pgTable('fiscal_year_data', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	annoEsercizio: integer('anno_esercizio'),
	dataInizioEsercizio: date('data_inizio_esercizio'),
	dataFineEsercizio: date('data_fine_esercizio'),
	proventiCommerciali: numeric('proventi_commerciali', { precision: 12, scale: 2 }),
	proventiComplessivi: numeric('proventi_complessivi', { precision: 12, scale: 2 }),
	note: text('note'),
});

// Fatture verso clienti terzi (tipicamente aziende: affitto sale, sponsorizzazioni).
// Sono documenti distinti dalle ricevute: la ricevuta accompagna la quota di un socio, la
// fattura una prestazione commerciale verso terzi e richiede partita IVA, aliquota e una
// numerazione propria che riparte ogni anno.
//
// Questo è il documento di cortesia in PDF. La fattura elettronica (XML verso lo SdI) è
// obbligatoria e resta da costruire: il PDF non la sostituisce, l'affianca.
export const invoices = pgTable('invoices', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	clienteId: uuid('cliente_id').notNull().references(() => clients.id),
	clienteName: varchar('cliente_name', { length: 255 }),
	clientePiva: varchar('cliente_piva', { length: 32 }),
	clienteIndirizzo: text('cliente_indirizzo'),
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
	numeroProgressivo: integer('numero_progressivo').notNull(),
	esercizioFiscale: integer('esercizio_fiscale').notNull(),
	dataEmissione: date('data_emissione').notNull(),
	descrizione: text('descrizione'),
	imponibile: numeric('imponibile', { precision: 12, scale: 2 }).notNull(),
	iva: numeric('iva', { precision: 12, scale: 2 }).notNull().default('0'),
	aliquotaIva: numeric('aliquota_iva', { precision: 5, scale: 2 }).notNull().default('0'),
	totale: numeric('totale', { precision: 12, scale: 2 }).notNull(),
	stato: varchar('stato', { length: 16 }).notNull().default('emessa'), // bozza | emessa
	pdfUrl: text('pdf_url'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const receiptTemplates = pgTable('receipt_templates', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	notaPiede: text('nota_piede'),
	coloreAccento: varchar('colore_accento', { length: 16 }).default('#1e40af'),
	mostraIvaOverride: boolean('mostra_iva_override'), // null = automatico da Organization.gestione_iva
});

// ⚠️ Il report segnala una possibile incoerenza sui dati reali: alcuni call site
// valorizzano cliente_id con Client.id, altri con Member.id nello stesso campo.
// Da verificare sui dati storici prima di irrigidire il vincolo referenziale in
// produzione — per ora manteniamo entrambe le FK "morbide" (nullable, non richieste
// contemporaneamente) così la migrazione dati può popolare quella corretta caso per caso.
export const receipts = pgTable('receipts', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	clienteId: uuid('cliente_id').references(() => clients.id),
	clienteName: varchar('cliente_name', { length: 255 }),
	memberId: uuid('member_id').references(() => members.id), // campo "backward compat"
	memberName: varchar('member_name', { length: 255 }),
	subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
	planName: varchar('plan_name', { length: 255 }),
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
	numeroProgressivo: integer('numero_progressivo'),
	esercizioFiscale: integer('esercizio_fiscale'),
	tipoDocumento: varchar('tipo_documento', { length: 32 }), // ricevuta_fiscale | ricevuta_semplice
	dataEmissione: date('data_emissione'),
	importoLordo: numeric('importo_lordo', { precision: 12, scale: 2 }),
	imponibile: numeric('imponibile', { precision: 12, scale: 2 }),
	iva: numeric('iva', { precision: 12, scale: 2 }),
	aliquotaIva: numeric('aliquota_iva', { precision: 5, scale: 2 }),
	paymentStatus: varchar('payment_status', { length: 16 }), // backward compat di `stato`
	stato: varchar('stato', { length: 16 }).notNull().default('bozza'), // bozza | emessa
	dataScadenza: date('data_scadenza'),
	versione: integer('versione').notNull().default(1),
	// Alias "backward compat" storici (amount/date duplicano importo_lordo/data_emissione
	// nel codice attuale) — mantenuti per fedeltà al modello osservato, da deprecare
	// esplicitamente quando tutti i punti di lettura verranno aggiornati.
	amount: numeric('amount', { precision: 12, scale: 2 }),
	date: date('date'),
	pdfUrl: text('pdf_url'),
	rigenerataIl: timestamp('rigenerata_il', { withTimezone: true }),
});

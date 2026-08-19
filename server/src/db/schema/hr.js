// Dominio HR/staff: Collaboratore (anagrafica), StaffAccount (login/sessione — da NON
// confondere con Collaboratore, vedi nota sotto), Timbratura, Turno,
// RichiestaFeriePermesso, SedutaPT, LiquidazionePT.
import { pgTable, uuid, varchar, text, boolean, integer, numeric, date, time, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './common.js';
import { rooms } from './courses.js';
import { clients } from './crm.js';
import { journalEntries } from './accounting.js';

export const collaboratori = pgTable('collaboratori', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	nome: varchar('nome', { length: 255 }).notNull(),
	cognome: varchar('cognome', { length: 255 }).notNull(),
	tipoRapporto: varchar('tipo_rapporto', { length: 32 }).notNull(), // dipendente | collaboratore_sportivo
	ruolo: varchar('ruolo', { length: 255 }), // testo libero (es. "Istruttore"), diverso da staff_accounts.ruolo
	email: varchar('email', { length: 255 }),
	phone: varchar('phone', { length: 64 }),
	hireDate: date('hire_date'),
	notes: text('notes'),
	attivo: boolean('attivo').notNull().default(true),
	sogliaSettimanaleOre: integer('soglia_settimanale_ore').default(40),
	giorniFerieAnno: integer('giorni_ferie_anno').default(26),
	tipoContratto: varchar('tipo_contratto', { length: 16 }), // fisso | percentuale | a_seduta (solo collaboratore_sportivo)
	importoFisso: numeric('importo_fisso', { precision: 12, scale: 2 }),
	percentuale: numeric('percentuale', { precision: 5, scale: 2 }),
	importoSeduta: numeric('importo_seduta', { precision: 12, scale: 2 }),
	importoAutocertificatoAltriEnti: numeric('importo_autocertificato_altri_enti', { precision: 12, scale: 2 }),
	dataAutocertificazione: date('data_autocertificazione'),
	// Dove va a finire il TFR maturato: se resta in azienda si accumula nel fondo e si
	// liquida alla cessazione; se il dipendente lo destina a previdenza complementare
	// diventa un versamento periodico, quindi un debito da pagare come i contributi.
	// È una scelta del singolo dipendente, non dell'ente.
	destinazioneTfr: varchar('destinazione_tfr', { length: 16 }).notNull().default('azienda'), // azienda | fondo_pensione
});

// Cedolino mensile di un dipendente.
//
// Il calcolo del cedolino resta fuori dal sistema — lo fa il consulente del lavoro. Qui si
// registrano le voci macro che servono alla contabilità, con il documento allegato.
//
// La ragione per cui le voci sono così tante: "costo del personale" e "quanto ricevi in
// busta" divergono in due direzioni. Parte del lordo non arriva al dipendente (IRPEF,
// contributi a suo carico, cessione del quinto: sono debiti verso terzi), e parte del costo
// non è nel cedolino (contributi a carico ente, TFR). Tenerle distinte è l'unico modo per
// far dire al conto economico quanto costa davvero una persona.
export const payslips = pgTable('payslips', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	collaboratoreId: uuid('collaboratore_id').notNull().references(() => collaboratori.id),
	periodoAnno: integer('periodo_anno').notNull(),
	periodoMese: integer('periodo_mese').notNull(), // 0-based, coerente con il resto dell'app

	// Composizione del lordo: le prime quattro voci devono sommare al lordo.
	retribuzioneLorda: numeric('retribuzione_lorda', { precision: 12, scale: 2 }).notNull(),
	nettoDipendente: numeric('netto_dipendente', { precision: 12, scale: 2 }).notNull(),
	ritenuteIrpef: numeric('ritenute_irpef', { precision: 12, scale: 2 }).notNull().default('0'),
	contributiDipendente: numeric('contributi_dipendente', { precision: 12, scale: 2 }).notNull().default('0'),
	trattenuteTerzi: numeric('trattenute_terzi', { precision: 12, scale: 2 }).notNull().default('0'),

	// Costi che il cedolino non mostra perché non riguardano il dipendente.
	contributiAzienda: numeric('contributi_azienda', { precision: 12, scale: 2 }).notNull().default('0'),
	accantonamentoTfr: numeric('accantonamento_tfr', { precision: 12, scale: 2 }).notNull().default('0'),

	note: text('note'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

// Registrazione contabile di un mese di stipendi: una sola scrittura aggregata, con i
// cedolini dei singoli dipendenti allegati alla scrittura.
export const payrollRuns = pgTable('payroll_runs', {
	id: uuid('id').defaultRandom().primaryKey(),
	organizationId: uuid('organization_id').references(() => organizations.id),
	periodoAnno: integer('periodo_anno').notNull(),
	periodoMese: integer('periodo_mese').notNull(),
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
	costoTotale: numeric('costo_totale', { precision: 12, scale: 2 }),
	registratoIl: timestamp('registrato_il', { withTimezone: true }).notNull().defaultNow(),
});

// Account di login per staff e member (ruolo="member"). Tabella di autenticazione,
// separata dall'anagrafica `collaboratori` a cui si collega via linked_collaboratore_id.
//
// Le password sono hashate con bcrypt lato server (colonna password_hash) e non
// escono MAI dall'API: il serializer le rimuove esplicitamente. Il login avviene su
// /api/auth/login e restituisce un JWT con scadenza.
export const staffAccounts = pgTable('staff_accounts', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 255 }).notNull(),
	email: varchar('email', { length: 255 }).notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	ruolo: varchar('ruolo', { length: 32 }).notNull(), // admin | reception | istruttore | pt | dipendente | member
	attivo: boolean('attivo').notNull().default(true),
	linkedCollaboratoreId: uuid('linked_collaboratore_id').references(() => collaboratori.id),
	linkedMemberId: uuid('linked_member_id'), // FK logica -> members.id (import evitato per non ciclare crm.js->hr.js)
	lastActivityDate: timestamp('last_activity_date', { withTimezone: true }),
});

export const timbrature = pgTable('timbrature', {
	id: uuid('id').defaultRandom().primaryKey(),
	dipendenteId: uuid('dipendente_id').notNull().references(() => collaboratori.id),
	dipendenteNome: varchar('dipendente_nome', { length: 255 }),
	tipo: varchar('tipo', { length: 16 }).notNull(), // entrata | uscita
	dataOraServer: timestamp('data_ora_server', { withTimezone: true }).notNull().defaultNow(),
	correttaDa: varchar('corretta_da', { length: 255 }),
	correttaIl: timestamp('corretta_il', { withTimezone: true }),
});

export const turni = pgTable('turni', {
	id: uuid('id').defaultRandom().primaryKey(),
	dipendenteId: uuid('dipendente_id').notNull().references(() => collaboratori.id),
	dipendenteNome: varchar('dipendente_nome', { length: 255 }),
	data: date('data').notNull(),
	oraInizio: time('ora_inizio').notNull(),
	oraFine: time('ora_fine').notNull(),
	salaId: uuid('sala_id').references(() => rooms.id),
	salaNome: varchar('sala_nome', { length: 255 }),
	note: text('note'),
	stato: varchar('stato', { length: 16 }).notNull().default('assegnato'), // assegnato | annullato
});

export const richiesteFeriePermesso = pgTable('richieste_ferie_permesso', {
	id: uuid('id').defaultRandom().primaryKey(),
	dipendenteId: uuid('dipendente_id').notNull().references(() => collaboratori.id),
	dipendenteNome: varchar('dipendente_nome', { length: 255 }),
	tipo: varchar('tipo', { length: 16 }).notNull(), // ferie | permesso
	dataInizio: date('data_inizio').notNull(),
	dataFine: date('data_fine'),
	ore: numeric('ore', { precision: 6, scale: 2 }).default('0'), // solo per tipo=permesso
	stato: varchar('stato', { length: 16 }).notNull().default('in_attesa'), // in_attesa | approvata | rifiutata
	motivazione: text('motivazione'),
	approvatoDa: varchar('approvato_da', { length: 255 }),
	approvatoIl: timestamp('approvato_il', { withTimezone: true }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const sedutePt = pgTable('sedute_pt', {
	id: uuid('id').defaultRandom().primaryKey(),
	collaboratoreId: uuid('collaboratore_id').notNull().references(() => collaboratori.id),
	collaboratoreNome: varchar('collaboratore_nome', { length: 255 }),
	clienteId: uuid('cliente_id').references(() => clients.id),
	clienteNome: varchar('cliente_nome', { length: 255 }),
	salaId: uuid('sala_id').references(() => rooms.id),
	salaNome: varchar('sala_nome', { length: 255 }),
	dataOraInizio: timestamp('data_ora_inizio', { withTimezone: true }).notNull(),
	dataOraFine: timestamp('data_ora_fine', { withTimezone: true }).notNull(),
	importo: numeric('importo', { precision: 12, scale: 2 }),
	note: text('note'),
	stato: varchar('stato', { length: 16 }).notNull().default('prenotata'), // prenotata | confermata | svolta | annullata
});

export const liquidazioniPt = pgTable('liquidazioni_pt', {
	id: uuid('id').defaultRandom().primaryKey(),
	collaboratoreId: uuid('collaboratore_id').notNull().references(() => collaboratori.id),
	collaboratoreNome: varchar('collaboratore_nome', { length: 255 }),
	periodoAnno: integer('periodo_anno').notNull(),
	periodoMese: integer('periodo_mese').notNull(), // 0-based, coerente con moment().month()
	numeroSedute: integer('numero_sedute').notNull().default(0),
	importoTotale: numeric('importo_totale', { precision: 12, scale: 2 }).notNull(),
	tipoContratto: varchar('tipo_contratto', { length: 16 }), // fisso | percentuale | a_seduta (copiato da Collaboratore)
	stato: varchar('stato', { length: 16 }).notNull().default('bozza'), // bozza | liquidata
	journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
	dataLiquidazione: date('data_liquidazione'),
});

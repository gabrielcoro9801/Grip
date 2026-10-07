// I lead: persone che hanno contattato la palestra e non sono ancora socie.
//
// Sono contatti e nient'altro. Non accedono alla piattaforma, non prenotano, non hanno uno
// stato: se e quando provare una lezione lo decide chi gestisce l'ASD, a modo suo. Grip ne
// tiene l'anagrafica essenziale per contarli — quanti, da quale canale, di che età — e per
// trasformarli in soci quando si iscrivono. A quel punto il lead si cancella.
//
// Una tabella separata da `members` perché tutto quello che riguarda i soci — codice, QR,
// portale, abbonamenti — non ha senso per un contatto.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, boolean, integer, date, timestamp, check, index } from 'drizzle-orm/pg-core';
import { staffAccounts } from './hr.js';

// Come ci ha contattato: Instagram, passaparola, in sede. La lista la decide l'ente — ogni
// palestra ha i suoi canali — e un canale non più usato si disattiva invece di sparire, così
// i contatti arrivati da lì restano contati.
export const canaliContatto = pgTable('canali_contatto', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 80 }).notNull().unique(),
	attivo: boolean('attivo').notNull().default(true),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable('leads', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 120 }).notNull(),
	cognome: varchar('cognome', { length: 120 }).notNull(),
	telefono: varchar('telefono', { length: 64 }),
	email: varchar('email', { length: 255 }),
	dataContatto: date('data_contatto').notNull(),
	canaleId: uuid('canale_id').notNull().references(() => canaliContatto.id, { onDelete: 'restrict' }),
	sesso: varchar('sesso', { length: 8 }).notNull(), // M | F | altro
	annoNascita: integer('anno_nascita'),
	// Due righe da ricordare al richiamo ("chiamare dopo le 18", "chiede del corso bimbi").
	// Il limite è in shared/lead.js (NOTE_LEAD_MASSIMO), qui come lunghezza della colonna.
	note: varchar('note', { length: 140 }),
	// A che punto è il rapporto (shared/lead.js, STATI_LEAD). Lo cambiano solo le azioni di
	// routes/lead.js, mai l'endpoint generico. Il *da quanto* non si salva: si calcola da queste
	// date, ed è da lì che nascono i filtri rapidi e, un giorno, le automazioni.
	stato: varchar('stato', { length: 24 }).notNull().default('nuovo'),
	statoDal: date('stato_dal').notNull().default(sql`CURRENT_DATE`),
	// Di fila, senza risposta: una risposta li azzera.
	tentativiSenzaRisposta: integer('tentativi_senza_risposta').notNull().default(0),
	ultimoContattoIl: date('ultimo_contatto_il'),
	ultimaRispostaIl: date('ultima_risposta_il'),
	richiamareIl: date('richiamare_il'),
	motivoChiusura: varchar('motivo_chiusura', { length: 32 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	sessoValido: check('leads_sesso_valido', sql`${table.sesso} IN ('M', 'F', 'altro')`),
	annoValido: check('leads_anno_nascita_valido', sql`${table.annoNascita} IS NULL OR ${table.annoNascita} BETWEEN 1900 AND 2100`),
	statoValido: check('leads_stato_valido', sql`${table.stato} IN ('nuovo', 'in_attesa', 'in_conversazione', 'da_richiamare', 'non_raggiungibile', 'non_interessato')`),
	perData: index('leads_data_contatto_idx').on(table.dataContatto),
	perStato: index('leads_stato_idx').on(table.stato),
}));

// Il diario di un lead: ogni tentativo, risposta, richiamo, chiusura e riapertura, con chi l'ha
// fatto. `autore_id` vuoto vuol dire "il sistema": oggi il passaggio automatico a non
// raggiungibile, domani i messaggi mandati dalle automazioni — un invio automatico è un
// tentativo come un altro, firmato da chi l'ha fatto. Se ne va col lead.
export const leadAttivita = pgTable('lead_attivita', {
	id: uuid('id').defaultRandom().primaryKey(),
	leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
	tipo: varchar('tipo', { length: 24 }).notNull(), // tentativo | risposta | richiamo | chiusura | riapertura | stato_automatico
	canale: varchar('canale', { length: 16 }), // telefono | whatsapp | email | sms | di_persona
	esito: varchar('esito', { length: 32 }), // nessuna_risposta | risposto | la data del richiamo | il motivo di chiusura
	nota: varchar('nota', { length: 140 }),
	autoreId: uuid('autore_id').references(() => staffAccounts.id, { onDelete: 'set null' }),
	autoreNome: varchar('autore_nome', { length: 255 }).notNull(),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	perLead: index('lead_attivita_lead_id_idx').on(table.leadId, table.createdDate),
}));

// Dominio commerciale: chi non è ancora socio, e la strada che fa per diventarlo.
//
// Il lead non è una riga di `members` con uno stato in più. Tutto quello che esiste già —
// codice socio, QR, portale, conteggi della Dashboard — presume che un membro sia un socio,
// e mescolarci chi è passato a chiedere un prezzo falserebbe ogni numero. Quando il lead si
// iscrive nasce un socio vero, e il lead resta come storia di come ci è arrivato.
//
// I valori ammessi per stato, fonte e tipo di attività sono in shared/lead.js: i vincoli qui
// sotto li ripetono perché una riga scritta a mano non deve poter inventare uno stato che
// nessuna schermata sa leggere.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, boolean, date, timestamp, check, index } from 'drizzle-orm/pg-core';
import { members } from './crm.js';
import { courses } from './courses.js';

export const leads = pgTable('leads', {
	id: uuid('id').defaultRandom().primaryKey(),
	fullName: varchar('full_name', { length: 255 }).notNull(),
	email: varchar('email', { length: 255 }),
	phone: varchar('phone', { length: 64 }),
	fonte: varchar('fonte', { length: 32 }).notNull().default('altro'),
	fonteDettaglio: text('fonte_dettaglio'),
	corsoInteresseId: uuid('corso_interesse_id').references(() => courses.id, { onDelete: 'set null' }),
	obiettivo: text('obiettivo'),
	note: text('note'),
	stato: varchar('stato', { length: 32 }).notNull().default('nuovo'),
	motivoPerdita: varchar('motivo_perdita', { length: 32 }),
	prossimaAzioneIl: date('prossima_azione_il'),
	prossimaAzioneNota: text('prossima_azione_nota'),
	// Due consensi e non uno: poter conservare i dati per rispondere a una richiesta non
	// vuol dire poter mandare promozioni. `gdpr_consent` dei soci li confondeva.
	consensoPrivacy: boolean('consenso_privacy').notNull().default(false),
	consensoPrivacyData: date('consenso_privacy_data'),
	consensoMarketing: boolean('consenso_marketing').notNull().default(false),
	consensoMarketingData: date('consenso_marketing_data'),
	convertitoMemberId: uuid('convertito_member_id').references(() => members.id, { onDelete: 'set null' }),
	convertitoIl: timestamp('convertito_il', { withTimezone: true }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	statoValido: check('leads_stato_valido', sql`${table.stato} IN ('nuovo', 'contattato', 'prova_prenotata', 'prova_svolta', 'proposta', 'iscritto', 'perso')`),
	fonteValida: check('leads_fonte_valida', sql`${table.fonte} IN ('passaggio', 'telefono', 'instagram', 'facebook', 'sito', 'passaparola', 'altro')`),
	perStato: index('leads_stato_idx').on(table.stato),
}));

// La cronologia di un lead. Si allunga e non si riscrive: è il posto dove si guarda per
// capire perché un contatto si è perso, e una storia che si può correggere non lo dice più.
//
// "chiamata" registra una telefonata **fatta**, non ne fa partire una.
export const leadAttivita = pgTable('lead_attivita', {
	id: uuid('id').defaultRandom().primaryKey(),
	leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
	tipo: varchar('tipo', { length: 32 }).notNull(),
	testo: text('testo').notNull().default(''),
	autoreId: uuid('autore_id'), // FK logica -> staff_accounts.id, come in audit_logs
	autoreNome: varchar('autore_nome', { length: 255 }).notNull().default(''),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	tipoValido: check('lead_attivita_tipo_valido', sql`${table.tipo} IN ('nota', 'chiamata', 'incontro', 'cambio_stato', 'prova')`),
	perLead: index('lead_attivita_lead_idx').on(table.leadId),
}));

// Le persone: chiunque la palestra conosca, socio o no.
//
// Un contatto che chiede informazioni, un socio, un ex socio che richiama dopo un anno sono la
// stessa persona in momenti diversi. Prima erano righe di tabelle diverse: il lead si
// cancellava quando diventava socio, e con lui il suo diario; un ex socio che richiamava
// tornava uno sconosciuto. Qui la persona resta, e attorno a lei stanno le trattative
// (`lead.js`, un lead è una trattativa aperta), il diario e i consensi.
//
// I recapiti di chi è socio si scrivono sul socio (`members`), come sempre: la persona ne tiene
// una copia che il database aggiorna da solo (trigger `socio_su_persona`, migrazione 0051), così
// cercare, contare e riconoscere le persone si fa su una tabella sola. Per chi non è socio, la
// persona è l'unico posto dove stanno.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, boolean, integer, timestamp, jsonb, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { staffAccounts } from './hr.js';
import { trattative } from './lead.js';

export const persone = pgTable('persone', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 120 }).notNull(),
	cognome: varchar('cognome', { length: 120 }),
	fullName: varchar('full_name', { length: 255 }).generatedAlwaysAs(sql`trim(nome || ' ' || coalesce(cognome, ''))`),
	// In formato internazionale (shared/anagrafica.js, normalizzaTelefono). Non è univoco: in una
	// famiglia il numero del genitore è spesso anche quello dei figli.
	telefono: varchar('telefono', { length: 64 }),
	email: varchar('email', { length: 255 }),
	sesso: varchar('sesso', { length: 8 }), // M | F | altro
	annoNascita: integer('anno_nascita'),
	// La nota da avere sotto gli occhi ("chiamare dopo le 18"): per un socio è la sua `notes`.
	nota: text('nota'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	sessoValido: check('persone_sesso_valido', sql`${table.sesso} IS NULL OR ${table.sesso} IN ('M', 'F', 'altro')`),
	annoValido: check('persone_anno_nascita_valido', sql`${table.annoNascita} IS NULL OR ${table.annoNascita} BETWEEN 1900 AND 2100`),
	perTelefono: index('persone_telefono_idx').on(table.telefono),
	perEmail: index('persone_email_idx').on(sql`lower(${table.email})`),
}));

// Il diario di una persona: i contatti, le risposte, i richiami, l'iscrizione, le note. Resta
// alla persona per sempre — anche quando la trattativa da cui è nata una riga si chiude o viene
// eliminata — ed è la storia che la reception legge prima di richiamare.
//
// `autore_id` vuoto vuol dire "il sistema": oggi il passaggio automatico a non raggiungibile,
// domani i messaggi mandati dalle automazioni.
export const attivita = pgTable('attivita', {
	id: uuid('id').defaultRandom().primaryKey(),
	personaId: uuid('persona_id').notNull().references(() => persone.id, { onDelete: 'cascade' }),
	trattativaId: uuid('trattativa_id').references(() => trattative.id, { onDelete: 'set null' }),
	tipo: varchar('tipo', { length: 24 }).notNull(), // tentativo | risposta | richiamo | chiusura | riapertura | stato_automatico | iscrizione | nota
	canale: varchar('canale', { length: 16 }), // telefono | whatsapp | email | sms | di_persona
	esito: varchar('esito', { length: 32 }), // nessuna_risposta | risposto | la data del richiamo | il motivo di chiusura | nuovo/riattivato
	nota: varchar('nota', { length: 500 }),
	autoreId: uuid('autore_id').references(() => staffAccounts.id, { onDelete: 'set null' }),
	autoreNome: varchar('autore_nome', { length: 255 }).notNull(),
	// Quello a cui la riga si riferisce, se serve ritrovarlo: per un contatto i segnali da fare in
	// quel momento (`{ segnali: ['assente'] }`, li scrive il server dal motore); per un
	// `ingresso_dopo_contatto` il contatto e l'ingresso (`{ contatto, ingresso }`).
	riferimento: jsonb('riferimento'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	perPersona: index('attivita_persona_id_idx').on(table.personaId, table.createdDate),
	perTrattativa: index('attivita_trattativa_id_idx').on(table.trattativaId),
	// Un rientro per contatto: il giro si può lanciare quante volte si vuole.
	unRientroPerContatto: uniqueIndex('attivita_ingresso_dopo_contatto_unico')
		.on(sql`(${table.riferimento}->>'contatto')`).where(sql`${table.tipo} = 'ingresso_dopo_contatto'`),
}));

// I consensi alle comunicazioni promozionali (shared/consensi.js), come registro: una riga per
// ogni scelta. Il valore di oggi è l'ultima riga di ogni tipo — e un consenso dato in reception
// vale solo finché c'è il modulo firmato che lo prova (`documento_id`, fra i documenti del socio).
export const consensi = pgTable('consensi', {
	id: uuid('id').defaultRandom().primaryKey(),
	personaId: uuid('persona_id').notNull().references(() => persone.id, { onDelete: 'cascade' }),
	tipo: varchar('tipo', { length: 24 }).notNull(),
	valore: boolean('valore').notNull(),
	fonte: varchar('fonte', { length: 16 }).notNull(),
	autoreNome: varchar('autore_nome', { length: 255 }).notNull(),
	// Il modulo firmato (member_documents, tipo consenso_marketing). Senza vincolo di chiave
	// esterna (crm.js importa già questo file): se il documento sparisce, il consenso decade, e lo
	// si legge con un join (routes/persone.js, consensiDi).
	documentoId: uuid('documento_id'),
	// Perché lo si toglie dalla reception ("l'ha chiesto per email il 10/10").
	nota: varchar('nota', { length: 500 }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	tipoValido: check('consensi_tipo_valido', sql`${table.tipo} IN ('marketing_email', 'marketing_sms', 'marketing_push')`),
	fonteValida: check('consensi_fonte_valida', sql`${table.fonte} IN ('portale', 'reception', 'form', 'disiscrizione')`),
	perPersona: index('consensi_persona_id_idx').on(table.personaId, table.createdDate),
}));

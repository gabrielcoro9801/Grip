// I contatti: da quali canali arrivano le persone, e le loro trattative (i lead).
//
// Un contatto non è un socio: non accede alla piattaforma, non prenota. Di lui GRIP tiene la
// persona (persone.js) e la trattativa: quando, da dove, a che punto è. Quando si iscrive la
// trattativa resta, chiusa come *iscritto*, e la persona diventa socia senza perdere la storia.
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, boolean, integer, date, timestamp, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { staffAccounts } from './hr.js';
import { persone } from './persone.js';
import { categories } from './courses.js';

// Come ci ha contattato: Instagram, passaparola, in sede. La lista la decide l'ente — ogni
// palestra ha i suoi canali — e un canale non più usato si disattiva invece di sparire, così
// i contatti arrivati da lì restano contati.
export const canaliContatto = pgTable('canali_contatto', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 80 }).notNull().unique(),
	attivo: boolean('attivo').notNull().default(true),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

// Una trattativa: una persona che ci ha contattato, da dove e quando, e a che punto è il
// rapporto. Un lead è una trattativa aperta di una persona che non è socia; quando si iscrive
// la trattativa diventa *iscritto* e resta, ed è da qui che Andamento conta da quali canali
// arrivano i soci. La stessa persona può averne più d'una nel tempo, una aperta alla volta.
//
// Gli stati (shared/lead.js, STATI_LEAD) li cambiano solo le azioni di routes/lead.js. Il *da
// quanto* non si salva: si calcola da queste date, ed è da lì che nascono i filtri rapidi.
export const trattative = pgTable('trattative', {
	id: uuid('id').defaultRandom().primaryKey(),
	personaId: uuid('persona_id').notNull().references(() => persone.id, { onDelete: 'cascade' }),
	dataContatto: date('data_contatto').notNull(),
	canaleId: uuid('canale_id').notNull().references(() => canaliContatto.id, { onDelete: 'restrict' }),
	stato: varchar('stato', { length: 24 }).notNull().default('nuovo'),
	statoDal: date('stato_dal').notNull().default(sql`CURRENT_DATE`),
	// Di fila, senza risposta: una risposta li azzera.
	tentativiSenzaRisposta: integer('tentativi_senza_risposta').notNull().default(0),
	ultimoContattoIl: date('ultimo_contatto_il'),
	ultimaRispostaIl: date('ultima_risposta_il'),
	richiamareIl: date('richiamare_il'),
	motivoChiusura: varchar('motivo_chiusura', { length: 32 }),
	// Chi dello staff la segue: "i miei contatti", e un domani i conti per operatore.
	assegnataAId: uuid('assegnata_a_id').references(() => staffAccounts.id, { onDelete: 'set null' }),
	// Che cosa cerca ("il corso bimbi"): una categoria di corsi invece di una frase nella nota.
	interesseCategoriaId: uuid('interesse_categoria_id').references(() => categories.id, { onDelete: 'set null' }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	statoValido: check('trattative_stato_valido', sql`${table.stato} IN ('nuovo', 'in_attesa', 'in_conversazione', 'da_richiamare', 'non_raggiungibile', 'non_interessato', 'iscritto')`),
	perData: index('trattative_data_contatto_idx').on(table.dataContatto),
	perStato: index('trattative_stato_idx').on(table.stato),
	perPersona: index('trattative_persona_id_idx').on(table.personaId),
	// Una sola aperta per persona: due trattative vive sulla stessa persona vorrebbero dire due
	// colleghi che la richiamano senza saperlo.
	unaAperta: uniqueIndex('trattative_una_aperta_idx').on(table.personaId)
		.where(sql`${table.stato} IN ('nuovo', 'in_attesa', 'in_conversazione', 'da_richiamare')`),
}));


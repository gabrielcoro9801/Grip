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
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
	updatedDate: timestamp('updated_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	sessoValido: check('leads_sesso_valido', sql`${table.sesso} IN ('M', 'F', 'altro')`),
	annoValido: check('leads_anno_nascita_valido', sql`${table.annoNascita} IS NULL OR ${table.annoNascita} BETWEEN 1900 AND 2100`),
	perData: index('leads_data_contatto_idx').on(table.dataContatto),
}));

// Gli avvisi ai soci, letti nel portale.
//
// Oggi li scrive una cosa sola: una lezione a cui il socio era prenotato viene annullata dal
// calendario (routes/calendario.js). Il socio non lo saprebbe altrimenti — la lezione sparisce
// dall'agenda e la prenotazione risulta cancellata, senza un perché. Niente email né push: la
// notifica vive nel portale, e il socio la trova alla prossima apertura.
//
// Titolo e testo si scrivono quando la notifica nasce, già in italiano e già con i dati di quel
// momento (corso, giorno, ora): se la lezione cambiasse dopo, la notifica deve continuare a dire
// quello che era vero quando è stata mandata.
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { members } from './crm.js';

export const notifiche = pgTable('notifiche', {
	id: uuid('id').defaultRandom().primaryKey(),
	// Le notifiche sono del socio e non hanno senso senza di lui.
	memberId: uuid('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
	tipo: varchar('tipo', { length: 32 }).notNull(), // lezione_annullata
	titolo: varchar('titolo', { length: 160 }).notNull(),
	testo: text('testo').notNull(),
	// Vuota finché il socio non apre le notifiche.
	lettaIl: timestamp('letta_il', { withTimezone: true }),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	// Il portale chiede le ultime del socio, e quante sono da leggere.
	socio: index('notifiche_member_id_created_date_idx').on(table.memberId, table.createdDate),
}));

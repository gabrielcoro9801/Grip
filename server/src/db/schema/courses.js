// Dominio corsi/scheduling: Category, Instructor, Room, Course, Event, Session, Booking.
// Gerarchia confermata dal report dedicato: Course -> Event -> Session -> Booking
// (1 Course ha N Event; 1 Event genera N Session tramite generateSessionDates();
// 1 Booking punta sempre a una Session, mai direttamente a Event/Course).
// NB: escluso volutamente il modello legacy/orfano trovato in MemberSelfService.jsx
// (Course.day_of_week/room_id, Booking.course_id/date) — codice morto non instradato.
import { pgTable, uuid, varchar, text, boolean, integer, date, time, jsonb, timestamp, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { members } from './crm.js';

export const categories = pgTable('categories', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	color: varchar('color', { length: 16 }).notNull().default('#3b82f6'),
});

// Anagrafica di chi tiene i corsi.
//
// Nome e cognome separati, come per i soci: il nome completo lo calcola il database, e lo
// leggono calendario, portale e catalogo senza sapere come è fatto. Codice fiscale e partita
// IVA erano un campo solo ("tax_id"), in cui finiva l'uno o l'altra: ora sono due, e il codice
// fiscale è obbligatorio (lo impone il server: gli istruttori registrati prima possono non
// averlo, e lo completano alla prima modifica).
export const instructors = pgTable('instructors', {
	id: uuid('id').defaultRandom().primaryKey(),
	nome: varchar('nome', { length: 120 }).notNull(),
	cognome: varchar('cognome', { length: 120 }).notNull(),
	fullName: varchar('full_name', { length: 255 }).generatedAlwaysAs(sql`trim(nome || ' ' || cognome)`),
	codiceFiscale: varchar('codice_fiscale', { length: 16 }),
	partitaIva: varchar('partita_iva', { length: 11 }),
	contactEmail: varchar('contact_email', { length: 255 }),
	contactPhone: varchar('contact_phone', { length: 64 }),
	// Stanno in tre righe della tile: il limite lo impone il server (NOTE_ISTRUTTORE_MASSIMO).
	notes: text('notes'),
	// Chi ha tenuto dei corsi non si elimina — il calendario passato perderebbe il suo nome — ma
	// smette di comparire fra quelli a cui si assegna un corso.
	attivo: boolean('attivo').notNull().default(true),
});

// La sala non ha una capienza: quanta gente entra a lezione lo decide l'evento, che nella
// stessa stanza cambia da corso a corso. La sospensione è sempre un periodo, da data a data
// (vincolo `rooms_sospensione_coerente`): senza una fine nessuno saprebbe quando la sala torna
// libera, e la si riaprirebbe a mano. Le regole stanno in shared/sale.js.
export const rooms = pgTable('rooms', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 50 }).notNull(), // una riga della tile, accanto allo stato
	description: varchar('description', { length: 140 }), // le note: due righe nella tile
	stato: varchar('stato', { length: 12 }).notNull().default('attivo'), // attivo | sospeso | annullato
	sospesaDal: date('sospesa_dal'),
	sospesaAl: date('sospesa_al'),
}, (table) => ({
	statoValido: check('rooms_stato_valido', sql`${table.stato} IN ('attivo', 'sospeso', 'annullato')`),
	// Le date sono la sospensione: ci sono se e solo se la sala è sospesa. Una sospensione senza
	// date, o delle date su una sala attiva o annullata, sarebbero due modi di dire una cosa che
	// il resto del codice legge in un modo solo.
	sospensioneCoerente: check(
		'rooms_sospensione_coerente',
		sql`(${table.stato} = 'sospeso' AND ${table.sospesaDal} IS NOT NULL AND ${table.sospesaAl} IS NOT NULL AND ${table.sospesaAl} >= ${table.sospesaDal})
			OR (${table.stato} <> 'sospeso' AND ${table.sospesaDal} IS NULL AND ${table.sospesaAl} IS NULL)`,
	),
}));

export const courses = pgTable('courses', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	categoryId: uuid('category_id').references(() => categories.id),
	instructorId: uuid('instructor_id').references(() => instructors.id),
	description: text('description'),
	// Un corso andato in calendario non si elimina; disattivato non si programma più, e le
	// lezioni già fissate restano com'erano.
	attivo: boolean('attivo').notNull().default(true),
	// Fino a quante ore prima dell'inizio il socio può disdire da sé (shared/corsi.js). Vuoto:
	// fino alla fine della lezione. La reception disdice sempre.
	disdettaEntroOre: integer('disdetta_entro_ore'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
	id: uuid('id').defaultRandom().primaryKey(),
	courseId: uuid('course_id').notNull().references(() => courses.id),
	roomId: uuid('room_id').notNull().references(() => rooms.id),
	capacity: integer('capacity').notNull().default(0),
	recurrenceType: varchar('recurrence_type', { length: 16 }).notNull(), // single | weekly | custom
	daysOfWeek: jsonb('days_of_week'), // array di 'Monday'..'Sunday', solo se recurrence_type=weekly
	startDate: date('start_date').notNull(),
	endCondition: varchar('end_condition', { length: 16 }), // by_date | by_count (solo weekly)
	endDate: date('end_date'),
	occurrenceCount: integer('occurrence_count'),
	customDates: jsonb('custom_dates'), // array di date, solo se recurrence_type=custom
	// Orari come stringa HH:mm confrontata lessicograficamente nel codice attuale,
	// nessuna gestione timezone osservata: manteniamo `time` senza tz.
	startTime: time('start_time').notNull(),
	endTime: time('end_time').notNull(),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	// Postgres non indicizza da solo le chiavi esterne: ogni controllo sulle sale ("è occupata
	// da qui in avanti?") e ogni elenco per corso leggeva la tabella intera.
	salaInizio: index('events_room_id_start_date_idx').on(table.roomId, table.startDate),
	corso: index('events_course_id_idx').on(table.courseId),
}));

export const sessions = pgTable('sessions', {
	id: uuid('id').defaultRandom().primaryKey(),
	eventId: uuid('event_id').notNull().references(() => events.id),
	date: date('date').notNull(),
	// Ereditati dall'Event alla generazione; possono divergere solo se modifiedManually=true
	// (vincolo applicativo, vedi src/staff/lib/sessionValidation.js — non imposto come CHECK qui).
	startTime: time('start_time').notNull(),
	endTime: time('end_time').notNull(),
	roomId: uuid('room_id').notNull().references(() => rooms.id),
	capacity: integer('capacity').notNull(),
	status: varchar('status', { length: 16 }).notNull().default('active'), // active | cancelled
	modifiedManually: boolean('modified_manually').notNull().default(false),
}, (table) => ({
	// Il calendario chiede le lezioni per data, l'agenda del portale pure, le sale per sala e data.
	data: index('sessions_date_idx').on(table.date),
	evento: index('sessions_event_id_idx').on(table.eventId),
	salaData: index('sessions_room_id_date_idx').on(table.roomId, table.date),
}));

export const bookings = pgTable('bookings', {
	id: uuid('id').defaultRandom().primaryKey(),
	sessionId: uuid('session_id').notNull().references(() => sessions.id),
	memberId: uuid('member_id').notNull().references(() => members.id),
	memberName: varchar('member_name', { length: 255 }), // denormalizzato al momento della create
	status: varchar('status', { length: 16 }).notNull().default('confirmed'), // confirmed | waitlisted | cancelled
	waitlistPosition: integer('waitlist_position'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
	// Ogni prenotazione conta i posti della sua lezione; il portale cerca quelle del socio.
	lezione: index('bookings_session_id_idx').on(table.sessionId),
	socio: index('bookings_member_id_idx').on(table.memberId),
	// Una prenotazione viva per socio e lezione. Il lock in transazione di `lib/prenotazioni.js`
	// lo garantisce già per le rotte dedicate; il vincolo lo garantisce per tutto il resto.
	unaPerLezione: uniqueIndex('bookings_attiva_unica_idx').on(table.sessionId, table.memberId).where(sql`${table.status} <> 'cancelled'`),
}));

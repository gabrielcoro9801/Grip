// Dominio corsi/scheduling: Category, Instructor, Room, Course, Event, Session, Booking.
// Gerarchia confermata dal report dedicato: Course -> Event -> Session -> Booking
// (1 Course ha N Event; 1 Event genera N Session tramite generateSessionDates();
// 1 Booking punta sempre a una Session, mai direttamente a Event/Course).
// NB: escluso volutamente il modello legacy/orfano trovato in MemberSelfService.jsx
// (Course.day_of_week/room_id, Booking.course_id/date) — codice morto non instradato.
import { pgTable, uuid, varchar, text, boolean, integer, date, time, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { members } from './crm.js';

export const categories = pgTable('categories', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	color: varchar('color', { length: 16 }).notNull().default('#3b82f6'),
});

// Anagrafica di chi tiene i corsi. Chi insegna può esserlo a due titoli diversi, e da
// questo dipende come viene pagato: come persona del team (dipendente o collaboratore
// sportivo, retribuito con il compenso periodico) oppure come professionista esterno
// (retribuito contro fattura, come qualunque altro fornitore di servizi).
// I due collegamenti sono entrambi facoltativi e possono coesistere: la stessa persona
// può tenere un corso come collaboratore e un altro con partita IVA. Quale dei due valga
// per un certo corso è indicato sul corso stesso (`courses.tipo_incarico`), perché la
// risposta non sta nella persona ma nell'incarico.
export const instructors = pgTable('instructors', {
	id: uuid('id').defaultRandom().primaryKey(),
	fullName: varchar('full_name', { length: 255 }).notNull(),
	taxId: varchar('tax_id', { length: 32 }),
	contactEmail: varchar('contact_email', { length: 255 }),
	contactPhone: varchar('contact_phone', { length: 64 }),
	notes: text('notes'),
	collaboratoreId: uuid('collaboratore_id'), // FK -> collaboratori.id (dichiarata sotto per non ciclare con hr.js)
	fornitoreId: uuid('fornitore_id'), // FK -> accounting_suppliers.id
});

export const rooms = pgTable('rooms', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	capacity: integer('capacity').notNull(),
	description: text('description'),
});

export const courses = pgTable('courses', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	categoryId: uuid('category_id').references(() => categories.id),
	instructorId: uuid('instructor_id').references(() => instructors.id),
	// A che titolo l'istruttore tiene questo corso: 'interno' (ore del team, retribuite
	// con il compenso periodico) oppure 'esterno' (prestazione di un fornitore, pagata
	// contro fattura). Si valorizza solo quando l'istruttore ha entrambi i collegamenti:
	// se ne ha uno solo, il titolo è già determinato dall'anagrafica.
	tipoIncarico: varchar('tipo_incarico', { length: 16 }),
	description: text('description'),
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
});

export const sessions = pgTable('sessions', {
	id: uuid('id').defaultRandom().primaryKey(),
	eventId: uuid('event_id').notNull().references(() => events.id),
	date: date('date').notNull(),
	// Ereditati dall'Event alla generazione; possono divergere solo se modifiedManually=true
	// (vincolo applicativo, vedi src/lib/sessionValidation.js — non imposto come CHECK qui).
	startTime: time('start_time').notNull(),
	endTime: time('end_time').notNull(),
	roomId: uuid('room_id').notNull().references(() => rooms.id),
	capacity: integer('capacity').notNull(),
	status: varchar('status', { length: 16 }).notNull().default('active'), // active | cancelled
	modifiedManually: boolean('modified_manually').notNull().default(false),
});

export const bookings = pgTable('bookings', {
	id: uuid('id').defaultRandom().primaryKey(),
	sessionId: uuid('session_id').notNull().references(() => sessions.id),
	memberId: uuid('member_id').notNull().references(() => members.id),
	memberName: varchar('member_name', { length: 255 }), // denormalizzato al momento della create
	status: varchar('status', { length: 16 }).notNull().default('confirmed'), // confirmed | waitlisted | cancelled
	waitlistPosition: integer('waitlist_position'),
	createdDate: timestamp('created_date', { withTimezone: true }).notNull().defaultNow(),
});

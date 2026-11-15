// La restrizione «Istruttore» (azione `suoi`): chi ce l'ha per un modulo vede e tocca solo ciò che
// riguarda i corsi di cui è istruttore (course.instructor_id = il suo account). Il controllo sta
// qui, in un posto solo, perché le rotte del calendario, delle prenotazioni e dell'endpoint
// generico lo usano tutte allo stesso modo.
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courses, events, sessions } from '../db/schema/index.js';
import { soloSuoi } from '../../../shared/permissions.js';

/** Se l'utente è limitato ai suoi corsi in quel modulo. */
export const ristrettoAi = (utente, modulo) => utente.ruolo !== 'member' && soloSuoi(utente.ruolo, modulo);

/** L'account istruttore che tiene il corso che governa la riga, o null. */
export async function istruttoreDi(entita, id) {
	if (!id) return null;
	const query = {
		Course: () => db.select({ i: courses.instructorId }).from(courses).where(eq(courses.id, id)),
		Event: () => db.select({ i: courses.instructorId }).from(events)
			.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(events.id, id)),
		Session: () => db.select({ i: courses.instructorId }).from(sessions)
			.innerJoin(events, eq(sessions.eventId, events.id))
			.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(sessions.id, id)),
		Booking: () => db.select({ i: courses.instructorId }).from(bookings)
			.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
			.innerJoin(events, eq(sessions.eventId, events.id))
			.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(bookings.id, id)),
	}[entita];
	if (!query) return null;
	const [riga] = await query().limit(1);
	return riga?.i ?? null;
}

/** Se l'utente può toccare la riga di quell'entità: sì se non è limitato, o se il corso è suo. */
export async function eSuaRiga(utente, modulo, entita, id) {
	if (!ristrettoAi(utente, modulo)) return true;
	return (await istruttoreDi(entita, id)) === String(utente.sub);
}

/** Le lezioni dei corsi di un istruttore, come sottoquery per filtrare le liste. */
export const lezioniDi = (istruttore) => db.select({ id: sessions.id }).from(sessions)
	.innerJoin(events, eq(sessions.eventId, events.id))
	.innerJoin(courses, eq(events.courseId, courses.id))
	.where(eq(courses.instructorId, istruttore));

/** Il modulo che governa le entità del calendario limitabili ai suoi corsi. */
export const MODULO_DI = { Course: 'corsi', Event: 'calendario', Session: 'calendario', Booking: 'prenotazioni' };

const corsiDi = (i) => db.select({ id: courses.id }).from(courses).where(eq(courses.instructorId, i));
export const eventiDi = (i) => db.select({ id: events.id }).from(events)
	.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(courses.instructorId, i));

/** La condizione che lascia in una lista solo le righe dei corsi dell'utente, o null. */
export function filtroSuoi(entita, utente, colonna) {
	const i = String(utente.sub);
	const condizione = {
		Course: () => eq(colonna('instructor_id'), i),
		Event: () => inArray(colonna('course_id'), corsiDi(i)),
		Session: () => inArray(colonna('event_id'), eventiDi(i)),
		Booking: () => inArray(colonna('session_id'), lezioniDi(i)),
	}[entita];
	return condizione ? condizione() : null;
}

/**
 * Se una scrittura è sua: la riga esistente (se c'è) e il corso che il corpo indica sono dei suoi.
 * Un corso non si intesta a un altro istruttore, e una lezione non si sposta su un corso altrui.
 */
export async function scritturaSua(utente, modulo, entita, id, corpo) {
	if (!ristrettoAi(utente, modulo)) return true;
	const i = String(utente.sub);
	if (id && !(await eSuaRiga(utente, modulo, entita, id))) return false;
	if (entita === 'Course') return (!id || corpo?.instructor_id !== undefined) ? String(corpo?.instructor_id) === i : true;
	const padre = { Event: ['Course', 'course_id'], Session: ['Event', 'event_id'], Booking: ['Session', 'session_id'] }[entita];
	if (!padre) return true;
	const valore = corpo?.[padre[1]];
	if (!id || valore !== undefined) return (await istruttoreDi(padre[0], valore)) === i;
	return true;
}

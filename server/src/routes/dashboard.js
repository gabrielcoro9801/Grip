// La dashboard del gestionale: numeri e avvisi, contati qui.
//
// La pagina scaricava sette tabelle intere — soci, abbonamenti, documenti, tutte le
// prenotazioni, tutte le lezioni, eventi e corsi — e poi le incrociava nel browser con un
// `.find` dentro un `.map`, a costo quadratico. Con qualche anno di prenotazioni ogni
// apertura della home diventava il download dell'intero archivio. Il portale soci fa già così:
// il server conta e manda numeri, la pagina li mostra.
//
// Il lavoro da fare non ha più liste sue qui (erano doppioni di Oggi): la dashboard mostra
// quanti avvisi aperti ci sono in ogni scheda di Da fare, gli stessi numeri della sua barra
// (lib/avvisi.js), e un clic porta alla scheda. Il lavoro si fa là; qui si guarda il quadro.
//
// Ogni parte ha il permesso di lettura dell'entità che la governa: chi non vede i soci non
// riceve gli avvisi.
import { and, asc, count, desc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { attivita, bookings, courses, events, members, rooms, sessions } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity } from '../auth/authorize.js';
import { canAccess } from '../../../shared/permissions.js';
import { situazioni } from '../lib/segnali.js';
import { allinea, conteggi } from '../lib/avvisi.js';
import { oggiIso, spostaGiorni, lezioneFinita } from '../../../shared/giorni.js';

export default async function dashboardRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (utente.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
		request.utente = utente;
	});

	// GET /api/dashboard
	fastify.get('/api/dashboard', async (request) => {
		const ruolo = request.utente.ruolo;
		const oggi = oggiIso();
		const puo = (entita) => canReadEntity(ruolo, entita);
		// Gli avvisi di Da fare li vede chi segue i soci, come la pagina: leggere i nomi dei soci per
		// il calendario non basta.
		const vedeSoci = canAccess(ruolo, 'crm_members', 'view');

		const [iscritti, motore, prossime, abbandoni] = await Promise.all([
			puo('Member') ? contaSoci() : null,
			vedeSoci ? situazioni() : null,
			puo('Booking') ? prossimeLezioni(oggi) : null,
			puo('Subscription') ? motiviAbbandono(oggi) : null,
		]);
		const soci = (motore?.persone ?? []).filter((p) => p.socio_id);

		return {
			kpi: {
				soci_attivi: puo('Subscription') ? soci.filter((p) => !p.archiviato_il && p.valido).length : null,
				soci_iscritti: iscritti,
				// I documenti da sistemare hanno la loro tessera fra gli avvisi di Da fare: un numero
				// solo, in un posto solo.
				prossime_lezioni: prossime?.length ?? null,
			},
			da_fare: motore ? await avvisiAperti(motore) : null,
			prossime,
			abbandoni,
		};
	});
}

// Gli archiviati hanno lasciato la palestra: non si contano, e non si richiamano per rinnovi o
// certificati.
async function contaSoci() {
	const [{ quanti }] = await db.select({ quanti: count() }).from(members).where(isNull(members.archiviatoIl));
	return Number(quanti);
}

/**
 * Gli avvisi aperti in ogni scheda di Da fare, adesso: le cinque tessere della dashboard
 * ({ in_scadenza, scaduto, frequenza, documento, compleanno }). Si allinea prima di contare, come
 * fa Da fare: i numeri sono quelli della sua barra.
 */
async function avvisiAperti({ oggi, soglie, persone }) {
	await allinea(db, persone, oggi, soglie);
	return conteggi({ soglie });
}

/**
 * Perché se ne vanno: i motivi scelti archiviando i soci negli ultimi 12 mesi, dal più frequente.
 * Si leggono dal diario (`abbandono`), che resta anche se il socio poi torna.
 */
async function motiviAbbandono(oggi) {
	const righe = await db.select({ motivo: attivita.esito, quanti: count() }).from(attivita)
		.where(and(eq(attivita.tipo, 'abbandono'), gte(attivita.createdDate, new Date(`${spostaGiorni(oggi, -365)}T00:00:00Z`))))
		.groupBy(attivita.esito)
		.orderBy(desc(count()));
	return righe.map((r) => ({ motivo: r.motivo, quanti: Number(r.quanti) }));
}

/**
 * Le lezioni da adesso a fra sette giorni, una riga per lezione con i posti: confermati, capienza
 * e lista d'attesa. Erano le prenotazioni, una per riga: cinque card "Cross Training" uguali per
 * una lezione sola, e un "Prossime lezioni: 131" che contava prenotazioni.
 */
async function prossimeLezioni(oggi) {
	const righe = await db
		.select({
			id: sessions.id, date: sessions.date, start_time: sessions.startTime, end_time: sessions.endTime,
			capacity: sessions.capacity, course_name: courses.name, room_name: rooms.name,
			confermati: sql`count(${bookings.id}) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number),
			in_attesa: sql`count(${bookings.id}) filter (where ${bookings.status} = 'waitlisted')`.mapWith(Number),
		})
		.from(sessions)
		.innerJoin(events, eq(sessions.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.leftJoin(rooms, eq(sessions.roomId, rooms.id))
		.leftJoin(bookings, eq(bookings.sessionId, sessions.id))
		.where(and(
			or(isNull(sessions.status), ne(sessions.status, 'cancelled')),
			gte(sessions.date, oggi),
			// Sette giorni, oggi compreso: quello che dice l'etichetta.
			lte(sessions.date, spostaGiorni(oggi, 6)),
		))
		.groupBy(sessions.id, courses.name, rooms.name)
		.orderBy(asc(sessions.date), asc(sessions.startTime));
	return righe.filter((l) => !lezioneFinita(l));
}

// La dashboard del gestionale: numeri e avvisi, contati qui.
//
// La pagina scaricava sette tabelle intere — soci, abbonamenti, documenti, tutte le
// prenotazioni, tutte le lezioni, eventi e corsi — e poi le incrociava nel browser con un
// `.find` dentro un `.map`, a costo quadratico. Con qualche anno di prenotazioni ogni
// apertura della home diventava il download dell'intero archivio. Il portale soci fa già così:
// il server conta e manda numeri, la pagina li mostra.
//
// Rinnovi e certificati non hanno più un conto loro: li dice il motore dei segnali
// (lib/segnali.js), lo stesso di Oggi e dell'elenco dei soci, così i numeri sono gli stessi
// ovunque. Qui si mostrano tutti, anche quelli già contattati: la dashboard è il quadro, Oggi
// la lista di cose da fare.
//
// Ogni parte ha il permesso di lettura dell'entità che la governa: chi non vede i documenti
// riceve `null` al posto degli avvisi sui certificati, e la pagina non mostra quella parte.
import { and, asc, count, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courses, events, members, sessions } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity } from '../auth/authorize.js';
import { situazioni } from '../lib/segnali.js';
import { oggiIso, spostaGiorni } from '../../../shared/giorni.js';

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
		const servonoSegnali = puo('Subscription') || puo('MemberDocument');

		const [iscritti, motore, prossime] = await Promise.all([
			puo('Member') ? contaSoci() : null,
			servonoSegnali ? situazioni() : null,
			puo('Booking') ? prossimeLezioni(oggi) : null,
		]);
		const soci = (motore?.persone ?? []).filter((p) => p.socio_id);
		const abbonamenti = puo('Subscription') ? rinnovi(soci) : null;
		const certificati = puo('MemberDocument') ? avvisiCertificati(soci) : null;

		return {
			kpi: {
				soci_attivi: abbonamenti ? soci.filter((p) => !p.archiviato_il && p.valido).length : null,
				soci_iscritti: iscritti,
				certificati_in_scadenza: certificati?.length ?? null,
				prossime_lezioni: prossime?.length ?? null,
			},
			certificati,
			rinnovi: abbonamenti,
			prossime,
		};
	});
}

// Gli archiviati hanno lasciato la palestra: non si contano, e non si richiamano per rinnovi o
// certificati.
async function contaSoci() {
	const [{ quanti }] = await db.select({ quanti: count() }).from(members).where(isNull(members.archiviatoIl));
	return Number(quanti);
}

// Il segnale di una persona per un codice, contato anche se è nascosto da un contatto.
const segnaleDi = (persona, codici) => persona.segnali.find((s) => s.pubblico === 'staff' && codici.includes(s.codice));

/**
 * Gli avvisi di rinnovo: chi è in scadenza senza aver già rinnovato, e chi è scaduto da poco
 * (recuperabile). Chi è scaduto da mesi è un ex socio: non è più un avviso.
 */
function rinnovi(soci) {
	return soci
		.map((p) => ({ p, s: segnaleDi(p, ['in_scadenza', 'scaduto_recuperabile']) }))
		.filter(({ s }) => s)
		.map(({ p, s }) => ({
			id: s.dati.iscrizione_id, member_id: p.socio_id, member_name: p.nome, plan_name: s.dati.abbonamento,
			status: s.codice === 'in_scadenza' ? 'expiring' : 'expired', giorni: s.dati.giorni,
		}))
		.sort((a, b) => a.giorni - b.giorni);
}

/** I certificati medici scaduti o in scadenza che contano ancora, uno per socio. */
function avvisiCertificati(soci) {
	return soci
		.map((p) => ({ p, s: segnaleDi(p, ['certificato_scaduto', 'certificato_in_scadenza']) }))
		.filter(({ s }) => s)
		.map(({ p, s }) => ({ id: s.dati.documento_id, member_id: p.socio_id, member_name: p.nome, file_name: s.dati.file_name, giorni: s.dati.giorni, scaduto: s.dati.scaduto }))
		.sort((a, b) => a.giorni - b.giorni);
}

/** Le prenotazioni non disdette delle lezioni da oggi a fra sette giorni. */
async function prossimeLezioni(oggi) {
	const righe = await db
		.select({
			id: bookings.id, member_name: bookings.memberName, status: bookings.status,
			date: sessions.date, start_time: sessions.startTime, course_name: courses.name,
		})
		.from(bookings)
		.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
		.innerJoin(events, eq(sessions.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(and(
			ne(bookings.status, 'cancelled'),
			or(isNull(sessions.status), ne(sessions.status, 'cancelled')),
			gte(sessions.date, oggi),
			lte(sessions.date, spostaGiorni(oggi, 7)),
		))
		.orderBy(asc(sessions.date), asc(sessions.startTime));
	return righe;
}

// La dashboard del gestionale: numeri e avvisi, contati qui.
//
// La pagina scaricava sette tabelle intere — soci, abbonamenti, documenti, tutte le
// prenotazioni, tutte le lezioni, eventi e corsi — e poi le incrociava nel browser con un
// `.find` dentro un `.map`, a costo quadratico. Con qualche anno di prenotazioni ogni
// apertura della home diventava il download dell'intero archivio. Il portale soci fa già così:
// il server conta e manda numeri, la pagina li mostra.
//
// Il lavoro da fare non ha più liste sue qui (erano doppioni di Oggi): la dashboard mostra
// quante persone ci sono in ogni linea di Da fare, contate dal motore dei segnali
// (lib/segnali.js), e un clic porta alla linea. Il lavoro si fa là; qui si guarda il quadro.
//
// Ogni parte ha il permesso di lettura dell'entità che la governa: chi non vede i soci non
// riceve le loro linee, chi non vede i contatti non riceve quella dei contatti.
import { and, asc, count, desc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { attivita, bookings, courses, events, members, sessions } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity } from '../auth/authorize.js';
import { canAccess } from '../../../shared/permissions.js';
import { situazioni } from '../lib/segnali.js';
import { daFare, lineaDi, LINEE } from '../../../shared/segnali.js';
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
		// Le linee di Da fare le vede chi segue i soci o i contatti, come la pagina: leggere i nomi dei soci
		// per il calendario non basta.
		const vedeSoci = canAccess(ruolo, 'crm_members', 'view');
		const vedeLead = canAccess(ruolo, 'crm_leads', 'view');

		const [iscritti, motore, prossime, abbandoni] = await Promise.all([
			puo('Member') ? contaSoci() : null,
			vedeSoci || vedeLead ? situazioni() : null,
			puo('Booking') ? prossimeLezioni(oggi) : null,
			puo('Subscription') ? motiviAbbandono(oggi) : null,
		]);
		const persone = (motore?.persone ?? []).filter((p) => (p.socio_id ? vedeSoci : vedeLead));
		const soci = persone.filter((p) => p.socio_id);

		return {
			kpi: {
				soci_attivi: puo('Subscription') ? soci.filter((p) => !p.archiviato_il && p.valido).length : null,
				soci_iscritti: iscritti,
				documenti_da_sistemare: puo('MemberDocument') ? soci.filter((p) => p.segnali.some((s) => s.pubblico === 'staff' && s.codice.startsWith('documento_'))).length : null,
				prossime_lezioni: prossime?.length ?? null,
			},
			da_fare: motore ? lineeDaFare(persone, { vedeSoci, vedeLead }) : null,
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
 * Quante persone ci sono in ogni linea di Da fare, adesso (i segnali già fatti non contano): le
 * tessere della dashboard. Le linee che il ruolo non vede non ci sono; quelle vuote sì, a zero.
 */
function lineeDaFare(persone, { vedeSoci, vedeLead }) {
	const conti = Object.fromEntries(LINEE
		.filter((l) => !l.soloImpostazioni && (l.valore === 'contatti' ? vedeLead : vedeSoci))
		.map((l) => [l.valore, 0]));
	for (const p of persone) {
		for (const l of new Set(daFare(p.segnali, 'staff').map((s) => lineaDi(s.codice)))) {
			if (l in conti) conti[l] += 1;
		}
	}
	return conti;
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

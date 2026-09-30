// La dashboard del gestionale: numeri e avvisi, contati qui.
//
// La pagina scaricava sette tabelle intere — soci, abbonamenti, documenti, tutte le
// prenotazioni, tutte le lezioni, eventi e corsi — e poi le incrociava nel browser con un
// `.find` dentro un `.map`, a costo quadratico. Con qualche anno di prenotazioni ogni
// apertura della home diventava il download dell'intero archivio. Il portale soci fa già così:
// il server conta e manda numeri, la pagina li mostra.
//
// Ogni parte ha il permesso di lettura dell'entità che la governa: chi non vede i documenti
// riceve `null` al posto degli avvisi sui certificati, e la pagina non mostra quella parte.
import { and, asc, count, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, courses, events, memberDocuments, members, sessions, subscriptions } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity } from '../auth/authorize.js';
import { conStatoDocumenti } from '../../../shared/anagrafica.js';
import { GIORNI_ABBONAMENTO_IN_SCADENZA, oggiIso } from '../../../shared/abbonamenti.js';

const GIORNO_MS = 86_400_000;
const aMezzanotte = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const spostaGiorni = (iso, n) => new Date(aMezzanotte(iso) + n * GIORNO_MS).toISOString().slice(0, 10);

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
		const giorniDa = (data) => (data ? Math.round((aMezzanotte(data) - aMezzanotte(oggi)) / GIORNO_MS) : null);
		const puo = (entita) => canReadEntity(ruolo, entita);

		const [iscritti, abbonamenti, certificati, prossime] = await Promise.all([
			puo('Member') ? contaSoci() : null,
			puo('Subscription') ? rinnovi(oggi, giorniDa) : null,
			puo('MemberDocument') ? avvisiCertificati(giorniDa) : null,
			puo('Booking') ? prossimeLezioni(oggi) : null,
		]);

		return {
			kpi: {
				soci_attivi: abbonamenti?.sociAttivi ?? null,
				soci_iscritti: iscritti,
				certificati_in_scadenza: certificati?.length ?? null,
				prossime_lezioni: prossime?.length ?? null,
			},
			certificati,
			rinnovi: abbonamenti?.avvisi ?? null,
			prossime,
		};
	});
}

async function contaSoci() {
	const [{ quanti }] = await db.select({ quanti: count() }).from(members);
	return Number(quanti);
}

/**
 * Soci con un abbonamento valido, e gli avvisi di rinnovo.
 *
 * Un avviso è un abbonamento in scadenza, oppure l'ultimo scaduto di un socio che non ne ha un
 * altro valido: chi ha già rinnovato non va richiamato, e di chi non ha rinnovato basta
 * l'ultimo — prima comparivano tutti quelli che aveva mai avuto.
 */
async function rinnovi(oggi, giorniDa) {
	const righe = await db
		.select({
			id: subscriptions.id, memberId: subscriptions.memberId, planName: subscriptions.planName,
			endDate: subscriptions.endDate, nome: members.fullName,
		})
		.from(subscriptions)
		.innerJoin(members, eq(subscriptions.memberId, members.id));

	const validi = new Set(righe.filter((r) => !r.endDate || r.endDate >= oggi).map((r) => r.memberId));
	const ultimoScaduto = new Map();
	const avvisi = [];
	for (const r of righe) {
		const giorni = giorniDa(r.endDate);
		if (giorni !== null && giorni >= 0 && giorni <= GIORNI_ABBONAMENTO_IN_SCADENZA) {
			avvisi.push({ id: r.id, member_name: r.nome, plan_name: r.planName, status: 'expiring', giorni });
		} else if (giorni !== null && giorni < 0 && !validi.has(r.memberId)) {
			const prima = ultimoScaduto.get(r.memberId);
			if (!prima || r.endDate > prima.endDate) ultimoScaduto.set(r.memberId, r);
		}
	}
	for (const r of ultimoScaduto.values()) {
		avvisi.push({ id: r.id, member_name: r.nome, plan_name: r.planName, status: 'expired', giorni: giorniDa(r.endDate) });
	}
	avvisi.sort((a, b) => a.giorni - b.giorni);
	return { sociAttivi: validi.size, avvisi };
}

/**
 * I certificati medici scaduti o in scadenza che contano ancora.
 *
 * Lo stato lo decide `conStatoDocumenti`, socio per socio: un certificato scaduto e già
 * sostituito è archiviato, non è un avviso.
 */
async function avvisiCertificati(giorniDa) {
	const righe = await db
		.select({
			id: memberDocuments.id, member_id: memberDocuments.memberId, document_type: memberDocuments.documentType,
			created_date: memberDocuments.createdDate, expiry_date: memberDocuments.expiryDate,
			file_name: memberDocuments.fileName, nome: members.fullName,
		})
		.from(memberDocuments)
		.innerJoin(members, eq(memberDocuments.memberId, members.id))
		.where(eq(memberDocuments.documentType, 'certificato_medico'));

	const perSocio = new Map();
	for (const r of righe) {
		if (!perSocio.has(r.member_id)) perSocio.set(r.member_id, []);
		perSocio.get(r.member_id).push(r);
	}
	return [...perSocio.values()]
		.flatMap((documenti) => conStatoDocumenti(documenti, giorniDa))
		.filter((d) => d.stato === 'scaduto' || d.stato === 'in_scadenza')
		.map((d) => ({ id: d.id, member_name: d.nome, file_name: d.file_name, giorni: d.giorni_alla_scadenza, scaduto: d.stato === 'scaduto' }))
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

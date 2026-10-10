// La vista dell'istruttore: le sue lezioni, chi è prenotato, presenti e no-show, chi salta spesso,
// e una nota nel diario del socio ("si è fatto male al ginocchio").
//
// Accesso leggero: serve il modulo `lezioni_istruttore` e un account collegato a un istruttore
// (staff_accounts.instructor_id, lo sceglie l'amministratore). Le sue lezioni sono quelle dei corsi
// che tiene; i suoi soci sono chi è prenotato a una di quelle, nelle ultime 12 settimane o in
// futuro. Di nessun altro vede niente, e dei suoi solo il nome, le presenze e le note degli
// istruttori: non contatti, rinnovi o recapiti, che sono lavoro della segreteria.
//
// Presenze e no-show si calcolano dagli ingressi, come per il motore (esitoPrenotazione): niente
// appello da fare a fine lezione.
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts, instructors, courses, events, sessions, rooms, bookings, members, ingressi, attivita } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { esitoPrenotazione } from '../../../shared/segnali.js';
import { NOTA_DIARIO_MASSIMO } from '../../../shared/lead.js';
import { oggiIso, spostaGiorni, eUnGiorno, giorniFra } from '../../../shared/giorni.js';

// Quanti no-show nelle sue lezioni delle ultime 4 settimane fanno "salta spesso": come il motore.
const NO_SHOW_SPESSO = 2;
// Fin dove, all'indietro, un socio prenotato resta "suo".
const GIORNI_SUOI = 84;
const GIORNI_MASSIMI = 31;

const ora = (t) => String(t).slice(0, 5);

/** Le lezioni attive dei corsi dell'istruttore fra due giorni, con chi è prenotato e com'è andata. */
async function lezioniDi(idIstruttore, dal, al, adesso = new Date()) {
	const lezioni = await db.select({
		id: sessions.id, data: sessions.date, inizio: sessions.startTime, fine: sessions.endTime, capienza: sessions.capacity,
		corso: courses.name, sala: rooms.name,
	}).from(sessions)
		.innerJoin(events, eq(sessions.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.leftJoin(rooms, eq(sessions.roomId, rooms.id))
		.where(and(eq(courses.instructorId, idIstruttore), eq(sessions.status, 'active'), gte(sessions.date, dal), lte(sessions.date, al)))
		.orderBy(asc(sessions.date), asc(sessions.startTime));
	if (!lezioni.length) return [];
	const prenotazioni = await db.select({ lezione: bookings.sessionId, socio_id: bookings.memberId, nome: members.fullName, stato: bookings.status })
		.from(bookings).innerJoin(members, eq(bookings.memberId, members.id))
		.where(and(inArray(bookings.sessionId, lezioni.map((l) => l.id)), ne(bookings.status, 'cancelled')));
	const soci = [...new Set(prenotazioni.map((p) => p.socio_id))];
	const entrate = soci.length
		? await db.select({ socio: ingressi.memberId, alle: ingressi.entratoAlle }).from(ingressi)
			.where(and(inArray(ingressi.memberId, soci), gte(ingressi.entratoAlle, new Date(`${spostaGiorni(dal, -1)}T00:00:00Z`)), lte(ingressi.entratoAlle, new Date(`${spostaGiorni(al, 2)}T00:00:00Z`))))
		: [];
	const istantiDi = new Map();
	for (const e of entrate) istantiDi.set(e.socio, [...(istantiDi.get(e.socio) ?? []), e.alle]);
	return lezioni.map((l) => ({
		...l, inizio: ora(l.inizio), fine: ora(l.fine),
		prenotati: prenotazioni.filter((p) => p.lezione === l.id).map((p) => ({
			socio_id: p.socio_id, nome: p.nome, stato: p.stato,
			// Chi è in lista d'attesa non era atteso: non è un no-show.
			esito: p.stato === 'confirmed' ? esitoPrenotazione({ data: l.data, inizio: l.inizio, fine: l.fine }, istantiDi.get(p.socio_id) ?? [], adesso) : null,
		})).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'it')),
	}));
}

/** Vera se il socio è prenotato a una lezione dell'istruttore, dalle ultime 12 settimane in poi. */
async function eSuo(idIstruttore, idSocio) {
	const [riga] = await db.select({ id: bookings.id }).from(bookings)
		.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
		.innerJoin(events, eq(sessions.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(and(eq(courses.instructorId, idIstruttore), eq(bookings.memberId, idSocio), ne(bookings.status, 'cancelled'), gte(sessions.date, spostaGiorni(oggiIso(), -GIORNI_SUOI))))
		.limit(1);
	return Boolean(riga);
}

export default async function istruttoreRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		const azione = request.method === 'GET' ? 'view' : 'edit';
		if (utente.ruolo === 'member' || !canAccess(utente.ruolo, 'lezioni_istruttore', azione)) {
			return reply.code(403).send({ error: 'Non consentito.' });
		}
		const [account] = await db.select({ nome: staffAccounts.nome, idIstruttore: staffAccounts.instructorId }).from(staffAccounts).where(eq(staffAccounts.id, utente.sub)).limit(1);
		request.utente = utente;
		request.account = account ?? {};
	});

	// Senza collegamento non si sa quali siano le sue lezioni: le rotte dei soci rispondono 403.
	const collegato = async (request, reply) => {
		if (!request.account.idIstruttore) return reply.code(403).send({ error: 'Il tuo account non è collegato a un istruttore: chiedilo in Admin & Utenti.' });
		if (!(await eSuo(request.account.idIstruttore, request.params.id))) return reply.code(404).send({ error: 'Socio non trovato fra quelli delle tue lezioni.' });
	};

	/**
	 * GET /api/istruttore/lezioni?dal&al → { collegato, istruttore, dal, al, lezioni, spesso }
	 *
	 * Senza date: da oggi a fra 6 giorni. `spesso`: i soci che nelle sue lezioni delle ultime 4
	 * settimane hanno almeno due no-show, con quanti.
	 */
	fastify.get('/api/istruttore/lezioni', async (request, reply) => {
		if (!request.account.idIstruttore) return { collegato: false, lezioni: [], spesso: [] };
		const oggi = oggiIso();
		const dal = request.query?.dal ?? oggi;
		const al = request.query?.al ?? spostaGiorni(dal, 6);
		if (!eUnGiorno(dal) || !eUnGiorno(al) || al < dal || giorniFra(dal, al) > GIORNI_MASSIMI) {
			return reply.code(400).send({ error: `Date non valide (al massimo ${GIORNI_MASSIMI} giorni).` });
		}
		const idIstruttore = request.account.idIstruttore;
		const [[istruttore], lezioni, passate] = await Promise.all([
			db.select({ nome: instructors.fullName }).from(instructors).where(eq(instructors.id, idIstruttore)).limit(1),
			lezioniDi(idIstruttore, dal, al),
			lezioniDi(idIstruttore, spostaGiorni(oggi, -27), oggi),
		]);
		const conti = new Map();
		for (const p of passate.flatMap((l) => l.prenotati).filter((x) => x.esito === 'no_show')) {
			conti.set(p.socio_id, { socio_id: p.socio_id, nome: p.nome, no_show: (conti.get(p.socio_id)?.no_show ?? 0) + 1 });
		}
		const spesso = [...conti.values()].filter((c) => c.no_show >= NO_SHOW_SPESSO).sort((a, b) => b.no_show - a.no_show);
		const saltaSpesso = new Set(spesso.map((s) => s.socio_id));
		return {
			collegato: true, istruttore: { nome: istruttore?.nome ?? request.account.nome }, dal, al, spesso,
			lezioni: lezioni.map((l) => ({ ...l, prenotati: l.prenotati.map((p) => ({ ...p, salta_spesso: saltaSpesso.has(p.socio_id) })) })),
		};
	});

	/** GET /api/istruttore/soci/:id → { socio: { id, nome }, note } — le note degli istruttori, dalla più recente. */
	fastify.get('/api/istruttore/soci/:id', { preHandler: collegato }, async (request) => {
		const [socio] = await db.select({ id: members.id, nome: members.fullName, personaId: members.personaId }).from(members).where(eq(members.id, request.params.id)).limit(1);
		const note = await db.select({ id: attivita.id, nota: attivita.nota, autore_nome: attivita.autoreNome, created_date: attivita.createdDate })
			.from(attivita).where(and(eq(attivita.personaId, socio.personaId), eq(attivita.tipo, 'nota_istruttore')))
			.orderBy(asc(attivita.createdDate));
		return { socio: { id: socio.id, nome: socio.nome }, note: note.reverse() };
	});

	/** POST /api/istruttore/soci/:id/note { nota } → 201 { nota }: nel diario del socio, la legge anche la reception. */
	fastify.post('/api/istruttore/soci/:id/note', { preHandler: collegato }, async (request, reply) => {
		const nota = String(request.body?.nota ?? '').trim();
		if (!nota) return reply.code(400).send({ error: 'Scrivi la nota.' });
		if (nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		const [socio] = await db.select({ personaId: members.personaId }).from(members).where(eq(members.id, request.params.id)).limit(1);
		const [riga] = await db.insert(attivita).values({
			personaId: socio.personaId, tipo: 'nota_istruttore', nota, autoreId: request.utente.sub, autoreNome: request.account.nome ?? '',
		}).returning({ id: attivita.id, nota: attivita.nota, autore_nome: attivita.autoreNome, created_date: attivita.createdDate });
		reply.code(201);
		return { nota: riga };
	});
}

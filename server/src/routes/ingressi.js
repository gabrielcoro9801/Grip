// Gli ingressi in palestra: il controllo al bancone e il registro.
//
// La reception legge il QR del socio (o lo cerca per nome), vede chi è e se è in regola —
// semaforo verde, giallo o rosso, con gli avvisi di shared/avvisi.js — e l'ingresso si registra.
// Non sono presenze alle lezioni: dicono chi è entrato e quando, e servono a controllare
// l'accesso e alle statistiche della palestra.
//
// Il bancone è anche il momento migliore per tenere un socio: la verifica porta i segnali del
// motore (shared/segnali.js) con pubblico "bancone" — il rinnovo da proporre, il bentornato, gli
// auguri, il traguardo — e chi non viene più lo dice lo stesso motore, non un conto a parte.
//
// Permessi: chi vede le anagrafiche dei soci verifica e legge il registro; chi le modifica
// registra gli ingressi. Il socio non passa di qui.
import { and, desc, eq, gte, lte, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	members, subscriptions, memberDocuments, qrAccessi, ingressi, bookings, sessions, events, courses, staffAccounts,
} from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity, canWriteEntity } from '../auth/authorize.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { semeDelCodice, verificaCodice } from '../lib/qrDinamico.js';
import { firmaUrl } from '../lib/urlFirmati.js';
import { situazioni } from '../lib/segnali.js';
import { avvisiSocio, semaforo } from '../../../shared/avvisi.js';
import { daFare } from '../../../shared/segnali.js';
import { oggiIso, oraIso, spostaGiorni, eUnGiorno, giorniFra } from '../../../shared/giorni.js';

// Le fasce orarie della mappa di affluenza, di due ore.
const FASCE = [6, 8, 10, 12, 14, 16, 18, 20];
const GIORNI_SETTIMANA = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const ESITO = { verde: 'ammesso', giallo: 'ammesso_con_avvisi', rosso: 'ammesso_in_deroga' };

/** Lunedì = 0 … domenica = 6, da "AAAA-MM-GG". */
const giornoSettimana = (iso) => {
	const [a, m, g] = iso.split('-').map(Number);
	return (new Date(Date.UTC(a, m - 1, g)).getUTCDay() + 6) % 7;
};

/** Tutto quello che il bancone deve sapere di un socio, a oggi. */
async function schedaIngresso(memberId) {
	const [socio] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
	if (!socio) return null;
	const oggi = oggiIso();
	const [iscrizioni, documenti, lezioni, [ultimo]] = await Promise.all([
		db.select({ start_date: subscriptions.startDate, end_date: subscriptions.endDate }).from(subscriptions).where(eq(subscriptions.memberId, memberId)),
		db.select({ document_type: memberDocuments.documentType, created_date: memberDocuments.createdDate, expiry_date: memberDocuments.expiryDate })
			.from(memberDocuments).where(eq(memberDocuments.memberId, memberId)),
		db.select({ corso: courses.name, inizio: sessions.startTime, fine: sessions.endTime, stato: bookings.status })
			.from(bookings)
			.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
			.innerJoin(events, eq(sessions.eventId, events.id))
			.innerJoin(courses, eq(events.courseId, courses.id))
			.where(and(eq(bookings.memberId, memberId), eq(sessions.date, oggi), ne(bookings.status, 'cancelled'), eq(sessions.status, 'active')))
			.orderBy(sessions.startTime),
		db.select({ alle: ingressi.entratoAlle }).from(ingressi).where(eq(ingressi.memberId, memberId)).orderBy(desc(ingressi.entratoAlle)).limit(1),
	]);
	const avvisi = avvisiSocio({
		socio: { date_of_birth: socio.dateOfBirth, archiviato_il: socio.archiviatoIl }, iscrizioni, documenti, oggi,
	});
	const [situazione] = (await situazioni({ personaId: socio.personaId })).persone;
	return {
		socio: {
			id: socio.id, persona_id: socio.personaId, nome: socio.fullName, codice_socio: socio.codiceSocio,
			foto_url: socio.fotoUrl ? firmaUrl(socio.fotoUrl) : null, telefono: socio.phone,
		},
		semaforo: semaforo(avvisi),
		avvisi,
		// Prima di registrare l'ingresso: "scade tra 3 giorni: proponi il rinnovo", "bentornato".
		segnali: daFare(situazione?.segnali ?? [], 'bancone').map((s) => ({ codice: s.codice, motivo: s.motivo, azioni: s.azioni })),
		lezioni_oggi: lezioni.map((l) => ({ corso: l.corso, inizio: String(l.inizio).slice(0, 5), fine: String(l.fine).slice(0, 5), stato: l.stato })),
		ultimo_ingresso: ultimo?.alle ?? null,
	};
}

/** Chi ha un QR valido adesso, o il perché no. Le stesse regole di /api/qr/verifica. */
async function socioDalCodice(codice) {
	const scansionato = String(codice ?? '').trim().toUpperCase();
	const seme = semeDelCodice(scansionato);
	if (!seme) return { motivo: 'Codice illeggibile.' };
	const [qr] = await db.select().from(qrAccessi).where(eq(qrAccessi.codice, seme)).limit(1);
	if (!qr) return { motivo: 'Codice sconosciuto.' };
	if (qr.stato !== 'attivo') return { motivo: 'Codice revocato.' };
	if (!verificaCodice(qr.codice, scansionato)) return { motivo: 'Codice scaduto: fattelo mostrare di nuovo.' };
	return { memberId: qr.clienteId };
}

export default async function ingressiRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (utente.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
		// Registrare un ingresso è scrivere; verificare e leggere no.
		const scrive = request.method === 'POST' && request.url === '/api/ingressi';
		const ok = scrive ? canWriteEntity(utente.ruolo, 'Member') : canReadEntity(utente.ruolo, 'Member');
		if (!ok) return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
		request.utente = utente;
	});

	/**
	 * POST /api/ingressi/verifica { codice } | { member_id }
	 * → { valido: false, motivo } | { valido: true, metodo, socio, semaforo, avvisi, lezioni_oggi, ultimo_ingresso }
	 *
	 * Non scrive niente: il bancone decide se registrare (verde e giallo da soli, rosso solo
	 * con la deroga).
	 */
	fastify.post('/api/ingressi/verifica', async (request) => {
		const { codice, member_id: diretto } = request.body ?? {};
		let memberId = diretto;
		if (!memberId) {
			const esito = await socioDalCodice(codice);
			if (!esito.memberId) return { valido: false, motivo: esito.motivo };
			memberId = esito.memberId;
		}
		const scheda = await schedaIngresso(memberId);
		if (!scheda) return { valido: false, motivo: 'Socio inesistente.' };
		return { valido: true, metodo: diretto ? 'manuale' : 'qr', ...scheda };
	});

	/**
	 * POST /api/ingressi { member_id, metodo: 'qr'|'manuale', deroga? } → { ingresso }
	 *
	 * Il semaforo si ricalcola qui, non si prende dal client. Rosso si registra solo con la
	 * deroga, che finisce anche nel registro delle azioni.
	 */
	fastify.post('/api/ingressi', async (request, reply) => {
		const { member_id: memberId, metodo = 'qr', deroga = false } = request.body ?? {};
		if (!memberId) return reply.code(400).send({ error: 'Indica il socio.' });
		const scheda = await schedaIngresso(memberId);
		if (!scheda) return reply.code(404).send({ error: 'Socio inesistente.' });
		if (scheda.semaforo === 'rosso' && !deroga) {
			return reply.code(409).send({ error: scheda.avvisi[0]?.titolo ?? 'Ingresso non consentito.', semaforo: 'rosso' });
		}
		const [chi] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		const [ingresso] = await db.insert(ingressi).values({
			memberId, esito: ESITO[scheda.semaforo], avvisi: scheda.avvisi.map((a) => a.codice),
			metodo: metodo === 'manuale' ? 'manuale' : 'qr', registratoDaId: request.utente.sub, registratoDaNome: chi?.nome ?? '',
		}).returning();
		if (scheda.semaforo === 'rosso') {
			await registra(request.utente, {
				tipoAzione: 'update', entitaTipo: 'member', entitaNome: scheda.socio.nome, entitaId: memberId,
				dettagli: `Ingresso in deroga: ${scheda.avvisi.filter((a) => a.gravita === 'rosso').map((a) => a.titolo).join(', ')}`,
			}, request.log);
		}
		reply.code(201);
		return { ingresso: { id: ingresso.id, esito: ingresso.esito, entrato_alle: ingresso.entratoAlle } };
	});

	/**
	 * GET /api/ingressi?dal&al&member_id → { ingressi }
	 * Il registro, dal più recente. Senza date: oggi.
	 */
	fastify.get('/api/ingressi', async (request, reply) => {
		const oggi = oggiIso();
		const dal = request.query?.dal ?? oggi;
		const al = request.query?.al ?? oggi;
		if (!eUnGiorno(dal) || !eUnGiorno(al)) return reply.code(400).send({ error: 'Date non valide.' });
		// L'intervallo si legge in ora di Roma: un giorno in più per lato, poi si filtra.
		const righe = await db.select({
			id: ingressi.id, member_id: ingressi.memberId, nome: members.fullName, entrato_alle: ingressi.entratoAlle,
			esito: ingressi.esito, avvisi: ingressi.avvisi, metodo: ingressi.metodo, registrato_da: ingressi.registratoDaNome,
		})
			.from(ingressi)
			.innerJoin(members, eq(ingressi.memberId, members.id))
			.where(and(
				gte(ingressi.entratoAlle, new Date(`${spostaGiorni(dal, -1)}T00:00:00Z`)),
				lte(ingressi.entratoAlle, new Date(`${spostaGiorni(al, 2)}T00:00:00Z`)),
				request.query?.member_id ? eq(ingressi.memberId, request.query.member_id) : undefined,
			))
			.orderBy(desc(ingressi.entratoAlle))
			.limit(1000);
		return { ingressi: righe.filter((r) => { const g = oggiIso(r.entrato_alle); return g >= dal && g <= al; }) };
	});

	/**
	 * GET /api/ingressi/statistiche?giorni=30
	 * → { giorni, perGiorno, totale, totalePrima, soci, frequenzaSettimanale, mappa, fasce, rischio }
	 */
	fastify.get('/api/ingressi/statistiche', async (request) => {
		const giorni = Math.min(365, Math.max(7, Number(request.query?.giorni) || 30));
		const oggi = oggiIso();
		const dal = spostaGiorni(oggi, -(giorni - 1));
		const dalPrima = spostaGiorni(dal, -giorni);
		const righe = (await db.select({ memberId: ingressi.memberId, alle: ingressi.entratoAlle })
			.from(ingressi)
			.where(gte(ingressi.entratoAlle, new Date(`${spostaGiorni(dalPrima, -1)}T00:00:00Z`))))
			.map((r) => ({ memberId: r.memberId, giorno: oggiIso(r.alle), ora: Number(oraIso(r.alle).slice(0, 2)) }));
		const nelPeriodo = righe.filter((r) => r.giorno >= dal && r.giorno <= oggi);
		const prima = righe.filter((r) => r.giorno >= dalPrima && r.giorno < dal);

		const perGiorno = [];
		for (let g = dal; g <= oggi; g = spostaGiorni(g, 1)) {
			const delGiorno = nelPeriodo.filter((r) => r.giorno === g);
			perGiorno.push({ data: g, ingressi: delGiorno.length, soci: new Set(delGiorno.map((r) => r.memberId)).size });
		}
		const mappa = GIORNI_SETTIMANA.map(() => FASCE.map(() => 0));
		for (const r of nelPeriodo) {
			const fascia = FASCE.findIndex((f) => r.ora >= f && r.ora < f + 2);
			if (fascia >= 0) mappa[giornoSettimana(r.giorno)][fascia] += 1;
		}
		const soci = new Set(nelPeriodo.map((r) => r.memberId)).size;

		// Chi non viene più lo dice il motore dei segnali: è "assente" (shared/segnali.js), con la
		// stessa soglia di Oggi e dell'elenco dei soci.
		const motore = await situazioni();
		const rischio = motore.persone
			.filter((p) => p.socio_id && p.segnali.some((s) => s.pubblico === 'staff' && s.codice === 'assente'))
			.map((p) => ({
				id: p.socio_id, nome: p.nome, telefono: p.telefono, ultimo_ingresso: p.ultimo_ingresso,
				giorni: p.ultimo_ingresso ? giorniFra(p.ultimo_ingresso, oggi) : null,
			}))
			.sort((a, b) => (b.giorni ?? Infinity) - (a.giorni ?? Infinity) || a.nome.localeCompare(b.nome, 'it'));

		return {
			giorni, dal, al: oggi, perGiorno,
			totale: nelPeriodo.length, totalePrima: prima.length, soci,
			frequenzaSettimanale: soci ? Math.round((nelPeriodo.length / soci / (giorni / 7)) * 10) / 10 : null,
			mappa, fasce: FASCE.map((f) => `${f}–${f + 2}`), giorniSettimana: GIORNI_SETTIMANA,
			rischio, sogliaRischio: motore.soglie.segnali.assenzaGiorni,
		};
	});
}

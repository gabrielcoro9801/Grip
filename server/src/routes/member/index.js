import { eq, and, gte, lte, inArray, ne, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
	members, subscriptions, memberDocuments, qrAccessi,
	courses, categories, instructors, rooms, events, sessions, bookings,
} from '../../db/schema/index.js';
import { getUserFromRequest } from '../../auth/tokens.js';
import { socioDiAccount } from '../../auth/socioCorrente.js';
import { codiceDinamico } from '../../lib/qrDinamico.js';
import { msResiduiFinestra } from '../../../../shared/qrDinamico.js';

/**
 * L'API del portale soci.
 *
 * ## Perché esiste, visto che c'è già /api/entities
 *
 * Il portale chiedeva le entità per nome — `Member`, `WorkoutLog`, `Booking` — e il server
 * gli restituiva le righe filtrate. Funziona, ed è comodo finché il client è una pagina web
 * che si aggiorna insieme al server: si rilascia tutto insieme e nessuno se ne accorge.
 *
 * Con un'app installata su un telefono quel patto salta. L'app resta sul dispositivo di
 * qualcuno per mesi, in versioni che nessuno può aggiornare a comando, e se il suo contratto
 * sono i nomi delle colonne del database allora rinominare un campo rompe le app di chi non
 * ha aggiornato. Qui il contratto è esplicito: dei nomi delle colonne non esce niente.
 *
 * ## Perché non è solo una questione di contratto
 *
 * Per disegnare il calendario dei corsi il portale faceva **sette** richieste e si scaricava
 * fino a cinquecento prenotazioni **di tutti i soci** — col nome tolto dal server, ma con
 * l'identificativo del socio e quello della lezione: cioè chi frequenta cosa. Il conto dei
 * posti liberi lo deve fare il server e mandare un numero. Sono privacy e batteria, non
 * eleganza.
 *
 * ## Il confine
 *
 * Questo plugin è **solo per i soci**: un token dello staff riceve 403, non una risposta
 * parziale. Il socio a cui l'account è collegato si rilegge dal database a ogni richiesta
 * (vedi `auth/socioCorrente.js`), e da lì in poi nessun handler si fida di un identificativo
 * che arriva da fuori.
 *
 * `memberScope.js` non sparisce: resta la serratura sull'endpoint generico, che continua a
 * esistere. Queste rotte sono la porta d'ingresso, quello è il muro dietro.
 *
 * ## La versione nel percorso
 *
 * `v1` sta nell'indirizzo perché è l'unica forma che si legge in un log e si prova con
 * `curl`. Dentro `v1` si **aggiunge**: non si toglie un campo e non se ne rinomina uno. Un
 * campo che non serve più resta e si documenta come ignorato. Rompere significa `v2`, con
 * `v1` vivo finché esistono installazioni che lo usano.
 */
export default async function memberRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });

		// Solo i soci. Lo staff ha il gestionale e l'endpoint generico: lasciargli anche
		// questa superficie significherebbe due contratti da mantenere per le stesse cose.
		if (utente.ruolo !== 'member') {
			return reply.code(403).send({ error: 'Questa API è riservata al portale soci.' });
		}

		const idSocio = await socioDiAccount(utente.sub);
		if (!idSocio) return reply.code(403).send({ error: 'Account non collegato a un socio.' });

		request.utente = utente;
		request.idSocio = idSocio;
	});

	// --- Chi sono ----------------------------------------------------------------------

	/**
	 * Quello che serve alla schermata iniziale e all'anagrafica, in una richiesta sola.
	 *
	 * `giorni_alla_scadenza` e `in_scadenza` li calcola il server. Oggi quelle soglie vivono
	 * nel browser in due punti diversi — sette giorni in `MemberDashboard`, trenta in
	 * `MemberDocuments` — cioè la stessa politica scritta due volte, in un posto dove nessuno
	 * la cerca. Stando qui è una sola, ed è anche ciò che libera un client mobile dal doversi
	 * portare dietro una libreria di date per rispondere a "scade presto?".
	 */
	fastify.get('/profilo', async (request) => {
		const [socio] = await db.select().from(members).where(eq(members.id, request.idSocio)).limit(1);
		if (!socio) return { socio: null, abbonamento: null, documenti: null };

		const abbonamenti = await db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.memberId, request.idSocio))
			.orderBy(desc(subscriptions.startDate));

		const documenti = await db
			.select({ scadenza: memberDocuments.expiryDate })
			.from(memberDocuments)
			.where(eq(memberDocuments.memberId, request.idSocio));

		const corrente = abbonamenti.find((a) => a.status === 'active') ?? abbonamenti[0] ?? null;

		return {
			socio: {
				id: socio.id,
				nome: socio.fullName,
				codice_socio: socio.codiceSocio,
				email: socio.email,
				telefono: socio.phone,
				data_nascita: socio.dateOfBirth,
			},
			abbonamento: corrente && {
				id: corrente.id,
				piano: corrente.planName,
				stato: corrente.status,
				inizio: corrente.startDate,
				fine: corrente.endDate,
				giorni_alla_scadenza: giorniDaOggi(corrente.endDate),
				in_scadenza: entroGiorni(corrente.endDate, 7),
			},
			documenti: {
				totale: documenti.length,
				in_scadenza: documenti.filter((d) => entroGiorni(d.scadenza, 30) && !scaduto(d.scadenza)).length,
				scaduti: documenti.filter((d) => scaduto(d.scadenza)).length,
			},
		};
	});

	fastify.get('/abbonamenti', async (request) => {
		const righe = await db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.memberId, request.idSocio))
			.orderBy(desc(subscriptions.startDate));

		return {
			abbonamenti: righe.map((a) => ({
				id: a.id,
				piano: a.planName,
				stato: a.status,
				inizio: a.startDate,
				fine: a.endDate,
				giorni_alla_scadenza: giorniDaOggi(a.endDate),
				prezzo_pagato: a.pricePaid,
				ingressi_residui: a.sessionsRemaining,
			})),
		};
	});

	fastify.get('/documenti', async (request) => {
		const righe = await db
			.select()
			.from(memberDocuments)
			.where(eq(memberDocuments.memberId, request.idSocio))
			.orderBy(desc(memberDocuments.createdDate));

		return {
			documenti: righe.map((d) => ({
				id: d.id,
				tipo: d.documentType,
				nome_file: d.fileName,
				url: d.fileUrl,
				scadenza: d.expiryDate,
				giorni_alla_scadenza: giorniDaOggi(d.expiryDate),
				scaduto: scaduto(d.expiryDate),
				in_scadenza: entroGiorni(d.expiryDate, 30) && !scaduto(d.expiryDate),
				caricato_il: d.createdDate,
			})),
		};
	});

	/**
	 * Il codice d'accesso da mostrare alla reception.
	 *
	 * Il codice cambia ogni minuto e lo firma il server con una chiave che non esce da qui.
	 * Il portale prima faceva due richieste — il QR del socio e poi il codice — e questa ne
	 * fa una: davanti al tornello, con la rete della palestra, la differenza si sente.
	 */
	fastify.get('/accesso', async (request) => {
		const [qr] = await db
			.select()
			.from(qrAccessi)
			.where(and(eq(qrAccessi.clienteId, request.idSocio), eq(qrAccessi.stato, 'attivo')))
			.limit(1);

		if (!qr) return { attivo: false, codice: null, valido_per_ms: null };

		return {
			attivo: true,
			codice: codiceDinamico(qr.codice),
			valido_per_ms: msResiduiFinestra(),
		};
	});

	// --- I corsi -----------------------------------------------------------------------

	/**
	 * L'agenda delle lezioni prenotabili, già messa in ordine e già contata.
	 *
	 * Sostituisce sette richieste e il lavoro di incrocio che il browser faceva a mano. Dei
	 * posti escono **numeri**, non le prenotazioni altrui: chi frequenta cosa non è un dato
	 * che il portale di un socio abbia ragione di ricevere.
	 */
	fastify.get('/corsi/agenda', async (request) => {
		const oggi = new Date().toISOString().split('T')[0];
		const dal = request.query.dal ?? oggi;
		const al = request.query.al ?? fraGiorni(dal, 30);

		const righe = await db
			.select({
				sessione: sessions,
				evento: { id: events.id },
				corso: { id: courses.id, nome: courses.name, descrizione: courses.description },
				categoria: { id: categories.id, nome: categories.name, colore: categories.color },
				istruttore: { id: instructors.id, nome: instructors.fullName },
				sala: { id: rooms.id, nome: rooms.name },
			})
			.from(sessions)
			.innerJoin(events, eq(sessions.eventId, events.id))
			.innerJoin(courses, eq(events.courseId, courses.id))
			.leftJoin(categories, eq(courses.categoryId, categories.id))
			.leftJoin(instructors, eq(courses.instructorId, instructors.id))
			.leftJoin(rooms, eq(sessions.roomId, rooms.id))
			.where(and(
				gte(sessions.date, dal),
				lte(sessions.date, al),
				eq(sessions.status, 'active'),
			))
			.orderBy(sessions.date, sessions.startTime);

		const idLezioni = righe.map((r) => r.sessione.id);
		const prenotazioni = idLezioni.length
			? await db
				.select()
				.from(bookings)
				.where(and(inArray(bookings.sessionId, idLezioni), ne(bookings.status, 'cancelled')))
			: [];

		// I conteggi si fanno qui e escono come numeri. Le righe delle prenotazioni non
		// lasciano il server, tranne quella del socio che sta chiedendo.
		const conta = new Map();
		const mie = new Map();
		for (const p of prenotazioni) {
			const c = conta.get(p.sessionId) ?? { confermati: 0, in_attesa: 0 };
			if (p.status === 'confirmed') c.confermati += 1;
			else if (p.status === 'waitlisted') c.in_attesa += 1;
			conta.set(p.sessionId, c);
			if (String(p.memberId) === String(request.idSocio)) mie.set(p.sessionId, p);
		}

		const giorni = new Map();
		for (const r of righe) {
			const s = r.sessione;
			const c = conta.get(s.id) ?? { confermati: 0, in_attesa: 0 };
			const miaPrenotazione = mie.get(s.id);
			const capienza = s.capacity ?? 0;

			const lezione = {
				id: s.id,
				data: s.date,
				inizio: s.startTime,
				fine: s.endTime,
				corso: r.corso,
				categoria: r.categoria?.id ? r.categoria : null,
				istruttore: r.istruttore?.id ? r.istruttore : null,
				sala: r.sala?.id ? r.sala : null,
				posti: {
					capienza,
					confermati: c.confermati,
					liberi: Math.max(0, capienza - c.confermati),
					in_attesa: c.in_attesa,
					al_completo: c.confermati >= capienza,
				},
				mia_prenotazione: miaPrenotazione
					? {
						id: miaPrenotazione.id,
						stato: miaPrenotazione.status,
						posizione_attesa: miaPrenotazione.waitlistPosition,
					}
					: null,
			};

			if (!giorni.has(s.date)) giorni.set(s.date, []);
			giorni.get(s.date).push(lezione);
		}

		return {
			dal,
			al,
			giorni: [...giorni.entries()].map(([data, lezioni]) => ({ data, lezioni })),
		};
	});
}

// --- Le date, contate una volta sola -------------------------------------------------
//
// Tutto in giorni interi sul calendario, senza ore: una scadenza è un giorno, non un
// istante, e confrontare istanti farebbe dire "scade fra 0 giorni" a un abbonamento che
// scade stasera e "fra 1" a uno che scade domani mattina presto.

const GIORNO_MS = 24 * 60 * 60 * 1000;

function aMezzanotte(data) {
	if (!data) return null;
	const d = new Date(`${String(data).split('T')[0]}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? null : d;
}

function giorniDaOggi(data) {
	const quando = aMezzanotte(data);
	if (!quando) return null;
	const oggi = aMezzanotte(new Date().toISOString());
	return Math.round((quando - oggi) / GIORNO_MS);
}

function scaduto(data) {
	const giorni = giorniDaOggi(data);
	return giorni !== null && giorni < 0;
}

function entroGiorni(data, soglia) {
	const giorni = giorniDaOggi(data);
	return giorni !== null && giorni <= soglia;
}

function fraGiorni(dal, quanti) {
	const partenza = aMezzanotte(dal) ?? aMezzanotte(new Date().toISOString());
	return new Date(partenza.getTime() + quanti * GIORNO_MS).toISOString().split('T')[0];
}

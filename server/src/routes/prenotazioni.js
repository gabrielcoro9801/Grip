// Prenotare e disdire una lezione.
//
// Sono rotte dedicate e non l'endpoint generico delle entità perché prenotare **non è
// scrivere una riga**: è decidere se c'è posto, e quella decisione dipende da tutte le
// altre prenotazioni della stessa lezione.
//
// Finora quel conto lo faceva il browser: leggeva le prenotazioni, contava i confermati e
// mandava al server una riga già decisa, con lo stato dentro. Il server la scriveva senza
// guardare. Bastava quindi una richiesta fatta a mano — `status: "confirmed"` su una
// lezione piena — per entrare in una sala al completo, e nessun controllo poteva
// accorgersene: la regola non esisteva da nessuna parte, se non nel codice che si poteva
// scegliere di non eseguire.
//
// C'è anche un motivo che non c'entra con la malafede. Due soci che prenotano l'ultimo
// posto nello stesso istante leggono entrambi "un posto libero" e si confermano entrambi:
// nessuno dei due ha barato, ma la lezione ha un iscritto di troppo. Contare dentro una
// transazione, con la lezione bloccata, è l'unico modo di non far succedere.
import { eq, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, sessions } from '../db/schema/index.js';
import { translateManyToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity, canReadEntity } from '../auth/authorize.js';
import { socioDiAccount } from '../auth/socioCorrente.js';
import { prenota, disdici } from '../lib/prenotazioni.js';
import { registra } from '../lib/registro.js';

export default async function prenotazioniRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });

		// La lettura è dello staff, con il permesso di lettura delle prenotazioni: il socio le
		// sue le chiede al portale (routes/member).
		if (request.method === 'GET') {
			if (utente.ruolo === 'member' || !canReadEntity(utente.ruolo, 'Booking')) {
				return reply.code(403).send({ error: 'Non consentito.' });
			}
		} else if (utente.ruolo === 'member') {
			// Il socio collegato si rilegge dal database e non dal token, così togliere il
			// collegamento ha effetto subito.
			const memberId = await socioDiAccount(utente.sub);
			if (!memberId) return reply.code(403).send({ error: 'Account non collegato a un socio.' });
			request.memberId = memberId;
		} else if (!canWriteEntity(utente.ruolo, 'Booking')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}
		request.utente = utente;
	});

	/**
	 * GET /api/prenotazioni?dal=YYYY-MM-DD — le prenotazioni delle lezioni da quel giorno in poi.
	 *
	 * Il calendario del gestionale chiedeva "le ultime 500 prenotazioni create": oltre quella
	 * soglia sparivano dai conteggi dei posti, in silenzio. Filtrare per data di creazione non
	 * basterebbe — "Prenota tutte" prenota con mesi d'anticipo — quindi si filtra sulla data
	 * della lezione, che sta in un'altra tabella: per questo non passa dall'endpoint generico.
	 */
	fastify.get('/api/prenotazioni', async (request, reply) => {
		const dal = String(request.query?.dal ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dal)) return reply.code(400).send({ error: 'Indica da che giorno (dal=AAAA-MM-GG).' });
		const righe = await db
			.select({ prenotazione: bookings })
			.from(bookings)
			.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
			.where(gte(sessions.date, dal));
		return translateManyToSnakeCase(bookings, righe.map((r) => r.prenotazione));
	});

	/**
	 * Prenota una lezione.
	 *
	 * Lo stato non si accetta da chi chiede: lo decide il conto dei posti. Un client che
	 * manda `confirmed` su una lezione piena si ritrova in lista d'attesa, che è la
	 * risposta giusta — non un errore, semplicemente la verità.
	 */
	fastify.post('/api/prenotazioni', async (request, reply) => {
		const sessionId = request.body?.session_id;
		if (!sessionId) return reply.code(400).send({ error: 'Manca la lezione da prenotare.' });

		// Un socio prenota per sé e basta; lo staff può prenotare per qualcuno.
		const memberId = request.memberId ?? request.body?.member_id;
		if (!memberId) return reply.code(400).send({ error: 'Manca il socio.' });

		try {
			const esito = await prenota({ sessionId, memberId });

			if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
			await registra(request.utente, {
				tipoAzione: 'create', entitaTipo: 'booking', entitaNome: esito.creata.memberName, entitaId: esito.creata.id,
				dettagli: esito.creata.status === 'waitlisted' ? "In lista d'attesa" : 'Confermata',
			}, request.log);
			reply.code(201);
			return {
				booking: {
					id: esito.creata.id,
					session_id: esito.creata.sessionId,
					member_id: esito.creata.memberId,
					member_name: esito.creata.memberName,
					status: esito.creata.status,
					waitlist_position: esito.creata.waitlistPosition,
				},
			};
		} catch (errore) {
			request.log.error(errore, 'prenotazione fallita');
			return reply.code(500).send({ error: 'Non è stato possibile prenotare.' });
		}
	});

	/**
	 * Disdice una prenotazione, e sistema la lista d'attesa.
	 *
	 * Promuovere e rinumerare erano tre chiamate separate dal browser: se la seconda
	 * falliva — ed è successo, perché chiamava un metodo che non esiste — restava una
	 * disdetta fatta a metà, con le posizioni sfalsate per sempre. Qui è una transazione:
	 * o succede tutto, o non succede niente.
	 */
	fastify.post('/api/prenotazioni/:id/disdici', async (request, reply) => {
		try {
			const esito = await disdici({ bookingId: request.params.id, soloDelSocio: request.memberId ?? null });

			if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
			await registra(request.utente, {
				tipoAzione: 'delete', entitaTipo: 'booking', entitaId: request.params.id, dettagli: 'Prenotazione disdetta',
			}, request.log);
			return {
				promoted: Boolean(esito.promossa),
				promosso: esito.promossa
					? { id: esito.promossa.id, member_id: esito.promossa.memberId, member_name: esito.promossa.memberName }
					: null,
			};
		} catch (errore) {
			request.log.error(errore, 'disdetta fallita');
			return reply.code(500).send({ error: 'Non è stato possibile disdire.' });
		}
	});
}

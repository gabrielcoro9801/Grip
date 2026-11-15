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
//
// Sono rotte dello **staff**. Il socio prenota e disdice dal portale (`/api/member/v1`), che usa
// le stesse funzioni: un contratto solo per lui (docs/piani/portale.md, D-3), e qui riceve 403.
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity, canReadEntity } from '../auth/authorize.js';
import { prenota, disdici, cambiaStato, spostaInLista, eliminaPrenotazione } from '../lib/prenotazioni.js';
import { registra } from '../lib/registro.js';
import { ristrettoAi, istruttoreDi } from '../auth/suoi.js';

export default async function prenotazioniRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });

		// Il socio passa dal portale: qui niente, né lettura né scrittura.
		if (utente.ruolo === 'member') return reply.code(403).send({ error: 'Il socio prenota dal portale.' });
		if (request.method === 'GET') {
			if (!canReadEntity(utente.ruolo, 'Booking')) return reply.code(403).send({ error: 'Non consentito.' });
		} else if (!canWriteEntity(utente.ruolo, 'Booking')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}
		request.utente = utente;
		// Chi è limitato ai suoi corsi prenota e disdice solo alle lezioni dei corsi che tiene.
		if (request.method !== 'GET' && ristrettoAi(utente, 'prenotazioni')) {
			const suo = request.params.id ? await istruttoreDi('Booking', request.params.id) : await istruttoreDi('Session', request.body?.session_id);
			if (suo !== String(utente.sub)) return reply.code(403).send({ error: 'Puoi gestire solo le prenotazioni dei corsi di cui sei istruttore.' });
		}
	});

	/**
	 * Prenota una lezione per un socio.
	 *
	 * Lo stato non si accetta da chi chiede: lo decide il conto dei posti. Un client che
	 * manda `confirmed` su una lezione piena si ritrova in lista d'attesa, che è la
	 * risposta giusta — non un errore, semplicemente la verità.
	 */
	fastify.post('/api/prenotazioni', async (request, reply) => {
		const sessionId = request.body?.session_id;
		if (!sessionId) return reply.code(400).send({ error: 'Manca la lezione da prenotare.' });

		const memberId = request.body?.member_id;
		if (!memberId) return reply.code(400).send({ error: 'Manca il socio.' });

		try {
			const esito = await prenota({ sessionId, memberId });

			if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio, code: esito.codice });
			await registra(request.utente, {
				tipoAzione: esito.daListaAttesa ? 'update' : 'create', entitaTipo: 'booking', entitaNome: esito.creata.memberName, entitaId: esito.creata.id,
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
	 * Disdice una prenotazione, e sistema la lista d'attesa: il posto liberato si offre al primo
	 * in lista (lib/prenotazioni.js, `regolaOfferte`). → { offerto: { id, member_id, member_name } | null }
	 */
	fastify.post('/api/prenotazioni/:id/disdici', async (request, reply) => {
		try {
			const esito = await disdici({ bookingId: request.params.id });

			if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
			await registra(request.utente, {
				tipoAzione: 'delete', entitaTipo: 'booking', entitaId: request.params.id, dettagli: 'Prenotazione disdetta',
			}, request.log);
			return {
				offerto: esito.offerta
					? { id: esito.offerta.id, member_id: esito.offerta.memberId, member_name: esito.offerta.memberName }
					: null,
			};
		} catch (errore) {
			request.log.error(errore, 'disdetta fallita');
			return reply.code(500).send({ error: 'Non è stato possibile disdire.' });
		}
	});

	// --- Il resto del lavoro della reception ------------------------------------------------
	//
	// Confermare, rimettere in lista, riattivare, riordinare la lista, cancellare un errore.
	// `offerti`: a chi è andato, come offerta di 12 ore, un posto liberato dal cambio.

	const ETICHETTE_STATO = { confirmed: 'Confermata', waitlisted: "In lista d'attesa", cancelled: 'Annullata' };
	const versoApi = (b) => b && ({
		id: b.id, session_id: b.sessionId, member_id: b.memberId, member_name: b.memberName,
		status: b.status, waitlist_position: b.waitlistPosition,
	});

	/** POST /api/prenotazioni/:id/stato { stato, oltre_capienza } → { booking, offerti } */
	fastify.post('/api/prenotazioni/:id/stato', async (request, reply) => {
		const stato = request.body?.stato;
		const esito = await cambiaStato({ bookingId: request.params.id, stato, oltreCapienza: request.body?.oltre_capienza === true });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio, code: esito.codice });
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'booking', entitaId: request.params.id,
			entitaNome: esito.aggiornata?.memberName ?? '', dettagli: `Stato: ${ETICHETTE_STATO[stato] ?? stato}${request.body?.oltre_capienza ? ' (oltre la capienza)' : ''}`,
		}, request.log);
		return {
			booking: versoApi(esito.aggiornata) ?? null,
			offerti: (esito.offerte ?? (esito.offerta ? [esito.offerta] : [])).map((b) => ({ id: b.id, member_name: b.memberName })),
		};
	});

	/** POST /api/prenotazioni/:id/posizione { posizione } → { posizione } */
	fastify.post('/api/prenotazioni/:id/posizione', async (request, reply) => {
		const esito = await spostaInLista({ bookingId: request.params.id, posizione: request.body?.posizione });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'booking', entitaId: request.params.id, dettagli: `Lista d'attesa: posizione ${esito.posizione}`,
		}, request.log);
		return esito;
	});

	/** DELETE /api/prenotazioni/:id → { eliminata: true, offerti } — per le prenotazioni inserite per errore. */
	fastify.delete('/api/prenotazioni/:id', async (request, reply) => {
		const esito = await eliminaPrenotazione({ bookingId: request.params.id });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'delete', entitaTipo: 'booking', entitaId: request.params.id,
			entitaNome: esito.eliminata.memberName ?? '', dettagli: 'Prenotazione eliminata',
		}, request.log);
		return { eliminata: true, offerti: esito.offerte.map((b) => ({ id: b.id, member_name: b.memberName })) };
	});
}

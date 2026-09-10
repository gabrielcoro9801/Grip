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
import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, sessions, members, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';

export default async function prenotazioniRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });

		if (utente.ruolo === 'member') {
			// Il socio collegato si rilegge dal database e non dal token, così togliere il
			// collegamento ha effetto subito.
			const [account] = await db
				.select({ memberId: staffAccounts.linkedMemberId })
				.from(staffAccounts)
				.where(eq(staffAccounts.id, utente.sub))
				.limit(1);
			if (!account?.memberId) return reply.code(403).send({ error: 'Account non collegato a un socio.' });
			request.memberId = account.memberId;
		} else if (!canWriteEntity(utente.ruolo, 'Booking')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}
		request.utente = utente;
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
			const esito = await db.transaction(async (tx) => {
				// `FOR UPDATE` sulla lezione: due richieste sull'ultimo posto si mettono in
				// fila invece di contare le stesse prenotazioni e confermarsi a vicenda.
				const [lezione] = await tx
					.select()
					.from(sessions)
					.where(eq(sessions.id, sessionId))
					.limit(1)
					.for('update');
				if (!lezione) return { errore: 404, messaggio: 'Lezione inesistente.' };
				if (lezione.status !== 'active') return { errore: 400, messaggio: 'La lezione è stata annullata.' };

				const oggi = new Date().toISOString().split('T')[0];
				if (String(lezione.date) < oggi) {
					return { errore: 400, messaggio: 'La lezione è già passata.' };
				}

				const [gia] = await tx
					.select({ id: bookings.id })
					.from(bookings)
					.where(and(
						eq(bookings.sessionId, sessionId),
						eq(bookings.memberId, memberId),
						ne(bookings.status, 'cancelled'),
					))
					.limit(1);
				if (gia) return { errore: 409, messaggio: 'Hai già una prenotazione per questa lezione.' };

				const [{ confermate, inAttesa }] = await tx
					.select({
						confermate: sql`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number),
						inAttesa: sql`count(*) filter (where ${bookings.status} = 'waitlisted')`.mapWith(Number),
					})
					.from(bookings)
					.where(eq(bookings.sessionId, sessionId));

				const [socio] = await tx
					.select({ nome: members.fullName })
					.from(members)
					.where(eq(members.id, memberId))
					.limit(1);
				if (!socio) return { errore: 404, messaggio: 'Socio inesistente.' };

				const pieno = confermate >= (lezione.capacity ?? 0);
				const [creata] = await tx
					.insert(bookings)
					.values({
						sessionId,
						memberId,
						memberName: socio.nome,
						status: pieno ? 'waitlisted' : 'confirmed',
						waitlistPosition: pieno ? inAttesa + 1 : null,
					})
					.returning();
				return { creata };
			});

			if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
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
			const esito = await db.transaction(async (tx) => {
				const [prenotazione] = await tx
					.select()
					.from(bookings)
					.where(eq(bookings.id, request.params.id))
					.limit(1)
					.for('update');
				if (!prenotazione) return { errore: 404, messaggio: 'Prenotazione inesistente.' };

				// Un socio disdice le proprie. "Non trovata" e non "vietato": a chi non deve
				// vederla non si conferma nemmeno che esista.
				if (request.memberId && String(prenotazione.memberId) !== String(request.memberId)) {
					return { errore: 404, messaggio: 'Prenotazione inesistente.' };
				}
				if (prenotazione.status === 'cancelled') return { promossa: null };

				await tx
					.update(bookings)
					.set({ status: 'cancelled', waitlistPosition: null })
					.where(eq(bookings.id, prenotazione.id));

				// Solo una disdetta confermata libera un posto: chi era in lista d'attesa e
				// rinuncia non promuove nessuno, sposta solo la coda.
				const eraConfermata = prenotazione.status === 'confirmed';

				const coda = await tx
					.select()
					.from(bookings)
					.where(and(eq(bookings.sessionId, prenotazione.sessionId), eq(bookings.status, 'waitlisted')))
					.orderBy(bookings.waitlistPosition, bookings.createdDate);

				let promossa = null;
				let daRinumerare = coda;
				if (eraConfermata && coda.length > 0) {
					promossa = coda[0];
					await tx
						.update(bookings)
						.set({ status: 'confirmed', waitlistPosition: null })
						.where(eq(bookings.id, promossa.id));
					daRinumerare = coda.slice(1);
				}

				for (const [indice, riga] of daRinumerare.entries()) {
					if (riga.waitlistPosition === indice + 1) continue;
					await tx.update(bookings).set({ waitlistPosition: indice + 1 }).where(eq(bookings.id, riga.id));
				}

				return { promossa };
			});

			if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
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

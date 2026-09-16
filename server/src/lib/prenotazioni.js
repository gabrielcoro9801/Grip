import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, sessions, members, leads } from '../db/schema/index.js';

/**
 * Prenotare e disdire: le due regole, in un posto solo.
 *
 * Stanno qui e non dentro una rotta perché adesso di rotte ce ne sono due — quella storica
 * `/api/prenotazioni`, che usa anche lo staff, e quella del portale sotto
 * `/api/member/v1`. Copiare la transazione avrebbe significato due copie di una regola che
 * decide chi entra in una sala piena: prima o poi una delle due cambia, l'altra no, e il
 * sintomo è un iscritto di troppo a una lezione.
 *
 * Le funzioni non sanno niente di HTTP. Restituiscono un esito — `{ errore, messaggio }`
 * oppure il risultato — e sono le rotte a tradurlo in codici di stato.
 */

/**
 * Prenota una lezione.
 *
 * Lo stato non si accetta da chi chiede: lo decide il conto dei posti. Un client che manda
 * `confirmed` su una lezione piena si ritrova in lista d'attesa, che è la risposta giusta —
 * non un errore, semplicemente la verità.
 *
 * Prenota un socio (`memberId`) oppure un lead che viene a provare (`leadId`), mai entrambi.
 * La prova passa di qui e non da una funzione sua perché occupa un posto vero: con due
 * funzioni, un giorno una delle due conterebbe i posti in un altro modo.
 *
 * `tx` permette di prenotare dentro una transazione già aperta — quella che, prenotando una
 * prova, cambia anche lo stato del lead e ne scrive la cronologia.
 */
export async function prenota({ sessionId, memberId = null, leadId = null }, tx = null) {
	if (Boolean(memberId) === Boolean(leadId)) {
		return { errore: 400, messaggio: 'Indicare chi prenota: un socio oppure un lead.' };
	}
	return tx ? prenotaIn(tx, { sessionId, memberId, leadId }) : db.transaction((t) => prenotaIn(t, { sessionId, memberId, leadId }));
}

async function prenotaIn(tx, { sessionId, memberId, leadId }) {
	// `FOR UPDATE` sulla lezione: due richieste sull'ultimo posto si mettono in fila
	// invece di contare le stesse prenotazioni e confermarsi a vicenda.
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
			memberId ? eq(bookings.memberId, memberId) : eq(bookings.leadId, leadId),
			ne(bookings.status, 'cancelled'),
		))
		.limit(1);
	if (gia) {
		return {
			errore: 409,
			messaggio: memberId ? 'Hai già una prenotazione per questa lezione.' : 'Questa persona ha già una prova in questa lezione.',
		};
	}

	const [{ confermate, inAttesa }] = await tx
		.select({
			confermate: sql`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number),
			inAttesa: sql`count(*) filter (where ${bookings.status} = 'waitlisted')`.mapWith(Number),
		})
		.from(bookings)
		.where(eq(bookings.sessionId, sessionId));

	const [intestatario] = memberId
		? await tx.select({ nome: members.fullName }).from(members).where(eq(members.id, memberId)).limit(1)
		: await tx.select({ nome: leads.fullName }).from(leads).where(eq(leads.id, leadId)).limit(1);
	if (!intestatario) return { errore: 404, messaggio: memberId ? 'Socio inesistente.' : 'Lead inesistente.' };

	const pieno = confermate >= (lezione.capacity ?? 0);
	const [creata] = await tx
		.insert(bookings)
		.values({
			sessionId,
			memberId,
			leadId,
			memberName: intestatario.nome,
			status: pieno ? 'waitlisted' : 'confirmed',
			waitlistPosition: pieno ? inAttesa + 1 : null,
		})
		.returning();
	return { creata, lezione };
}

/**
 * Disdice una prenotazione, e sistema la lista d'attesa.
 *
 * Promuovere e rinumerare erano tre chiamate separate dal browser: se la seconda falliva —
 * ed è successo, perché chiamava un metodo che non esiste — restava una disdetta fatta a
 * metà, con le posizioni sfalsate per sempre. Qui è una transazione: o succede tutto, o non
 * succede niente.
 *
 * `soloDelSocio`, quando c'è, limita l'operazione alle prenotazioni di quel socio.
 *
 * `tx`, come per `prenota`: disdire la prova di un lead ne cambia anche lo stato, e le due
 * cose devono stare nella stessa transazione.
 */
export async function disdici(richiesta, tx = null) {
	return tx ? disdiciIn(tx, richiesta) : db.transaction((t) => disdiciIn(t, richiesta));
}

async function disdiciIn(tx, { bookingId, soloDelSocio = null }) {
	const [prenotazione] = await tx
		.select()
		.from(bookings)
		.where(eq(bookings.id, bookingId))
		.limit(1)
		.for('update');
	if (!prenotazione) return { errore: 404, messaggio: 'Prenotazione inesistente.' };

	// Un socio disdice le proprie. "Non trovata" e non "vietato": a chi non deve vederla
	// non si conferma nemmeno che esista.
	if (soloDelSocio && String(prenotazione.memberId) !== String(soloDelSocio)) {
		return { errore: 404, messaggio: 'Prenotazione inesistente.' };
	}
	if (prenotazione.status === 'cancelled') return { promossa: null };

	await tx
		.update(bookings)
		.set({ status: 'cancelled', waitlistPosition: null })
		.where(eq(bookings.id, prenotazione.id));

	// Solo una disdetta confermata libera un posto: chi era in lista d'attesa e rinuncia
	// non promuove nessuno, sposta solo la coda.
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
}

import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, sessions, members, subscriptions } from '../db/schema/index.js';
import { abbonamentoCopre, MESSAGGIO_SENZA_ABBONAMENTO } from '../../../shared/abbonamenti.js';
import { lezioneFinita } from '../../../shared/giorni.js';

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
 */
export async function prenota({ sessionId, memberId }) {
	return db.transaction(async (tx) => {
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

		// Oggi a Roma, non in UTC: fra mezzanotte e le due la data UTC è ancora ieri. E non solo
		// la data: una lezione di stamattina, finita, si prenotava fino a mezzanotte.
		if (lezioneFinita(lezione)) {
			return { errore: 400, messaggio: 'La lezione è già passata.' };
		}

		const [socio] = await tx
			.select({ nome: members.fullName, archiviatoIl: members.archiviatoIl })
			.from(members)
			.where(eq(members.id, memberId))
			.limit(1);
		if (!socio) return { errore: 404, messaggio: 'Socio inesistente.' };
		// Chi ha lasciato la palestra non prenota, da nessuna delle due rotte.
		if (socio.archiviatoIl) return { errore: 400, messaggio: 'Il socio è archiviato: riattivalo dalla sua scheda per prenotare.' };

		// Senza un abbonamento che copra il giorno della lezione non si prenota: dal portale come
		// dalla reception, perché la regola sta qui e non nei pulsanti.
		const iscrizioni = await tx
			.select({ start_date: subscriptions.startDate, end_date: subscriptions.endDate })
			.from(subscriptions)
			.where(eq(subscriptions.memberId, memberId));
		if (!abbonamentoCopre(iscrizioni, lezione.date)) {
			return { errore: 400, messaggio: MESSAGGIO_SENZA_ABBONAMENTO };
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
 */
export async function disdici({ bookingId, soloDelSocio = null }) {
	return db.transaction(async (tx) => {
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

		// Una lezione finita non si disdice: la prenotazione è storia, e disdirla avrebbe anche
		// promosso qualcuno dalla lista d'attesa a una lezione che non c'è più.
		const [lezione] = await tx.select().from(sessions).where(eq(sessions.id, prenotazione.sessionId)).limit(1);
		if (lezione && lezioneFinita(lezione)) {
			return { errore: 400, messaggio: 'La lezione è già finita: la prenotazione non si disdice più.' };
		}

		await tx
			.update(bookings)
			.set({ status: 'cancelled', waitlistPosition: null })
			.where(eq(bookings.id, prenotazione.id));

		// Solo una disdetta confermata libera un posto: chi era in lista d'attesa e rinuncia
		// non promuove nessuno, sposta solo la coda. Il conto dei posti lo fa la stessa regola
		// che vale quando cresce la capienza.
		const promosse = await promuoviFinoACapienza(tx, prenotazione.sessionId);
		return { promossa: promosse[0] ?? null };
	});
}

/**
 * Riempie i posti liberi di una lezione con la lista d'attesa, in ordine, e rinumera la coda.
 *
 * Serve ovunque i posti liberi possano crescere: una disdetta confermata, ma anche una
 * capienza portata da 10 a 15. Prima la promozione esisteva solo nella disdetta, e chi era in
 * lista d'attesa restava lì con cinque posti vuoti davanti.
 *
 * Va chiamata dentro una transazione: blocca la lezione come fa `prenota`, così una
 * prenotazione che arriva nello stesso istante non conta gli stessi posti.
 *
 * @returns le prenotazioni promosse, in ordine.
 */
export async function promuoviFinoACapienza(tx, sessionId) {
	const [lezione] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1).for('update');
	if (!lezione) return [];

	const [{ confermate }] = await tx
		.select({ confermate: sql`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number) })
		.from(bookings)
		.where(eq(bookings.sessionId, sessionId));

	const coda = await tx
		.select()
		.from(bookings)
		.where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, 'waitlisted')))
		.orderBy(bookings.waitlistPosition, bookings.createdDate);

	const liberi = Math.max(0, (lezione.capacity ?? 0) - confermate);
	const promosse = coda.slice(0, liberi);
	for (const riga of promosse) {
		await tx.update(bookings).set({ status: 'confirmed', waitlistPosition: null }).where(eq(bookings.id, riga.id));
	}

	for (const [indice, riga] of coda.slice(liberi).entries()) {
		if (riga.waitlistPosition === indice + 1) continue;
		await tx.update(bookings).set({ waitlistPosition: indice + 1 }).where(eq(bookings.id, riga.id));
	}
	return promosse;
}

import { eq, and, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, sessions, members, events, courses } from '../db/schema/index.js';
import { motivoSenzaCopertura } from '../../../shared/abbonamenti.js';
import { iscrizioniDelSocio } from './iscrizioni.js';
import { lezioneFinita } from '../../../shared/giorni.js';
import { motivoDisdettaChiusa } from '../../../shared/corsi.js';

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
 * Perché quel socio non può avere una prenotazione viva su quella lezione, o null.
 *
 * È la stessa regola per una prenotazione nuova e per una annullata che lo staff riattiva:
 * lezione attiva e non ancora finita, socio non archiviato, abbonamento valido quel giorno,
 * nessun'altra prenotazione viva sulla stessa lezione.
 *
 * @param escludi l'id della prenotazione che si sta riattivando, che non conta come doppione.
 */
async function motivoNonPrenotabile(tx, lezione, memberId, { escludi = null } = {}) {
	if (lezione.status !== 'active') return { errore: 400, messaggio: 'La lezione è stata annullata.' };

	// Oggi a Roma, non in UTC: fra mezzanotte e le due la data UTC è ancora ieri. E non solo
	// la data: una lezione di stamattina, finita, si prenotava fino a mezzanotte.
	if (lezioneFinita(lezione)) return { errore: 400, messaggio: 'La lezione è già passata.' };

	const socio = await socioDi(tx, memberId);
	if (!socio) return { errore: 404, messaggio: 'Socio inesistente.' };
	// Chi ha lasciato la palestra non prenota, da nessuna delle due rotte.
	if (socio.archiviatoIl) return { errore: 400, messaggio: 'Il socio è archiviato: riattivalo dalla sua scheda per prenotare.' };

	// Senza un abbonamento che copra il giorno della lezione non si prenota: dal portale come
	// dalla reception, perché la regola sta qui e non nei pulsanti. Nemmeno in un giorno sospeso.
	const senza = motivoSenzaCopertura(await iscrizioniDelSocio(memberId, tx), lezione.date);
	if (senza) return { errore: 400, messaggio: senza };

	const [gia] = await tx
		.select({ id: bookings.id })
		.from(bookings)
		.where(and(
			eq(bookings.sessionId, lezione.id),
			eq(bookings.memberId, memberId),
			ne(bookings.status, 'cancelled'),
			...(escludi ? [ne(bookings.id, escludi)] : []),
		))
		.limit(1);
	if (gia) return { errore: 409, messaggio: "C'è già una prenotazione per questa lezione." };
	return null;
}

async function socioDi(tx, memberId) {
	const [socio] = await tx
		.select({ nome: members.fullName, archiviatoIl: members.archiviatoIl })
		.from(members)
		.where(eq(members.id, memberId))
		.limit(1);
	return socio ?? null;
}

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

		const rifiuto = await motivoNonPrenotabile(tx, lezione, memberId);
		if (rifiuto) return rifiuto;
		const socio = await socioDi(tx, memberId);

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
		// Il termine di disdetta del corso vale per il socio che disdice da sé: la reception, che
		// risponde al telefono e conosce il motivo, può sempre.
		if (soloDelSocio && lezione) {
			const [corso] = await tx
				.select({ ore: courses.disdettaEntroOre })
				.from(events)
				.innerJoin(courses, eq(events.courseId, courses.id))
				.where(eq(events.id, lezione.eventId))
				.limit(1);
			const motivo = motivoDisdettaChiusa(lezione, corso?.ore);
			if (motivo) return { errore: 400, messaggio: motivo };
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

// --- Il lavoro della reception sulle prenotazioni -----------------------------------------
//
// Il socio prenota e disdice. Lo staff deve poter fare anche il resto: confermare qualcuno che
// era in lista d'attesa, rimetterlo in lista, riattivare una prenotazione disdetta per sbaglio,
// cambiare l'ordine della lista, cancellare una prenotazione inserita per errore. Tutto dentro
// una transazione con la lezione bloccata, come prenotare: sono decisioni sui posti, e due
// operatori sulla stessa lezione non devono contare gli stessi posti.
//
// Il portale non ha niente da sapere: legge le stesse righe, e quello che fa la reception lo
// vede il socio alla prossima apertura.

const STATI_PRENOTAZIONE = ['confirmed', 'waitlisted', 'cancelled'];

/** La prenotazione e la sua lezione, bloccate tutte e due. */
async function prenotazioneBloccata(tx, bookingId) {
	const [prenotazione] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1).for('update');
	if (!prenotazione) return { errore: { errore: 404, messaggio: 'Prenotazione inesistente.' } };
	const [lezione] = await tx.select().from(sessions).where(eq(sessions.id, prenotazione.sessionId)).limit(1).for('update');
	if (lezione && lezioneFinita(lezione)) {
		return { errore: { errore: 400, messaggio: 'La lezione è già finita: le sue prenotazioni non si cambiano più.' } };
	}
	return { prenotazione, lezione };
}

/**
 * Porta una prenotazione a un altro stato.
 *
 * - Confermata: da lista d'attesa o da annullata. Se la lezione è piena si rifiuta, a meno che
 *   la reception dica esplicitamente di andare oltre la capienza (`oltreCapienza`).
 * - In lista d'attesa: in coda alla lista.
 * - Annullata: è una disdetta, con la lista d'attesa che avanza.
 *
 * Una prenotazione annullata che torna viva passa dalle stesse regole di una nuova: socio non
 * archiviato, abbonamento valido quel giorno, nessun doppione.
 *
 * Dopo ogni cambio la lista d'attesa si rinumera, e se si sono liberati posti avanza da sola.
 */
export async function cambiaStato({ bookingId, stato, oltreCapienza = false }) {
	if (!STATI_PRENOTAZIONE.includes(stato)) return { errore: 400, messaggio: 'Stato non valido: confermata, in lista d\'attesa o annullata.' };
	if (stato === 'cancelled') return disdici({ bookingId });

	return db.transaction(async (tx) => {
		const { prenotazione, lezione, errore } = await prenotazioneBloccata(tx, bookingId);
		if (errore) return errore;
		if (prenotazione.status === stato) return { aggiornata: prenotazione, promosse: [] };

		if (prenotazione.status === 'cancelled') {
			const rifiuto = await motivoNonPrenotabile(tx, lezione, prenotazione.memberId, { escludi: prenotazione.id });
			if (rifiuto) return rifiuto;
		}

		const [{ confermate, inAttesa }] = await tx
			.select({
				confermate: sql`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.id} <> ${prenotazione.id})`.mapWith(Number),
				inAttesa: sql`count(*) filter (where ${bookings.status} = 'waitlisted' and ${bookings.id} <> ${prenotazione.id})`.mapWith(Number),
			})
			.from(bookings)
			.where(eq(bookings.sessionId, prenotazione.sessionId));

		if (stato === 'confirmed' && confermate >= (lezione.capacity ?? 0) && !oltreCapienza) {
			return {
				errore: 409,
				codice: 'lezione_piena',
				messaggio: `La lezione è al completo (${confermate} su ${lezione.capacity ?? 0}). Confermando si va oltre la capienza.`,
			};
		}

		const [aggiornata] = await tx
			.update(bookings)
			.set(stato === 'confirmed'
				? { status: 'confirmed', waitlistPosition: null }
				: { status: 'waitlisted', waitlistPosition: inAttesa + 1 })
			.where(eq(bookings.id, prenotazione.id))
			.returning();

		const promosse = await promuoviFinoACapienza(tx, prenotazione.sessionId);
		const [finale] = await tx.select().from(bookings).where(eq(bookings.id, prenotazione.id)).limit(1);
		return { aggiornata: finale ?? aggiornata, promosse: promosse.filter((p) => p.id !== prenotazione.id) };
	});
}

/**
 * Sposta una prenotazione in lista d'attesa alla posizione indicata (1 = la prima), e rinumera
 * le altre. Serve quando la reception decide un ordine diverso da quello di arrivo.
 */
export async function spostaInLista({ bookingId, posizione }) {
	return db.transaction(async (tx) => {
		const { prenotazione, errore } = await prenotazioneBloccata(tx, bookingId);
		if (errore) return errore;
		if (prenotazione.status !== 'waitlisted') return { errore: 400, messaggio: "La prenotazione non è in lista d'attesa." };

		const coda = await tx
			.select()
			.from(bookings)
			.where(and(eq(bookings.sessionId, prenotazione.sessionId), eq(bookings.status, 'waitlisted')))
			.orderBy(bookings.waitlistPosition, bookings.createdDate);
		const altri = coda.filter((b) => b.id !== prenotazione.id);
		const indice = Math.min(Math.max(Number.parseInt(posizione, 10) || 1, 1), coda.length) - 1;
		altri.splice(indice, 0, prenotazione);
		for (const [i, riga] of altri.entries()) {
			if (riga.waitlistPosition !== i + 1) {
				await tx.update(bookings).set({ waitlistPosition: i + 1 }).where(eq(bookings.id, riga.id));
			}
		}
		return { posizione: indice + 1 };
	});
}

/**
 * Cancella una prenotazione, per davvero: per quelle inserite per errore, che non devono
 * restare nello storico come disdette. Se occupava un posto, la lista d'attesa avanza.
 */
export async function eliminaPrenotazione({ bookingId }) {
	return db.transaction(async (tx) => {
		const { prenotazione, errore } = await prenotazioneBloccata(tx, bookingId);
		if (errore) return errore;
		await tx.delete(bookings).where(eq(bookings.id, prenotazione.id));
		const promosse = await promuoviFinoACapienza(tx, prenotazione.sessionId);
		return { eliminata: prenotazione, promosse };
	});
}

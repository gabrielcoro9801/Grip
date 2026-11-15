import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { bookings, sessions, members, events, courses } from '../db/schema/index.js';
import { motivoSenzaCopertura } from '../../../shared/abbonamenti.js';
import { iscrizioniDelSocio } from './iscrizioni.js';
import { lezioneFinita, oggiIso, oraIso } from '../../../shared/giorni.js';
import { motivoDisdettaChiusa, chiusuraLista, ORE_OFFERTA_POSTO, MARGINE_RIPENSAMENTO_MINUTI } from '../../../shared/corsi.js';
import { notifica, giornoEsteso } from './notifiche.js';

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
 * La lezione bloccata (`FOR UPDATE`), con il nome e il termine di disdetta del suo corso: due
 * richieste sull'ultimo posto si mettono in fila invece di contare le stesse prenotazioni.
 */
async function lezioneBloccata(tx, sessionId) {
	const [lezione] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1).for('update');
	if (!lezione) return null;
	const [corso] = await tx
		.select({ nome: courses.name, ore: courses.disdettaEntroOre })
		.from(events)
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(eq(events.id, lezione.eventId))
		.limit(1);
	return { ...lezione, corso: corso ?? { nome: 'la lezione', ore: null } };
}

/** Vera se la prenotazione ha un posto offerto ancora aperto in quell'istante. */
const conOfferta = (b, adesso) => b.status === 'waitlisted' && b.postoOffertoFinoA && new Date(b.postoOffertoFinoA) > adesso;

/** "lunedì 12 ottobre alle 16:30", o "oggi alle 16:30", di un istante. */
function quando(istante, adesso) {
	const giorno = oggiIso(istante);
	return `${giorno === oggiIso(adesso) ? 'oggi' : giornoEsteso(giorno)} alle ${oraIso(istante)}`;
}

/**
 * Prenota una lezione.
 *
 * Lo stato non si accetta da chi chiede: lo decide il conto dei posti. Un client che manda
 * `confirmed` su una lezione piena si ritrova in lista d'attesa, che è la risposta giusta —
 * non un errore, semplicemente la verità.
 *
 * I posti occupati sono i confermati più quelli **offerti** e non ancora scaduti (vedi
 * `regolaOfferte`). Chi è già in lista e prenota di nuovo:
 * - con un posto offerto, lo conferma;
 * - dopo la chiusura della lista, con un posto libero, lo prende (il posto è di chi lo prende).
 * Dopo la chiusura, su una lezione piena, non si entra più in lista.
 *
 * `prenotazioneFissaId`: la fissa che prenota (lib/prenotazioniFisse.js). Resta sulla
 * prenotazione, così cancellando la fissa si disdicono solo le sue.
 *
 * @returns { creata } (la prenotazione, nuova o appena confermata) o { errore, messaggio }
 */
export async function prenota({ sessionId, memberId, prenotazioneFissaId = null, adesso = new Date() }) {
	return db.transaction(async (tx) => {
		const lezione = await lezioneBloccata(tx, sessionId);
		if (!lezione) return { errore: 404, messaggio: 'Lezione inesistente.' };
		await regolaOfferte(tx, sessionId, adesso);

		const righe = await tx.select().from(bookings).where(and(eq(bookings.sessionId, sessionId), ne(bookings.status, 'cancelled')));
		const capienza = lezione.capacity ?? 0;
		const chiusa = adesso >= chiusuraLista(lezione, lezione.corso.ore);
		const mia = righe.find((b) => String(b.memberId) === String(memberId));
		const occupati = (escludi) => righe.filter((b) => b !== escludi && (b.status === 'confirmed' || conOfferta(b, adesso))).length;

		if (mia) {
			const prende = mia.status === 'waitlisted' && (conOfferta(mia, adesso) || (chiusa && occupati(mia) < capienza));
			if (!prende) return { errore: 409, messaggio: "C'è già una prenotazione per questa lezione." };
			const rifiuto = await motivoNonPrenotabile(tx, lezione, memberId, { escludi: mia.id });
			if (rifiuto) return rifiuto;
			await tx.update(bookings).set({ status: 'confirmed', waitlistPosition: null, postoOffertoFinoA: null }).where(eq(bookings.id, mia.id));
			await regolaOfferte(tx, sessionId, adesso);
			const [creata] = await tx.select().from(bookings).where(eq(bookings.id, mia.id));
			return { creata, daListaAttesa: true };
		}

		const rifiuto = await motivoNonPrenotabile(tx, lezione, memberId);
		if (rifiuto) return rifiuto;
		const pieno = occupati() >= capienza;
		if (pieno && chiusa) {
			return { errore: 409, codice: 'lista_chiusa', messaggio: "La lezione è piena e la lista d'attesa è chiusa: se si libera un posto, è di chi lo prende per primo." };
		}
		const socio = await socioDi(tx, memberId);
		const inAttesa = righe.filter((b) => b.status === 'waitlisted').length;
		const [creata] = await tx
			.insert(bookings)
			.values({
				sessionId,
				memberId,
				memberName: socio.nome,
				status: pieno ? 'waitlisted' : 'confirmed',
				waitlistPosition: pieno ? inAttesa + 1 : null,
				prenotazioneFissaId,
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
 * `soloDelSocio`, quando c'è, limita l'operazione alle prenotazioni di quel socio, e applica il
 * termine di disdetta del corso, tranne per una prenotazione fatta da meno di
 * `MARGINE_RIPENSAMENTO_MINUTI` (l'«Annulla» dopo un tocco sbagliato). `motivo`: perché la
 * disdice il sistema ('sospensione'), null se la disdice una persona.
 *
 * @returns { offerta } (la prenotazione a cui si è offerto il posto liberato, o null) o { errore, messaggio }
 */
export async function disdici({ bookingId, soloDelSocio = null, motivo = null, adesso = new Date() }) {
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
		if (prenotazione.status === 'cancelled') return { offerta: null };

		// Una lezione finita non si disdice: la prenotazione è storia, e disdirla avrebbe anche
		// offerto il posto a qualcuno per una lezione che non c'è più.
		const lezione = await lezioneBloccata(tx, prenotazione.sessionId);
		if (lezione && lezioneFinita(lezione, adesso)) {
			return { errore: 400, messaggio: 'La lezione è già finita: la prenotazione non si disdice più.' };
		}
		// Il termine di disdetta del corso vale per il socio che disdice da sé: la reception, che
		// risponde al telefono e conosce il motivo, può sempre. E il socio che ci ripensa subito.
		const appenaFatta = adesso - new Date(prenotazione.createdDate) < MARGINE_RIPENSAMENTO_MINUTI * 60_000;
		if (soloDelSocio && lezione && !appenaFatta) {
			const chiusa = motivoDisdettaChiusa(lezione, lezione.corso.ore, adesso);
			if (chiusa) return { errore: 400, messaggio: chiusa };
		}

		await tx
			.update(bookings)
			.set({ status: 'cancelled', waitlistPosition: null, postoOffertoFinoA: null, motivoDisdetta: motivo })
			.where(eq(bookings.id, prenotazione.id));

		// Solo un posto confermato (o offerto) che si libera passa a qualcun altro: chi era in
		// lista e rinuncia sposta solo la coda.
		const offerte = await regolaOfferte(tx, prenotazione.sessionId, adesso);
		return { offerta: offerte[0] ?? null };
	});
}

/**
 * La lista d'attesa di una lezione, messa in regola: le offerte scadute, i posti liberi offerti,
 * la coda rinumerata. È l'unico posto che decide a chi va un posto che si libera (una disdetta,
 * una capienza che cresce, un'offerta scaduta), e va chiamata dentro una transazione.
 *
 * Le regole (docs/piani/portale.md, D-3, decise il 14/11):
 * - un posto libero si **offre** al primo in lista senza offerta: resta in attesa, con
 *   `posto_offerto_fino_a` = il minore fra 12 ore dopo e la chiusura della lista, e il posto
 *   conta come occupato. Confermarlo è `prenota`;
 * - un'offerta scaduta rimanda il socio **in fondo** alla lista, e il posto passa al successivo
 *   con 12 ore che partono dalla scadenza di prima: le scadenze si leggono dalle date, senza un
 *   processo che le guardi, e si ricostruiscono qui in ordine di tempo;
 * - alla chiusura della lista (il termine di disdetta del corso) non si offre più niente.
 *
 * Si notifica (`posto_offerto`) solo un'offerta ancora aperta: una già scaduta nel passato,
 * ricostruita adesso, non serve più a nessuno. Chi torna in fondo per un'offerta scaduta lo sa
 * (`offerta_scaduta`, una volta sola anche se il giro lo ha rimandato in fondo più volte).
 *
 * @returns le prenotazioni a cui ha appena offerto un posto, ancora aperte
 */
export async function regolaOfferte(tx, sessionId, adesso = new Date()) {
	const lezione = await lezioneBloccata(tx, sessionId);
	if (!lezione) return [];
	const righe = await tx.select().from(bookings).where(and(eq(bookings.sessionId, sessionId), ne(bookings.status, 'cancelled')));
	const confermate = righe.filter((b) => b.status === 'confirmed').length;
	const coda = righe
		.filter((b) => b.status === 'waitlisted')
		.sort((a, b) => (a.waitlistPosition ?? Infinity) - (b.waitlistPosition ?? Infinity) || new Date(a.createdDate) - new Date(b.createdDate))
		.map((b) => ({ riga: b, fino: b.postoOffertoFinoA ? new Date(b.postoOffertoFinoA).getTime() : null }));
	const ora = adesso.getTime();
	const viva = lezione.status === 'active' && !lezioneFinita(lezione, adesso);
	const chiusura = chiusuraLista(lezione, lezione.corso.ore)?.getTime() ?? 0;
	const capienza = lezione.capacity ?? 0;
	const nuove = new Set();
	const tornati = new Set();

	const offri = (t) => {
		if (!viva || t >= chiusura) return;
		let liberi = capienza - confermate - coda.filter((c) => c.fino && c.fino > t).length;
		for (const c of coda) {
			if (liberi <= 0) break;
			if (c.fino) continue;
			c.fino = Math.min(t + ORE_OFFERTA_POSTO * 3_600_000, chiusura);
			nuove.add(c);
			liberi -= 1;
		}
	};
	// Le scadenze in ordine di tempo: chi scade va in fondo, e il posto passa al successivo da
	// quell'istante. Il tetto ai giri è una cintura: ogni giro sposta il tempo in avanti.
	for (let giro = 0; giro < 1000; giro += 1) {
		const scaduta = coda.filter((c) => c.fino && c.fino <= ora).sort((a, b) => a.fino - b.fino)[0];
		if (!scaduta) break;
		const t = scaduta.fino;
		scaduta.fino = null;
		nuove.delete(scaduta);
		tornati.add(scaduta);
		coda.splice(coda.indexOf(scaduta), 1);
		coda.push(scaduta);
		offri(t);
	}
	offri(ora);

	for (const [indice, c] of coda.entries()) {
		const fino = c.fino ? new Date(c.fino) : null;
		const primaFino = c.riga.postoOffertoFinoA ? new Date(c.riga.postoOffertoFinoA).getTime() : null;
		if (c.riga.waitlistPosition === indice + 1 && primaFino === c.fino) continue;
		await tx.update(bookings).set({ waitlistPosition: indice + 1, postoOffertoFinoA: fino }).where(eq(bookings.id, c.riga.id));
	}

	// Chi riceve un posto deve saperlo: altrimenti lo scopre solo se riapre l'agenda, e l'offerta
	// scade. Nella stessa transazione dell'offerta.
	const aperte = [...nuove].filter((c) => c.fino > ora);
	const nome = lezione.corso.nome;
	for (const c of aperte) {
		await notifica(tx, [c.riga.memberId], {
			tipo: 'posto_offerto',
			lezioneId: lezione.id,
			titolo: `Si è liberato un posto: ${nome}`,
			testo: `C'è un posto per te a ${nome} di ${giornoEsteso(lezione.date)} alle ${String(lezione.startTime).slice(0, 5)}. `
				+ `Confermalo entro ${quando(new Date(c.fino), adesso)}: dopo passa al prossimo in lista.`,
		});
	}
	const quandoLezione = `${giornoEsteso(lezione.date)} alle ${String(lezione.startTime).slice(0, 5)}`;
	for (const c of tornati) {
		if (!viva || c.fino) continue;
		await notifica(tx, [c.riga.memberId], {
			tipo: 'offerta_scaduta',
			lezioneId: lezione.id,
			titolo: `Posto non confermato: ${nome}`,
			testo: `Il posto che si era liberato a ${nome} di ${quandoLezione} non è stato confermato in tempo ed è passato al prossimo. `
				+ (ora >= chiusura
					? "Sei ancora in lista d'attesa, ma la lista è chiusa: se si libera un posto, è di chi lo prende per primo."
					: `Sei di nuovo in lista d'attesa, al ${coda.indexOf(c) + 1}° posto.`),
		});
	}
	return aperte.map((c) => ({ ...c.riga, postoOffertoFinoA: new Date(c.fino) }));
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
 * Dopo ogni cambio la lista d'attesa si rinumera, e un posto che si libera si offre al primo in
 * lista (`regolaOfferte`). Un posto offerto conta come occupato. Chi la reception conferma dalla
 * lista lo sa con una notifica: «Posto confermato» si scrive solo qui (il portale offre, la
 * reception conferma).
 */
export async function cambiaStato({ bookingId, stato, oltreCapienza = false }) {
	if (!STATI_PRENOTAZIONE.includes(stato)) return { errore: 400, messaggio: 'Stato non valido: confermata, in lista d\'attesa o annullata.' };
	if (stato === 'cancelled') return disdici({ bookingId });

	return db.transaction(async (tx) => {
		const { prenotazione, lezione, errore } = await prenotazioneBloccata(tx, bookingId);
		if (errore) return errore;
		if (prenotazione.status === stato) return { aggiornata: prenotazione, offerte: [] };
		const adesso = new Date();

		if (prenotazione.status === 'cancelled') {
			const rifiuto = await motivoNonPrenotabile(tx, lezione, prenotazione.memberId, { escludi: prenotazione.id });
			if (rifiuto) return rifiuto;
		}

		const altre = (await tx.select().from(bookings).where(and(eq(bookings.sessionId, prenotazione.sessionId), ne(bookings.status, 'cancelled'))))
			.filter((b) => b.id !== prenotazione.id);
		const occupati = altre.filter((b) => b.status === 'confirmed' || conOfferta(b, adesso)).length;
		const inAttesa = altre.filter((b) => b.status === 'waitlisted').length;

		if (stato === 'confirmed' && occupati >= (lezione.capacity ?? 0) && !oltreCapienza) {
			return {
				errore: 409,
				codice: 'lezione_piena',
				messaggio: `La lezione è al completo (${occupati} su ${lezione.capacity ?? 0}, contati i posti offerti). Confermando si va oltre la capienza.`,
			};
		}

		const [aggiornata] = await tx
			.update(bookings)
			.set(stato === 'confirmed'
				? { status: 'confirmed', waitlistPosition: null, postoOffertoFinoA: null, motivoDisdetta: null }
				: { status: 'waitlisted', waitlistPosition: inAttesa + 1, postoOffertoFinoA: null, motivoDisdetta: null })
			.where(eq(bookings.id, prenotazione.id))
			.returning();

		if (stato === 'confirmed' && prenotazione.status === 'waitlisted') {
			const [corso] = await tx.select({ nome: courses.name }).from(events)
				.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(events.id, lezione.eventId)).limit(1);
			const nome = corso?.nome ?? 'la lezione';
			await notifica(tx, [prenotazione.memberId], {
				tipo: 'promosso_lista_attesa',
				lezioneId: lezione.id,
				titolo: `Posto confermato: ${nome}`,
				testo: `La reception ti ha dato un posto: la tua prenotazione a ${nome} di ${giornoEsteso(lezione.date)} alle ${String(lezione.startTime).slice(0, 5)} è confermata. `
					+ 'Se non puoi più venire, disdici dal portale per lasciare il posto a un altro.',
			});
		}

		const offerte = await regolaOfferte(tx, prenotazione.sessionId, adesso);
		const [finale] = await tx.select().from(bookings).where(eq(bookings.id, prenotazione.id)).limit(1);
		return { aggiornata: finale ?? aggiornata, offerte: offerte.filter((p) => p.id !== prenotazione.id) };
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
 * restare nello storico come disdette. Se occupava un posto, si offre al primo in lista.
 */
export async function eliminaPrenotazione({ bookingId }) {
	return db.transaction(async (tx) => {
		const { prenotazione, errore } = await prenotazioneBloccata(tx, bookingId);
		if (errore) return errore;
		await tx.delete(bookings).where(eq(bookings.id, prenotazione.id));
		const offerte = await regolaOfferte(tx, prenotazione.sessionId);
		return { eliminata: prenotazione, offerte };
	});
}

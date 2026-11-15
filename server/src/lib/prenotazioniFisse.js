// Le prenotazioni fisse: il socio tiene il suo posto in una sessione, da una data a un'altra, e
// le lezioni gli si prenotano da sole.
//
// Le regole, decise con chi gestisce l'ASD:
// - una lezione della fissa si prenota come qualunque altra (`prenota`): se è piena si entra in
//   lista d'attesa, se il socio è archiviato non si prenota; la prenotazione ricorda la fissa
//   (`bookings.prenotazione_fissa_id`);
// - una fissa vale da `dal` ad `al`, e ha sempre una fine: una data, o un numero di lezioni che
//   diventa subito una data. La fine non va oltre l'abbonamento del socio né oltre l'ultima
//   lezione della sessione (`massimoFissa`). Dalla migrazione 0062 non ci sono più fisse senza
//   fine; anche il portale chiede le date (D-4, docs/piani/portale.md);
// - si prenota solo dove c'è un abbonamento valido quel giorno. Al rinnovo, o quando la sessione
//   si allunga, una fissa non cresce da sola: se ora può arrivare più in là, il socio riceve
//   «Allunga» (`avvisaAllungabili`, una volta per ogni nuovo massimo);
// - una lezione che il socio ha disdetto non gli si riprenota: una prenotazione per quella
//   lezione esiste già, anche se disdetta, e la fissa la rispetta. Tranne quelle disdette da una
//   sospensione (`motivo_disdetta = 'sospensione'`): finita la sospensione, si riprenotano;
// - che cosa succederà a ogni lezione lo dice una funzione sola (`esitiFissa`): l'anteprima del
//   portale la chiama senza scrivere, `applicaFisse` scrivendo. Così l'anteprima non mente;
// - cancellare una fissa disdice solo le prenotazioni nate da lei, dalla data scelta in poi:
//   quelle fatte a mano restano.
//
// `applicaFisse` è idempotente — rifarla non prenota due volte — e la si chiama quando la fissa
// nasce o cambia e quando una sospensione finisce prima. Nessun processo programmato da tenere in
// vita.
import { and, eq, gte, lte, inArray, isNull, or, not, max, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { prenotazioniFisse, sessions, bookings, events, courses, members } from '../db/schema/index.js';
import { abbonamentoCopre, sospensioneIl, fineCopertura } from '../../../shared/abbonamenti.js';
import { iscrizioniDelSocio } from './iscrizioni.js';
import { oggiIso, lezioneFinita, eUnGiorno, spostaGiorni } from '../../../shared/giorni.js';
import { motivoDisdettaChiusa } from '../../../shared/corsi.js';
import { prenota, disdici } from './prenotazioni.js';
import { notifica } from './notifiche.js';
import { chiusuraLista } from '../../../shared/corsi.js';

const dataIt = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split('-'); return `${g}/${m}/${a}`; };
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
/** "15 mar 2027" */
const dataBreve = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split('-'); return `${Number(g)} ${MESI[Number(m) - 1]} ${a}`; };
const piuTardi = (a, b) => (a > b ? a : b);
const vuoto = (v) => v === null || v === undefined || v === '';

// Il tetto di «per N lezioni»: due anni di una sessione settimanale.
export const MASSIMO_LEZIONI_FISSA = 104;

/** Una fissa è in corso se è attiva e non è finita prima di oggi. */
export const fissaInCorso = (oggi = oggiIso()) => and(
	eq(prenotazioniFisse.attiva, true),
	or(isNull(prenotazioniFisse.al), gte(prenotazioniFisse.al, oggi)),
);

/** Le lezioni ancora da tenere di una sessione, dalla più vicina, da `da` ad `a` (compresi; `a` null = senza fine). */
async function lezioniDaTenere(eventId, da, a = null) {
	const filtri = [eq(sessions.eventId, eventId), eq(sessions.status, 'active'), gte(sessions.date, piuTardi(da, oggiIso()))];
	if (a) filtri.push(lte(sessions.date, a));
	const righe = await db.select().from(sessions).where(and(...filtri)).orderBy(sessions.date, sessions.startTime);
	return righe.filter((l) => !lezioneFinita(l));
}

// `fineCopertura` sta in shared/abbonamenti.js: la finestra della fissa mostra lo stesso limite
// prima di salvare. Resta esportata anche da qui, dove la usano i test.
export { fineCopertura };

/**
 * Che cosa succede, lezione per lezione, a una fissa del socio sulla sessione fra `dal` e `al`,
 * senza scrivere niente. È la stessa regola di `prenota`, guardata prima:
 * - `gia_prenotata`, `gia_in_attesa`: il socio ha già una prenotazione viva, confermata o in lista;
 * - `disdetta`: l'aveva e l'ha disdetta lui (non si riprenota);
 * - `sospesa`: quel giorno l'abbonamento è sospeso;
 * - `scoperta`: quel giorno non c'è un abbonamento;
 * - `confermata` o `in_attesa`: c'è posto, o si entra in lista (i posti offerti contano come presi);
 * - `piena`: piena e con la lista chiusa, non si prenota.
 * Una disdetta per sospensione, in un giorno non più sospeso, si riprenota come le altre.
 *
 * @returns [{ lezione, esito }]
 */
export async function esitiFissa({ memberId, eventId, dal, al, adesso = new Date() }) {
	const lezioni = await lezioniDaTenere(eventId, dal, al);
	if (!lezioni.length) return [];
	const [prenotazioni, iscrizioni, [corso]] = await Promise.all([
		db.select().from(bookings).where(inArray(bookings.sessionId, lezioni.map((l) => l.id))),
		iscrizioniDelSocio(memberId),
		db.select({ ore: courses.disdettaEntroOre }).from(events).innerJoin(courses, eq(events.courseId, courses.id)).where(eq(events.id, eventId)).limit(1),
	]);
	return lezioni.map((lezione) => {
		const sue = prenotazioni.filter((b) => b.sessionId === lezione.id);
		const mie = sue.filter((b) => String(b.memberId) === String(memberId));
		const esito = (() => {
			const viva = mie.find((b) => b.status !== 'cancelled');
			if (viva) return viva.status === 'waitlisted' ? 'gia_in_attesa' : 'gia_prenotata';
			if (sospensioneIl(iscrizioni, lezione.date)) return 'sospesa';
			if (mie.some((b) => b.motivoDisdetta !== 'sospensione')) return 'disdetta';
			if (!abbonamentoCopre(iscrizioni, lezione.date)) return 'scoperta';
			const occupati = sue.filter((b) => b.status === 'confirmed'
				|| (b.status === 'waitlisted' && b.postoOffertoFinoA && new Date(b.postoOffertoFinoA) > adesso)).length;
			if (occupati < (lezione.capacity ?? 0)) return 'confermata';
			return adesso >= chiusuraLista(lezione, corso?.ore) ? 'piena' : 'in_attesa';
		})();
		return { lezione, esito };
	});
}

const DA_PRENOTARE = new Set(['confermata', 'in_attesa']);

/**
 * Prenota le lezioni dovute delle fisse attive, filtrate per socio, sessione o fissa: quelle che
 * `esitiFissa` dice `confermata` o `in_attesa`.
 *
 * @param da, a solo le lezioni fra queste date (la fine anticipata di una sospensione)
 * @returns {{ prenotate, inAttesa, scoperte, lezioni: [{ data, esito }] }}: `lezioni` è l'esito
 *   vero, lezione per lezione, della fissa (di una fissa sola, se si filtra per `fissaId`)
 */
export async function applicaFisse({ memberId = null, eventId = null, fissaId = null, da = null, a = null } = {}) {
	const filtri = [eq(prenotazioniFisse.attiva, true)];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	if (fissaId) filtri.push(eq(prenotazioniFisse.id, fissaId));
	const fisse = await db.select().from(prenotazioniFisse).where(and(...filtri));

	const totale = { prenotate: 0, inAttesa: 0, scoperte: 0, lezioni: [] };
	for (const fissa of fisse) {
		const inizio = da ? piuTardi(fissa.dal, da) : fissa.dal;
		const fine = [fissa.al, a].filter(Boolean).sort()[0] ?? null;
		if (fine && fine < inizio) continue;
		for (const { lezione, esito } of await esitiFissa({ memberId: fissa.memberId, eventId: fissa.eventId, dal: inizio, al: fine })) {
			let vero = esito;
			if (DA_PRENOTARE.has(esito)) {
				// Un rifiuto (socio archiviato, una prenotazione nata nel frattempo da un'altra
				// richiesta) non ferma le altre lezioni: la fissa prenota quello che si può.
				const fatto = await prenota({ sessionId: lezione.id, memberId: fissa.memberId, prenotazioneFissaId: fissa.id });
				vero = fatto.creata ? (fatto.creata.status === 'waitlisted' ? 'in_attesa' : 'confermata') : 'rifiutata';
			}
			if (vero === 'confermata') totale.prenotate += 1;
			if (vero === 'in_attesa') totale.inAttesa += 1;
			if (vero === 'scoperta') totale.scoperte += 1;
			totale.lezioni.push({ data: lezione.date, esito: vero });
		}
	}
	return totale;
}

/**
 * Fin dove può arrivare una fissa che parte da `dal` (oggi, se è prima): il minore fra la fine della
 * copertura degli abbonamenti del socio e l'ultima lezione della sessione. Null se il socio non ha
 * un abbonamento quel giorno o se la sessione non ha più lezioni.
 */
export async function massimoFissa({ memberId, eventId, dal = null }) {
	return (await limitiFissa({ memberId, eventId, dal })).massimo;
}

/**
 * Il massimo di una fissa e il perché: { massimo, copertura, ultima, ultima_coperta } — la fine
 * della copertura (sospensioni comprese), l'ultima lezione della sessione, e l'ultima lezione
 * dentro la copertura (è quella che il foglio nomina: «fino al 10 dic, l'ultima lezione coperta
 * dal tuo abbonamento, che scade il 15 dic»).
 */
export async function limitiFissa({ memberId, eventId, dal = null }) {
	const da = piuTardi(dal ?? oggiIso(), oggiIso());
	const [[ultima], iscrizioni] = await Promise.all([
		db.select({ data: max(sessions.date) }).from(sessions).where(and(eq(sessions.eventId, eventId), eq(sessions.status, 'active'))),
		iscrizioniDelSocio(memberId),
	]);
	const copertura = fineCopertura(iscrizioni, da);
	if (!ultima?.data || ultima.data < da || !copertura) return { massimo: null, copertura, ultima: ultima?.data ?? null, ultima_coperta: null };
	const massimo = ultima.data < copertura ? ultima.data : copertura;
	const [coperta] = await db.select({ data: max(sessions.date) }).from(sessions)
		.where(and(eq(sessions.eventId, eventId), eq(sessions.status, 'active'), gte(sessions.date, da), lte(sessions.date, massimo)));
	return { massimo, copertura, ultima: ultima.data, ultima_coperta: coperta?.data ?? null };
}

/**
 * Che cosa farebbe una fissa nuova (o cambiata) senza farlo: il periodo controllato, il massimo
 * e l'esito di ogni lezione. Senza `al` né `numero`, fino al massimo.
 * @returns { errore, messaggio } | { dal, al, limiti, lezioni: [{ data, esito }], prenotate, in_attesa }
 */
export async function anteprimaFissa({ memberId, eventId, dal = null, al = null, numero = null }) {
	const inizio = vuoto(dal) ? oggiIso() : dal;
	const limiti = await limitiFissa({ memberId, eventId, dal: inizio });
	if (!limiti.massimo) {
		return { errore: 400, messaggio: limiti.copertura ? 'La sessione non ha più lezioni.' : 'Per prenotare fisso serve un abbonamento valido da oggi.' };
	}
	const periodo = await periodoValido({ memberId, eventId, dal: inizio, al: vuoto(al) && vuoto(numero) ? limiti.massimo : al, numero });
	if (periodo.errore) return periodo;
	const lezioni = (await esitiFissa({ memberId, eventId, dal: periodo.dal, al: periodo.al }))
		.map(({ lezione, esito }) => ({ data: lezione.date, esito }));
	return {
		dal: periodo.dal, al: periodo.al, limiti, lezioni,
		prenotate: lezioni.filter((l) => l.esito === 'confermata').length,
		in_attesa: lezioni.filter((l) => l.esito === 'in_attesa').length,
	};
}

/**
 * «Allunga»: per ogni fissa in corso (di un socio, o di una sessione) che ora può arrivare più in
 * là della sua fine — un rinnovo, una sessione allungata — una notifica `fissa_da_allungare`. Una
 * volta sola per ogni nuovo massimo: si ricorda in `avviso_inviato_per`.
 * @returns quante notifiche ha scritto
 */
export async function avvisaAllungabili({ memberId = null, eventId = null } = {}) {
	const filtri = [fissaInCorso()];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	const fisse = await db.select({ fissa: prenotazioniFisse, corso: courses.name })
		.from(prenotazioniFisse)
		.innerJoin(events, eq(prenotazioniFisse.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(and(...filtri));
	let scritte = 0;
	for (const { fissa, corso } of fisse) {
		const { massimo, ultima_coperta: ultimaCoperta } = await limitiFissa({ memberId: fissa.memberId, eventId: fissa.eventId, dal: fissa.dal });
		const fino = ultimaCoperta ?? massimo;
		if (!fino || !fissa.al || fino <= fissa.al || fissa.avvisoInviatoPer === fino) continue;
		await db.transaction(async (tx) => {
			await notifica(tx, [fissa.memberId], {
				tipo: 'fissa_da_allungare',
				fissaId: fissa.id,
				titolo: `Puoi allungare la tua fissa: ${corso}`,
				testo: `La tua prenotazione fissa di ${corso} finisce il ${dataBreve(fissa.al)}. Ora può arrivare fino al ${dataBreve(fino)}: allungala con un tocco.`,
			});
			await tx.update(prenotazioniFisse).set({ avvisoInviatoPer: fino }).where(eq(prenotazioniFisse.id, fissa.id));
		});
		scritte += 1;
	}
	return scritte;
}

/**
 * Il periodo chiesto, controllato: `{ dal, al }` oppure `{ errore, messaggio }`.
 *
 * `numero` (per N lezioni) diventa la data della N-esima lezione da `dal`. La fine non va oltre
 * l'ultima lezione della sessione né oltre la copertura degli abbonamenti del socio.
 */
async function periodoValido({ memberId, eventId, dal, al = null, numero = null }) {
	if (!vuoto(al) && !eUnGiorno(al)) return { errore: 400, messaggio: 'La data di fine non è valida.' };
	const daContare = piuTardi(dal, oggiIso());
	let fine = vuoto(al) ? null : al;
	if (!fine && !vuoto(numero)) {
		const n = Number(numero);
		if (!Number.isInteger(n) || n < 1 || n > MASSIMO_LEZIONI_FISSA) {
			return { errore: 400, messaggio: `Il numero di lezioni va da 1 a ${MASSIMO_LEZIONI_FISSA}.` };
		}
		const lezioni = await lezioniDaTenere(eventId, daContare);
		if (lezioni.length < n) {
			return { errore: 400, messaggio: `Dal ${dataIt(daContare)} la sessione ha ${lezioni.length} ${lezioni.length === 1 ? 'lezione' : 'lezioni'}, non ${n}.` };
		}
		fine = lezioni[n - 1].date;
	}
	if (!fine) return { dal, al: null };
	if (fine < dal) return { errore: 400, messaggio: 'La fine viene prima dell\'inizio.' };

	const [ultima] = await db.select({ data: max(sessions.date) }).from(sessions)
		.where(and(eq(sessions.eventId, eventId), eq(sessions.status, 'active')));
	const ultimaLezione = ultima?.data ?? null;
	if (!ultimaLezione || ultimaLezione < daContare) return { errore: 400, messaggio: 'La sessione non ha più lezioni in quel periodo.' };
	if (fine > ultimaLezione) {
		return { errore: 400, messaggio: `La sessione finisce il ${dataIt(ultimaLezione)}: la fissa non può andare oltre.` };
	}
	const copertura = fineCopertura(await iscrizioniDelSocio(memberId), daContare);
	if (!copertura) return { errore: 400, messaggio: `Il ${dataIt(daContare)} il socio non ha un abbonamento valido.` };
	if (fine > copertura) {
		return { errore: 400, messaggio: `L'abbonamento del socio finisce il ${dataIt(copertura)}: la fissa non può andare oltre.` };
	}
	return { dal, al: fine };
}

/**
 * Crea una fissa e la applica subito.
 *
 * @param dal  il primo giorno: oggi o dopo (oggi, se manca)
 * @param al, numero la fine, come data o come numero di lezioni: obbligatoria.
 * @returns { errore, messaggio } | { fissa, esito }
 */
export async function creaFissa({ memberId, eventId, dal = null, al = null, numero = null, creataDa = '' }) {
	const [evento] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
	if (!evento) return { errore: 404, messaggio: 'La sessione non esiste più.' };
	if (evento.recurrenceType !== 'weekly' && evento.recurrenceType !== 'custom') {
		return { errore: 400, messaggio: 'Una lezione singola non si prenota fissa: prenotala e basta.' };
	}
	const oggi = oggiIso();
	const inizio = vuoto(dal) ? oggi : dal;
	if (!eUnGiorno(inizio)) return { errore: 400, messaggio: 'La data di inizio non è valida.' };
	if (inizio < oggi) return { errore: 400, messaggio: 'Una prenotazione fissa comincia oggi o più avanti.' };
	if (vuoto(al) && vuoto(numero)) return { errore: 400, messaggio: 'Indica fino a quando: una data o un numero di lezioni.' };

	const periodo = await periodoValido({ memberId, eventId, dal: inizio, al, numero });
	if (periodo.errore) return periodo;

	const [attiva] = await db.select().from(prenotazioniFisse)
		.where(and(eq(prenotazioniFisse.memberId, memberId), eq(prenotazioniFisse.eventId, eventId), eq(prenotazioniFisse.attiva, true)))
		.limit(1);
	if (attiva) {
		// Una fissa finita prima che cominci questa non conta più: si chiude, e lascia il posto.
		if (!attiva.al || attiva.al >= periodo.dal) return { errore: 409, messaggio: 'C\'è già una prenotazione fissa per questa sessione.' };
		await db.update(prenotazioniFisse).set({ attiva: false, terminataIl: oggi }).where(eq(prenotazioniFisse.id, attiva.id));
	}

	const [fissa] = await db.insert(prenotazioniFisse).values({ memberId, eventId, dal: periodo.dal, al: periodo.al, creataDa }).returning();
	const esito = await applicaFisse({ fissaId: fissa.id });
	return { fissa, esito };
}

/**
 * Le prenotazioni vive nate dalla fissa, su lezioni ancora da tenere, dal giorno `da` in poi; con
 * `fuoriDa` solo quelle fuori da quel periodo.
 */
async function prenotazioniDellaFissa(fissa, { da = oggiIso(), fuoriDa = null } = {}) {
	const righe = await db.select({ id: bookings.id, lezione: sessions })
		.from(bookings)
		.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
		.where(and(
			eq(bookings.prenotazioneFissaId, fissa.id),
			inArray(bookings.status, ['confirmed', 'waitlisted']),
			gte(sessions.date, piuTardi(da, oggiIso())),
		))
		.orderBy(sessions.date);
	return righe
		.filter((r) => !lezioneFinita(r.lezione))
		.filter((r) => !fuoriDa || r.lezione.date < fuoriDa.dal || (fuoriDa.al && r.lezione.date > fuoriDa.al));
}

/**
 * Cambia il periodo di una fissa, lavorando sulla differenza: prenota i giorni aggiunti, disdice
 * quelli tolti, non tocca quelli in mezzo. Senza una fine nuova la fine resta quella di prima.
 * @returns { errore, messaggio } | { fissa, esito, disdette }
 */
export async function modificaFissa({ fissaId, dal = null, al = null, numero = null, soloDelSocio = null }) {
	const [fissa] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, fissaId)).limit(1);
	if (!fissa || (soloDelSocio && String(fissa.memberId) !== String(soloDelSocio))) return { errore: 404, messaggio: 'Prenotazione fissa inesistente.' };
	if (!fissa.attiva) return { errore: 400, messaggio: 'La prenotazione fissa è già terminata.' };
	const inizio = vuoto(dal) ? fissa.dal : dal;
	if (!eUnGiorno(inizio)) return { errore: 400, messaggio: 'La data di inizio non è valida.' };
	if (inizio !== fissa.dal && inizio < oggiIso()) return { errore: 400, messaggio: 'Il nuovo inizio è oggi o più avanti.' };
	const senzaData = vuoto(al) && vuoto(numero);
	const periodo = senzaData && !fissa.al
		? { dal: inizio, al: null }
		: await periodoValido({ memberId: fissa.memberId, eventId: fissa.eventId, dal: inizio, al: senzaData ? fissa.al : al, numero });
	if (periodo.errore) return periodo;

	const [aggiornata] = await db.update(prenotazioniFisse).set({ dal: periodo.dal, al: periodo.al })
		.where(eq(prenotazioniFisse.id, fissa.id)).returning();
	// Il socio che accorcia rispetta il termine di disdetta dei corsi: quelle oltre restano.
	let disdette = 0;
	let rimaste = 0;
	for (const p of await prenotazioniDellaFissa(fissa, { fuoriDa: periodo })) {
		if ((await disdici({ bookingId: p.id, soloDelSocio })).errore) rimaste += 1; else disdette += 1;
	}
	const esito = await applicaFisse({ fissaId: fissa.id });
	return { fissa: aggiornata, esito, disdette, rimaste };
}

/**
 * Termina una fissa dal giorno `dal` (oggi, se manca: il portale non lo manda): da lì non prenota
 * più, e le sue prenotazioni da lì in poi si disdicono. Quelle fatte a mano restano. Da oggi (o da
 * prima che cominci) la fissa si chiude; da un giorno più avanti finisce il giorno prima. Il socio
 * rispetta il termine di disdetta dei corsi (quelle oltre restano); lo staff no.
 * @returns { errore, messaggio } | { disdette, rimaste }
 */
export async function terminaFissa({ fissaId, dal = null, soloDelSocio = null }) {
	const [fissa] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, fissaId)).limit(1);
	if (!fissa || (soloDelSocio && String(fissa.memberId) !== String(soloDelSocio))) {
		return { errore: 404, messaggio: 'Prenotazione fissa inesistente.' };
	}
	const oggi = oggiIso();
	const da = vuoto(dal) ? oggi : dal;
	if (!eUnGiorno(da)) return { errore: 400, messaggio: 'La data non è valida.' };
	if (da < oggi) return { errore: 400, messaggio: 'Si cancella da oggi o da un giorno più avanti.' };
	if (fissa.attiva) {
		if (da <= piuTardi(fissa.dal, oggi)) {
			await db.update(prenotazioniFisse).set({ attiva: false, terminataIl: oggi }).where(eq(prenotazioniFisse.id, fissa.id));
		} else if (!fissa.al || fissa.al >= da) {
			await db.update(prenotazioniFisse).set({ al: spostaGiorni(da, -1) }).where(eq(prenotazioniFisse.id, fissa.id));
		}
	}
	const [corso] = await db.select({ ore: courses.disdettaEntroOre }).from(events)
		.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(events.id, fissa.eventId)).limit(1);
	let disdette = 0;
	let rimaste = 0;
	for (const p of await prenotazioniDellaFissa(fissa, { da })) {
		if (soloDelSocio && motivoDisdettaChiusa(p.lezione, corso?.ore)) { rimaste += 1; continue; }
		const esito = await disdici({ bookingId: p.id, soloDelSocio });
		if (esito.errore) rimaste += 1; else disdette += 1;
	}
	return { disdette, rimaste };
}

/**
 * Chiude le fisse di una sessione che non ha più lezioni da tenere: eliminata o accorciata, non
 * prenoterebbe più niente. Nella transazione di chi toglie le lezioni.
 * @returns quante fisse ha chiuso
 */
export async function chiudiFisseSenzaLezioni(tx, eventId) {
	const oggi = oggiIso();
	const future = await tx.select({ date: sessions.date, endTime: sessions.endTime }).from(sessions)
		.where(and(eq(sessions.eventId, eventId), eq(sessions.status, 'active'), gte(sessions.date, oggi)));
	if (future.some((l) => !lezioneFinita(l))) return 0;
	const chiuse = await tx.update(prenotazioniFisse).set({ attiva: false, terminataIl: oggi })
		.where(and(eq(prenotazioniFisse.eventId, eventId), eq(prenotazioniFisse.attiva, true)))
		.returning({ id: prenotazioniFisse.id });
	return chiuse.length;
}

/**
 * Le fisse, con corso, giorno, orario e socio, per il portale, la scheda del socio e le sessioni.
 * @param concluse invece di quelle in corso, quelle finite o cancellate (vedi `fissaInCorso`), dalla
 *                 più recente: `terminata_il` è il giorno in cui è stata chiusa prima della fine.
 */
export async function elencoFisse({ memberId = null, eventId = null, concluse = false } = {}) {
	const filtri = [];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	filtri.push(concluse ? not(fissaInCorso()) : fissaInCorso());
	return db.select({
		id: prenotazioniFisse.id, member_id: prenotazioniFisse.memberId, event_id: prenotazioniFisse.eventId,
		dal: prenotazioniFisse.dal, al: prenotazioniFisse.al,
		attiva: prenotazioniFisse.attiva, creata_da: prenotazioniFisse.creataDa,
		creata_il: prenotazioniFisse.createdDate, terminata_il: prenotazioniFisse.terminataIl,
		socio: members.fullName, codice_socio: members.codiceSocio,
		corso: courses.name, giorno: events.giorno, inizio: events.startTime, fine: events.endTime,
	})
		.from(prenotazioniFisse)
		.innerJoin(events, eq(prenotazioniFisse.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.innerJoin(members, eq(prenotazioniFisse.memberId, members.id))
		.where(filtri.length ? and(...filtri) : undefined)
		.orderBy(...(concluse
			? [desc(sql`coalesce(${prenotazioniFisse.terminataIl}, ${prenotazioniFisse.al})`), courses.name]
			: [courses.name, members.fullName]));
}

// Le prenotazioni fisse: il socio tiene il suo posto in una sessione, da una data a un'altra, e
// le lezioni gli si prenotano da sole.
//
// Le regole, decise con chi gestisce l'ASD:
// - una lezione della fissa si prenota come qualunque altra (`prenota`): se è piena si entra in
//   lista d'attesa, se il socio è archiviato non si prenota; la prenotazione ricorda la fissa
//   (`bookings.prenotazione_fissa_id`);
// - una fissa vale da `dal` ad `al`. Lo staff la crea sempre con una fine: una data, o un numero
//   di lezioni che diventa subito una data. La fine non va oltre l'abbonamento del socio né oltre
//   l'ultima lezione della sessione. Il portale la crea senza fine, come prima (`al` vuoto);
// - si prenota solo dove c'è un abbonamento valido quel giorno. Per le lezioni rimaste scoperte il
//   socio riceve un avviso, una volta per ogni scadenza. Al rinnovo, o quando la sessione si
//   allunga, ripartono da sole solo le fisse senza fine: quelle con una data restano com'erano;
// - una lezione che il socio ha disdetto non gli si riprenota: una prenotazione per quella
//   lezione esiste già, anche se disdetta, e la fissa la rispetta;
// - cancellare una fissa disdice solo le prenotazioni nate da lei, dalla data scelta in poi:
//   quelle fatte a mano restano.
//
// `applicaFisse` è idempotente — rifarla non prenota due volte — e la si chiama da più punti:
// quando la fissa nasce o cambia, quando nasce un abbonamento, quando la sessione si allunga,
// quando una sospensione finisce prima, quando il socio guarda l'agenda. Nessun processo
// programmato da tenere in vita.
import { and, eq, gte, lte, inArray, isNull, or, max } from 'drizzle-orm';
import { db } from '../db/client.js';
import { prenotazioniFisse, sessions, bookings, events, courses, members } from '../db/schema/index.js';
import { abbonamentoCopre, sospensioneIl, fineCopertura } from '../../../shared/abbonamenti.js';
import { iscrizioniDelSocio } from './iscrizioni.js';
import { oggiIso, lezioneFinita, eUnGiorno, spostaGiorni } from '../../../shared/giorni.js';
import { motivoDisdettaChiusa } from '../../../shared/corsi.js';
import { prenota, disdici } from './prenotazioni.js';
import { notifica, giornoEsteso } from './notifiche.js';

const dataIt = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split('-'); return `${g}/${m}/${a}`; };
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

/** Le lezioni ancora da tenere della fissa: dentro il suo periodo, e dentro `[da, a]` se dati. */
function lezioniDellaFissa(fissa, { da = null, a = null } = {}) {
	const inizio = da ? piuTardi(fissa.dal, da) : fissa.dal;
	const fine = [fissa.al, a].filter(Boolean).sort()[0] ?? null;
	if (fine && fine < inizio) return [];
	return lezioniDaTenere(fissa.eventId, inizio, fine);
}

// `fineCopertura` sta in shared/abbonamenti.js: la finestra della fissa mostra lo stesso limite
// prima di salvare. Resta esportata anche da qui, dove la usano i test.
export { fineCopertura };

/**
 * Prenota le lezioni dovute delle fisse attive, filtrate per socio, sessione o fissa.
 *
 * @param soloSenzaFine solo le fisse senza `al`: è il caso dei richiami da fuori (un rinnovo, una
 *   sessione allungata, l'agenda del portale), che non devono far crescere una fissa con una data
 * @param da, a solo le lezioni fra queste date (la fine anticipata di una sospensione)
 * @returns {{ prenotate: number, inAttesa: number, scoperte: number }}
 */
export async function applicaFisse({ memberId = null, eventId = null, fissaId = null, soloSenzaFine = false, da = null, a = null } = {}) {
	const filtri = [eq(prenotazioniFisse.attiva, true)];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	if (fissaId) filtri.push(eq(prenotazioniFisse.id, fissaId));
	if (soloSenzaFine) filtri.push(isNull(prenotazioniFisse.al));
	const fisse = await db.select({ fissa: prenotazioniFisse, corso: courses.name })
		.from(prenotazioniFisse)
		.innerJoin(events, eq(prenotazioniFisse.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(and(...filtri));

	const totale = { prenotate: 0, inAttesa: 0, scoperte: 0 };
	for (const { fissa, corso } of fisse) {
		const lezioni = await lezioniDellaFissa(fissa, { da, a });
		if (!lezioni.length) continue;
		const [esistenti, iscrizioni] = await Promise.all([
			db.select({ sessionId: bookings.sessionId }).from(bookings)
				.where(and(eq(bookings.memberId, fissa.memberId), inArray(bookings.sessionId, lezioni.map((l) => l.id)))),
			iscrizioniDelSocio(fissa.memberId),
		]);
		const giaPrenotate = new Set(esistenti.map((e) => e.sessionId));

		let primaScoperta = null;
		for (const lezione of lezioni) {
			if (giaPrenotate.has(lezione.id)) continue;
			// Un giorno sospeso non è scoperto: si salta, e alla ripresa la fissa riprende da sola.
			if (sospensioneIl(iscrizioni, lezione.date)) continue;
			if (!abbonamentoCopre(iscrizioni, lezione.date)) {
				primaScoperta ??= lezione.date;
				totale.scoperte += 1;
				continue;
			}
			// Un rifiuto (socio archiviato, una prenotazione nata nel frattempo da un'altra
			// richiesta) non ferma le altre lezioni: la fissa prenota quello che si può.
			const esito = await prenota({ sessionId: lezione.id, memberId: fissa.memberId, prenotazioneFissaId: fissa.id });
			if (esito.creata) totale[esito.creata.status === 'waitlisted' ? 'inAttesa' : 'prenotate'] += 1;
		}

		// L'avviso: una volta sola per ogni prima lezione scoperta, cioè per ogni scadenza.
		if (primaScoperta && fissa.avvisoInviatoPer !== primaScoperta) {
			const fineCoperta = iscrizioni
				.map((i) => i.end_date).filter((d) => d && d < primaScoperta).sort().pop();
			await db.transaction(async (tx) => {
				await notifica(tx, [fissa.memberId], {
					tipo: 'fissa_senza_abbonamento',
					titolo: `Prenotazione fissa ferma: ${corso}`,
					testo: (fineCoperta
						? `La tua prenotazione fissa di ${corso} si ferma al ${dataIt(fineCoperta)}, quando finisce il tuo abbonamento.`
						: `La tua prenotazione fissa di ${corso} non può prenotare la lezione di ${giornoEsteso(primaScoperta)}: non hai un abbonamento valido quel giorno.`)
						+ ' Rinnovalo in reception e le lezioni si prenoteranno da sole.',
				});
				await tx.update(prenotazioniFisse).set({ avvisoInviatoPer: primaScoperta }).where(eq(prenotazioniFisse.id, fissa.id));
			});
		}
	}
	return totale;
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
 * @param al, numero la fine, come data o come numero di lezioni. Lo staff la deve dare; il
 *   portale no (`senzaFine`), e la sua fissa resta senza fine come prima.
 * @returns { errore, messaggio } | { fissa, esito }
 */
export async function creaFissa({ memberId, eventId, dal = null, al = null, numero = null, creataDa = '', senzaFine = false }) {
	const [evento] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
	if (!evento) return { errore: 404, messaggio: 'La sessione non esiste più.' };
	if (evento.recurrenceType !== 'weekly' && evento.recurrenceType !== 'custom') {
		return { errore: 400, messaggio: 'Una lezione singola non si prenota fissa: prenotala e basta.' };
	}
	const oggi = oggiIso();
	const inizio = vuoto(dal) ? oggi : dal;
	if (!eUnGiorno(inizio)) return { errore: 400, messaggio: 'La data di inizio non è valida.' };
	if (inizio < oggi) return { errore: 400, messaggio: 'Una prenotazione fissa comincia oggi o più avanti.' };
	const senzaData = vuoto(al) && vuoto(numero);
	if (senzaData && !senzaFine) return { errore: 400, messaggio: 'Indica fino a quando: una data o un numero di lezioni.' };

	const periodo = senzaData ? { dal: inizio, al: null } : await periodoValido({ memberId, eventId, dal: inizio, al, numero });
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
export async function modificaFissa({ fissaId, dal = null, al = null, numero = null }) {
	const [fissa] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, fissaId)).limit(1);
	if (!fissa) return { errore: 404, messaggio: 'Prenotazione fissa inesistente.' };
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
	let disdette = 0;
	for (const p of await prenotazioniDellaFissa(fissa, { fuoriDa: periodo })) {
		if (!(await disdici({ bookingId: p.id })).errore) disdette += 1;
	}
	const esito = await applicaFisse({ fissaId: fissa.id });
	return { fissa: aggiornata, esito, disdette };
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
 * @param soloInCorso solo quelle attive e non finite (vedi `fissaInCorso`)
 */
export async function elencoFisse({ memberId = null, eventId = null, soloInCorso = true } = {}) {
	const filtri = [];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	if (soloInCorso) filtri.push(fissaInCorso());
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
		.orderBy(courses.name, members.fullName);
}

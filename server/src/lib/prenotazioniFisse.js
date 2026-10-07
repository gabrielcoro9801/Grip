// Le prenotazioni fisse: il socio tiene il suo posto in una serie, e le lezioni gli si
// prenotano da sole.
//
// Le regole, decise con chi gestisce l'ASD:
// - una lezione della fissa si prenota come qualunque altra (`prenota`): se è piena si entra in
//   lista d'attesa, se il socio è archiviato non si prenota;
// - si prenota solo dove c'è un abbonamento valido quel giorno: al massimo fino alla fine
//   dell'ultimo abbonamento. Per le lezioni rimaste scoperte il socio riceve un avviso, una
//   volta per ogni scadenza; al rinnovo la fissa riparte da sola;
// - una lezione che il socio ha disdetto non gli si riprenota: una prenotazione per quella
//   lezione esiste già, anche se disdetta, e la fissa la rispetta.
//
// `applicaFisse` è idempotente — rifarla non prenota due volte — e la si chiama da più punti:
// quando la fissa nasce, quando nasce un abbonamento, quando la serie si allunga, quando il socio
// guarda l'agenda. Nessun processo programmato da tenere in vita.
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { prenotazioniFisse, sessions, bookings, subscriptions, events, courses } from '../db/schema/index.js';
import { abbonamentoCopre } from '../../../shared/abbonamenti.js';
import { oggiIso, lezioneFinita } from '../../../shared/giorni.js';
import { motivoDisdettaChiusa } from '../../../shared/corsi.js';
import { prenota, disdici } from './prenotazioni.js';
import { notifica, giornoEsteso } from './notifiche.js';
import { giornoDellaSettimana } from './calendario.js';

const dataIt = (iso) => { const [a, m, g] = String(iso).slice(0, 10).split('-'); return `${g}/${m}/${a}`; };

/** Le lezioni future di una serie nei giorni scelti, dalla più vicina. */
async function lezioniDellaFissa(fissa) {
	const righe = await db.select().from(sessions)
		.where(and(eq(sessions.eventId, fissa.eventId), eq(sessions.status, 'active'), gte(sessions.date, oggiIso())))
		.orderBy(sessions.date, sessions.startTime);
	const giorni = Array.isArray(fissa.giorni) && fissa.giorni.length ? new Set(fissa.giorni) : null;
	return righe.filter((l) => !lezioneFinita(l) && (!giorni || giorni.has(giornoDellaSettimana(l.date))));
}

/**
 * Prenota le lezioni dovute delle fisse attive, filtrate per socio e/o serie.
 * @returns {{ prenotate: number, inAttesa: number, scoperte: number }}
 */
export async function applicaFisse({ memberId = null, eventId = null } = {}) {
	const filtri = [eq(prenotazioniFisse.attiva, true)];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	const fisse = await db.select({ fissa: prenotazioniFisse, corso: courses.name })
		.from(prenotazioniFisse)
		.innerJoin(events, eq(prenotazioniFisse.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(and(...filtri));

	const totale = { prenotate: 0, inAttesa: 0, scoperte: 0 };
	for (const { fissa, corso } of fisse) {
		const lezioni = await lezioniDellaFissa(fissa);
		if (!lezioni.length) continue;
		const [esistenti, iscrizioni] = await Promise.all([
			db.select({ sessionId: bookings.sessionId }).from(bookings)
				.where(and(eq(bookings.memberId, fissa.memberId), inArray(bookings.sessionId, lezioni.map((l) => l.id)))),
			db.select({ start_date: subscriptions.startDate, end_date: subscriptions.endDate }).from(subscriptions)
				.where(eq(subscriptions.memberId, fissa.memberId)),
		]);
		const giaPrenotate = new Set(esistenti.map((e) => e.sessionId));

		let primaScoperta = null;
		for (const lezione of lezioni) {
			if (giaPrenotate.has(lezione.id)) continue;
			if (!abbonamentoCopre(iscrizioni, lezione.date)) {
				primaScoperta ??= lezione.date;
				totale.scoperte += 1;
				continue;
			}
			// Un rifiuto (socio archiviato, una prenotazione nata nel frattempo da un'altra
			// richiesta) non ferma le altre lezioni: la fissa prenota quello che si può.
			const esito = await prenota({ sessionId: lezione.id, memberId: fissa.memberId });
			if (esito.creata) totale[esito.creata.status === 'waitlisted' ? 'inAttesa' : 'prenotate'] += 1;
		}

		// L'avviso: una volta sola per ogni prima lezione scoperta, cioè per ogni scadenza.
		if (primaScoperta && fissa.avvisoInviatoPer !== primaScoperta) {
			const fineCopertura = iscrizioni
				.map((i) => i.end_date).filter((d) => d && d < primaScoperta).sort().pop();
			await db.transaction(async (tx) => {
				await notifica(tx, [fissa.memberId], {
					tipo: 'fissa_senza_abbonamento',
					titolo: `Prenotazione fissa ferma: ${corso}`,
					testo: (fineCopertura
						? `La tua prenotazione fissa di ${corso} si ferma al ${dataIt(fineCopertura)}, quando finisce il tuo abbonamento.`
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
 * Crea una fissa e la applica subito.
 * @returns { errore, messaggio } | { fissa, esito }
 */
export async function creaFissa({ memberId, eventId, giorni = null, creataDa = '' }) {
	const [evento] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
	if (!evento) return { errore: 404, messaggio: 'La serie non esiste più.' };
	if (evento.recurrenceType !== 'weekly' && evento.recurrenceType !== 'custom') {
		return { errore: 400, messaggio: 'Una lezione singola non si prenota fissa: prenotala e basta.' };
	}
	let scelti = null;
	if (Array.isArray(giorni) && giorni.length && evento.recurrenceType === 'weekly') {
		const dellaSerie = new Set(evento.daysOfWeek ?? []);
		if (!giorni.every((g) => dellaSerie.has(g))) return { errore: 400, messaggio: 'Quei giorni non sono della serie.' };
		scelti = giorni.length === dellaSerie.size ? null : [...new Set(giorni)];
	}
	const [attiva] = await db.select({ id: prenotazioniFisse.id }).from(prenotazioniFisse)
		.where(and(eq(prenotazioniFisse.memberId, memberId), eq(prenotazioniFisse.eventId, eventId), eq(prenotazioniFisse.attiva, true)))
		.limit(1);
	if (attiva) return { errore: 409, messaggio: 'Hai già una prenotazione fissa per questa serie.' };

	const [fissa] = await db.insert(prenotazioniFisse).values({ memberId, eventId, giorni: scelti, creataDa }).returning();
	const esito = await applicaFisse({ memberId, eventId });
	return { fissa, esito };
}

/**
 * Termina una fissa: non prenota più, e le sue prenotazioni future si disdicono. Il socio
 * rispetta il termine di disdetta dei corsi (quelle oltre restano); lo staff no.
 * @returns { errore, messaggio } | { disdette, rimaste }
 */
export async function terminaFissa({ fissaId, soloDelSocio = null }) {
	const [fissa] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, fissaId)).limit(1);
	if (!fissa || (soloDelSocio && String(fissa.memberId) !== String(soloDelSocio))) {
		return { errore: 404, messaggio: 'Prenotazione fissa inesistente.' };
	}
	if (fissa.attiva) {
		await db.update(prenotazioniFisse).set({ attiva: false, terminataIl: oggiIso() }).where(eq(prenotazioniFisse.id, fissa.id));
	}
	const [corso] = await db.select({ ore: courses.disdettaEntroOre }).from(events)
		.innerJoin(courses, eq(events.courseId, courses.id)).where(eq(events.id, fissa.eventId)).limit(1);
	const lezioni = await lezioniDellaFissa(fissa);
	const vive = lezioni.length
		? await db.select({ id: bookings.id, sessionId: bookings.sessionId }).from(bookings)
			.where(and(eq(bookings.memberId, fissa.memberId), inArray(bookings.sessionId, lezioni.map((l) => l.id)), inArray(bookings.status, ['confirmed', 'waitlisted'])))
		: [];
	let disdette = 0;
	let rimaste = 0;
	for (const p of vive) {
		const lezione = lezioni.find((l) => l.id === p.sessionId);
		if (soloDelSocio && motivoDisdettaChiusa(lezione, corso?.ore)) { rimaste += 1; continue; }
		const esito = await disdici({ bookingId: p.id, soloDelSocio });
		if (esito.errore) rimaste += 1; else disdette += 1;
	}
	return { disdette, rimaste };
}

/** Le fisse, con corso, orario, sala e giorni, per il portale e per la scheda socio. */
export async function elencoFisse({ memberId = null, eventId = null, soloAttive = true } = {}) {
	const filtri = [];
	if (memberId) filtri.push(eq(prenotazioniFisse.memberId, memberId));
	if (eventId) filtri.push(eq(prenotazioniFisse.eventId, eventId));
	if (soloAttive) filtri.push(eq(prenotazioniFisse.attiva, true));
	return db.select({
		id: prenotazioniFisse.id, member_id: prenotazioniFisse.memberId, event_id: prenotazioniFisse.eventId,
		giorni: prenotazioniFisse.giorni, attiva: prenotazioniFisse.attiva, creata_da: prenotazioniFisse.creataDa,
		creata_il: prenotazioniFisse.createdDate, terminata_il: prenotazioniFisse.terminataIl,
		corso: courses.name, giorni_serie: events.daysOfWeek, inizio: events.startTime, fine: events.endTime,
	})
		.from(prenotazioniFisse)
		.innerJoin(events, eq(prenotazioniFisse.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(filtri.length ? and(...filtri) : undefined)
		.orderBy(courses.name);
}

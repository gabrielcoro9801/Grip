// Togliere lezioni dal calendario, e allungare o accorciare una serie.
//
// Le regole, decise con chi gestisce l'ASD:
//
// - si tocca solo da oggi in poi: una lezione già tenuta è storia, e con lei chi c'era;
// - una lezione senza prenotazioni, nemmeno disdette, si **elimina**: nessuno l'ha mai vista;
// - una lezione con prenotazioni si **annulla**: resta nel database come annullata, le
//   prenotazioni vive vengono cancellate (senza promuovere nessuno dalla lista d'attesa — non
//   c'è più una lezione in cui entrare) e chi era prenotato o in attesa riceve un avviso nel
//   portale. Eliminarla cancellerebbe anche la traccia di chi doveva esserci.
//
// Tutto in una transazione, passata da chi chiama: la modifica dal browser erano N richieste, e
// un errore a metà lasciava metà serie cambiata.
import { inArray } from 'drizzle-orm';
import { sessions, bookings } from '../db/schema/index.js';
import { lezioneFinita } from '../../../shared/giorni.js';
import { notifica, giornoEsteso } from './notifiche.js';

const GIORNI_INGLESI = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'Monday'… da "2026-10-12", come `days_of_week` degli eventi. In UTC: è una data, non un istante. */
export function giornoDellaSettimana(iso) {
	const [a, m, g] = String(iso).slice(0, 10).split('-').map(Number);
	return GIORNI_INGLESI[new Date(Date.UTC(a, m - 1, g)).getUTCDay()];
}

export const hhmm = (t) => String(t ?? '').slice(0, 5);

/** Una lezione (riga Drizzle) è ancora da tenere? Oggi conta fino all'ora di fine. */
export const daTenere = (l) => l.status === 'active' && !lezioneFinita({ date: l.date, end_time: l.endTime });

/**
 * Cosa succede togliendo queste lezioni.
 *
 * @param lezioni righe Drizzle di `sessions`
 * @returns {{ daEliminare, daAnnullare, prenotazioniVive }}
 */
export async function pianoRimozione(tx, lezioni) {
	if (!lezioni.length) return { daEliminare: [], daAnnullare: [], prenotazioniVive: [] };
	const prenotazioni = await tx
		.select({ id: bookings.id, sessionId: bookings.sessionId, memberId: bookings.memberId, status: bookings.status })
		.from(bookings)
		.where(inArray(bookings.sessionId, lezioni.map((l) => l.id)));
	const conPrenotazioni = new Set(prenotazioni.map((p) => p.sessionId));
	return {
		daEliminare: lezioni.filter((l) => !conPrenotazioni.has(l.id)),
		daAnnullare: lezioni.filter((l) => conPrenotazioni.has(l.id)),
		prenotazioniVive: prenotazioni.filter((p) => p.status !== 'cancelled'),
	};
}

/** I numeri da mostrare prima di confermare, e da scrivere nel registro dopo. */
export function contiRimozione({ daEliminare, daAnnullare, prenotazioniVive }) {
	return {
		eliminate: daEliminare.length,
		annullate: daAnnullare.length,
		soci_avvisati: new Set(prenotazioniVive.map((p) => p.memberId)).size,
	};
}

/** Esegue il piano: elimina, annulla, cancella le prenotazioni vive e avvisa i soci. */
export async function applicaRimozione(tx, { daEliminare, daAnnullare, prenotazioniVive }, nomeCorso) {
	if (daEliminare.length) await tx.delete(sessions).where(inArray(sessions.id, daEliminare.map((l) => l.id)));
	if (daAnnullare.length) await tx.update(sessions).set({ status: 'cancelled' }).where(inArray(sessions.id, daAnnullare.map((l) => l.id)));
	if (prenotazioniVive.length) {
		await tx.update(bookings)
			.set({ status: 'cancelled', waitlistPosition: null })
			.where(inArray(bookings.id, prenotazioniVive.map((p) => p.id)));
	}
	for (const lezione of daAnnullare) {
		const chi = prenotazioniVive.filter((p) => p.sessionId === lezione.id).map((p) => p.memberId);
		await notifica(tx, chi, {
			tipo: 'lezione_annullata',
			titolo: `Lezione annullata: ${nomeCorso}`,
			testo: `La lezione di ${nomeCorso} di ${giornoEsteso(lezione.date)} alle ${hhmm(lezione.startTime)} è stata annullata, `
				+ 'e la tua prenotazione è stata cancellata. Ci scusiamo per il disagio.',
		}, { evento: 'lezione_annullata', riferimento: `lezione:${lezione.id}` });
	}
}

/** "Eliminate 3 lezioni, annullate 2, avvisati 5 soci" — per il registro. */
export function descriviConti({ eliminate, annullate, soci_avvisati: avvisati }) {
	const parti = [];
	if (eliminate) parti.push(`eliminate ${eliminate} ${eliminate === 1 ? 'lezione' : 'lezioni'}`);
	if (annullate) parti.push(`annullate ${annullate} ${annullate === 1 ? 'lezione' : 'lezioni'} con prenotazioni`);
	if (avvisati) parti.push(`${avvisati} ${avvisati === 1 ? 'socio avvisato' : 'soci avvisati'}`);
	return parti.join(', ');
}

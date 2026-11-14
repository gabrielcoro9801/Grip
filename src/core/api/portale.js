import { api } from './client.js';
import { oggiIso, spostaGiorni } from '../domain/giorni.js';

/**
 * Il portale soci visto dal lato del client: una funzione per schermata.
 *
 * Prima ogni pagina si costruiva i propri dati chiedendo entità per nome — `Member`,
 * `Subscription`, `Booking` — e incrociandole a mano. Quel lavoro era sparso in otto file, e
 * ogni pagina lo faceva a modo suo.
 *
 * Qui le richieste hanno la forma delle schermate, non delle tabelle. Due conseguenze che
 * contano più di quanto sembri:
 *
 *  - il giorno in cui si cambia il modo di chiedere i dati si tocca **questo** file, non le
 *    pagine;
 *  - un'app su telefono riuserebbe questo modulo così com'è, e riscriverebbe solo il disegno.
 *
 * Tutto passa da `/api/member/v1`, che è la superficie pensata per il socio: esplicita,
 * versionata, e indipendente dai nomi delle colonne del database.
 */

const BASE = '/api/member/v1';

/** Anagrafica e abbonamento in corso: la schermata iniziale. */
export function caricaProfilo() {
	return api.richiesta(`${BASE}/profilo`);
}

/** Nome, indirizzo e recapiti della palestra (null quelli che mancano). */
export function caricaPalestra() {
	return api.richiesta(`${BASE}/palestra`);
}

/**
 * Le proprie prossime lezioni (prenotate o in lista d'attesa, non ancora finite), in ordine,
 * dall'agenda dei prossimi `giorni`. In D-3 arriva `GET /lezioni`, che le dà già così.
 */
export async function caricaMieProssime({ giorni = 30 } = {}) {
	const dal = oggiIso();
	const agenda = await caricaAgenda({ dal, al: spostaGiorni(dal, giorni) });
	return agenda.giorni.flatMap((g) => g.lezioni).filter((l) => l.mia_prenotazione && !l.finita);
}

/** Lo storico degli abbonamenti: { abbonamenti }. */
export function caricaAbbonamenti() {
	return api.richiesta(`${BASE}/abbonamenti`);
}

/**
 * Le lezioni prenotabili in un intervallo, già raggruppate per giorno e con i posti contati.
 *
 * Sostituisce sette richieste e l'incrocio che il browser faceva a mano — incluso lo
 * scaricamento di tutte le prenotazioni altrui per contare i posti liberi.
 */
export function caricaAgenda({ dal, al } = {}) {
	const parametri = new URLSearchParams();
	if (dal) parametri.set('dal', dal);
	if (al) parametri.set('al', al);
	const coda = parametri.toString();
	return api.richiesta(`${BASE}/corsi/agenda${coda ? `?${coda}` : ''}`);
}

export function prenotaLezione(idLezione) {
	return api.richiesta(`${BASE}/corsi/lezioni/${idLezione}/prenota`, { method: 'POST' });
}

export function disdiciPrenotazione(idPrenotazione) {
	return api.richiesta(`${BASE}/corsi/prenotazioni/${idPrenotazione}/disdici`, { method: 'POST' });
}

/** Le proprie prenotazioni fisse attive. */
export async function caricaFisse() {
	const { fisse } = await api.richiesta(`${BASE}/corsi/fisse`);
	return fisse;
}

/** Prenota fisso in una serie, nei giorni scelti: { prenotate, in_attesa, senza_abbonamento }. */
export function prenotaFisso(idSerie, giorni) {
	return api.richiesta(`${BASE}/corsi/serie/${idSerie}/fissa`, { method: 'POST', body: { giorni } });
}

/** Termina una propria prenotazione fissa: { disdette, rimaste }. */
export function terminaFissa(idFissa) {
	return api.richiesta(`${BASE}/corsi/fisse/${idFissa}`, { method: 'DELETE' });
}

/** Gli avvisi del socio, dal più recente: { notifiche, non_lette }. */
export function caricaNotifiche() {
	return api.richiesta(`${BASE}/notifiche`);
}

/** Quante notifiche da leggere e quanti avvisi aperti: { non_lette, avvisi, avvisi_gravi }. Lo chiede la campanella a ogni pagina. */
export function contaNotificheEAvvisi() {
	return api.richiesta(`${BASE}/notifiche?solo_conteggio=1`);
}

/** Segna come lette tutte le notifiche del socio. */
export function segnaNotificheLette() {
	return api.richiesta(`${BASE}/notifiche/lette`, { method: 'POST' });
}

/** I consensi alle comunicazioni promozionali: { consensi: { marketing_email: { valore, … }, … } }. */
export function caricaConsensi() {
	return api.richiesta(`${BASE}/consensi`);
}

/** Revoca un consenso: dal portale si può solo togliere. → { consensi } */
export function revocaConsenso(tipo) {
	return api.richiesta(`${BASE}/consensi`, { method: 'PUT', body: { tipo, valore: false } });
}

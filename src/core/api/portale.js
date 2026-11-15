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
 * Le mie lezioni: quelle che ho prenotato fra `dal` e `al` (di base dagli ultimi 30 giorni ai
 * prossimi 60), anche disdette o annullate dalla palestra. → [lezione]
 */
export async function caricaLezioni({ dal, al } = {}) {
	const parametri = new URLSearchParams();
	if (dal) parametri.set('dal', dal);
	if (al) parametri.set('al', al);
	const coda = parametri.toString();
	const { lezioni } = await api.richiesta(`${BASE}/lezioni${coda ? `?${coda}` : ''}`);
	return lezioni;
}

/** Le prossime lezioni vive (prenotate o in lista, non finite né annullate), in ordine. */
export async function caricaMieProssime({ giorni = 30 } = {}) {
	const dal = oggiIso();
	const lezioni = await caricaLezioni({ dal, al: spostaGiorni(dal, giorni) });
	return lezioni.filter((l) => l.mia_prenotazione && l.mia_prenotazione.stato !== 'cancelled' && !l.finita && !l.annullata);
}

/** Il catalogo per «Per corso»: { categorie: [{ …, corsi: [{ …, orari }] }], categoria_recente }. */
export function caricaCatalogo() {
	return api.richiesta(`${BASE}/corsi/catalogo`);
}

/** «I tuoi corsi»: la prossima lezione degli orari che prenoto spesso. → [lezione] */
export async function caricaMieiOrari() {
	const { lezioni } = await api.richiesta(`${BASE}/corsi/miei-orari`);
	return lezioni;
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
export function caricaAgenda({ dal, al, sessione = null } = {}) {
	const parametri = new URLSearchParams();
	if (dal) parametri.set('dal', dal);
	if (al) parametri.set('al', al);
	if (sessione) parametri.set('sessione_id', sessione);
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

/**
 * Che cosa farebbe una fissa sulla sessione, senza farla: fino al massimo se non si dice fino a
 * quando. `fissa` per cambiarne una. → { dal, al, massimo, copertura_fino_al, ultima_lezione,
 * ultima_coperta, lezioni: [{ data, esito }], prenotate, in_attesa }
 */
export function anteprimaFissa(idSessione, { al = null, numero = null, fissa = null } = {}) {
	const parametri = new URLSearchParams();
	if (al) parametri.set('al', al);
	if (numero) parametri.set('numero', numero);
	if (fissa) parametri.set('fissa_id', fissa);
	const coda = parametri.toString();
	return api.richiesta(`${BASE}/corsi/sessioni/${idSessione}/fissa/anteprima${coda ? `?${coda}` : ''}`);
}

/** Prenota fisso, fino a una data o per N lezioni. → come l'anteprima, con l'esito vero. */
export function prenotaFisso(idSessione, { al = null, numero = null }) {
	return api.richiesta(`${BASE}/corsi/sessioni/${idSessione}/fissa`, { method: 'POST', body: { al, numero } });
}

/** Allunga o accorcia una propria fissa. → { fissa, prenotate, in_attesa, disdette, rimaste } */
export function cambiaFissa(idFissa, { al = null, numero = null }) {
	return api.richiesta(`${BASE}/corsi/fisse/${idFissa}`, { method: 'PUT', body: { al, numero } });
}

/** Termina una propria fissa da oggi. → { disdette, rimaste } */
export function terminaFissa(idFissa) {
	return api.richiesta(`${BASE}/corsi/fisse/${idFissa}/termina`, { method: 'POST', body: {} });
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

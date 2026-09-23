// Le regole delle sale: stato, periodo di sospensione, note.
//
// Stanno qui perché le usano in due: il server, che rifiuta di sospendere una sala ancora
// occupata e di programmare un evento in una sala sospesa, e le schermate, che lo dicono prima
// di provarci. Due copie della stessa regola avrebbero finito per non dire la stessa cosa.
//
// La sala non ha più una capienza: quanta gente entra a lezione lo decide l'evento, che può
// cambiare da corso a corso nella stessa stanza.

// Da oggi in avanti si usa `oggiIso` dei tipi di abbonamento: la data di Roma è una sola, e
// calcolarla una seconda volta qui avrebbe voluto dire poterla sbagliare in un posto solo.
import { oggiIso } from './abbonamenti.js';
export { oggiIso };

// Due stati e basta. Una sala non si "annulla": se non c'è più, si toglie dal calendario.
export const STATI_SALA = [
	{ valore: 'attivo', etichetta: 'Attiva' },
	{ valore: 'sospeso', etichetta: 'Sospesa' },
];
const PER_STATO = Object.fromEntries(STATI_SALA.map((s) => [s.valore, s]));
export const statoSalaValido = (v) => v in PER_STATO;

export const NOTE_MASSIMO = 140;

const E_UNA_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-01" → "01/10/2026". Per i messaggi letti dalla segreteria. */
export function dataIt(iso) {
	if (!E_UNA_DATA.test(String(iso ?? ''))) return String(iso ?? '');
	const [a, m, g] = String(iso).split('-');
	return `${g}/${m}/${a}`;
}

/**
 * Perché il periodo di sospensione non va bene, o null.
 *
 * Una sospensione è sempre da una data a una data: "sospesa e basta" non direbbe agli eventi
 * futuri quando la sala torna libera, e la segreteria si ritroverebbe a riaprirla a mano.
 */
export function motivoSospensioneNonValida(dal, al) {
	if (!E_UNA_DATA.test(String(dal ?? ''))) return 'Indica da che giorno la sala è sospesa.';
	if (!E_UNA_DATA.test(String(al ?? ''))) return 'Indica fino a che giorno la sala è sospesa.';
	if (al < dal) return 'La fine della sospensione non può precedere il suo inizio.';
	return null;
}

/** Se la sospensione della sala copre quel giorno (estremi compresi). */
export function sospensioneCopre(sala, data) {
	if (!sala || sala.stato !== 'sospeso' || !sala.sospesa_dal || !sala.sospesa_al) return false;
	return data >= sala.sospesa_dal && data <= sala.sospesa_al;
}

/**
 * Se due periodi si toccano. `fineA` a null vuol dire "senza fine nota": un evento
 * settimanale contato a occorrenze non sa in che giorno finisce finché non genera le sessioni,
 * e in quel caso conviene considerarlo sovrapposto piuttosto che lasciarlo passare.
 */
export function periodiSiSovrappongono(inizioA, fineA, inizioB, fineB) {
	if (fineA && fineA < inizioB) return false;
	return !(inizioA > fineB);
}

/** Se la sala è inutilizzabile, in tutto o in parte, nel periodo di un evento. */
export function sospensioneTocca(sala, inizio, fine) {
	if (!sala || sala.stato !== 'sospeso' || !sala.sospesa_dal || !sala.sospesa_al) return false;
	return periodiSiSovrappongono(inizio, fine, sala.sospesa_dal, sala.sospesa_al);
}

/**
 * Lo stato da mostrare, che sono tre pur essendo due quelli salvati.
 *
 * Una sospensione ha un inizio e una fine, e finché non comincia la sala funziona: dirla
 * "sospesa" già da oggi manderebbe la segreteria a cercare un'altra stanza per niente. Quando
 * il periodo è passato la sala è di nuovo utilizzabile, e l'etichetta lo dice invece di restare
 * ferma su "sospesa" fino a che qualcuno se ne accorge.
 *
 * @returns {'attiva'|'sospesa'|'programmata'|'conclusa'}
 */
export function statoSala(sala, oggi = oggiIso()) {
	if (!sala || sala.stato !== 'sospeso' || !sala.sospesa_dal || !sala.sospesa_al) return 'attiva';
	if (oggi > sala.sospesa_al) return 'conclusa';
	if (oggi < sala.sospesa_dal) return 'programmata';
	return 'sospesa';
}

/** Etichetta e tono del distintivo, per `statoSala`. */
export const ETICHETTA_STATO_SALA = {
	attiva: { etichetta: 'Attiva', tono: 'positivo' },
	sospesa: { etichetta: 'Sospesa', tono: 'attesa' },
	programmata: { etichetta: 'Sospensione programmata', tono: 'info' },
	conclusa: { etichetta: 'Sospensione conclusa', tono: 'neutro' },
};

/** "Sospesa dal 01/10/2026 al 15/10/2026", o stringa vuota se non è sospesa. */
export function descriviSospensione(sala) {
	if (!sala || sala.stato !== 'sospeso' || !sala.sospesa_dal || !sala.sospesa_al) return '';
	return `Sospesa dal ${dataIt(sala.sospesa_dal)} al ${dataIt(sala.sospesa_al)}`;
}

/**
 * Il messaggio che ferma la sospensione di una sala ancora occupata.
 *
 * Comandano gli eventi: una sala non si sospende sotto le lezioni già fissate, perché
 * i soci ci sono già prenotati. Prima si tolgono gli eventi, poi si sospende la sala.
 *
 * @param {string[]} date le date delle lezioni ancora in calendario nel periodo, in ordine
 */
export function messaggioSospensioneBloccata(nomeSala, dal, al, date) {
	const quante = date.length;
	const quali = quante === 1
		? `il ${dataIt(date[0])}`
		: `dal ${dataIt(date[0])} al ${dataIt(date[quante - 1])}`;
	const lezioni = quante === 1 ? "c'è 1 lezione" : `ci sono ${quante} lezioni`;
	return `«${nomeSala}» non si può sospendere dal ${dataIt(dal)} al ${dataIt(al)}: in quel periodo ${lezioni} già in calendario (${quali}). Comandano gli eventi: per sospendere la sala vanno prima eliminati.`;
}

/** Il messaggio che rifiuta un evento in una sala sospesa. */
export function messaggioSalaSospesa(sala) {
	return `La sala «${sala.name}» è sospesa dal ${dataIt(sala.sospesa_dal)} al ${dataIt(sala.sospesa_al)}: in quel periodo non si programmano lezioni.`;
}

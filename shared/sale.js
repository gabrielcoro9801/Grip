// Le regole delle sale: stato, periodo di sospensione, note.
//
// Stanno qui perché le usano in due: il server, che rifiuta di sospendere una sala ancora
// occupata e di programmare un evento in una sala sospesa, e le schermate, che lo dicono prima
// di provarci. Due copie della stessa regola avrebbero finito per non dire la stessa cosa.
//
// La sala non ha più una capienza: quanta gente entra a lezione lo decide l'evento, che può
// cambiare da corso a corso nella stessa stanza.

// Da oggi in avanti si usa `oggiIso` di `giorni.js`: la data di Roma è una sola, e
// calcolarla una seconda volta qui avrebbe voluto dire poterla sbagliare in un posto solo.
import { oggiIso } from './giorni.js';
import { motivoCambioStato } from './stati.js';
export { oggiIso };

// Tre stati. Sospesa è un periodo e si disfa; annullata è per sempre — la stanza non c'è più,
// o non è più una sala, e il suo passato resta attaccato agli eventi che ci si sono tenuti.
// È la stessa distinzione dei tipi di abbonamento, per la stessa ragione: senza uno stato
// definitivo, l'unico modo di togliere di mezzo una sala sarebbe eliminarla, e con lei il
// calendario di chi ci si è allenato.
export const STATI_SALA = [
	{ valore: 'attivo', etichetta: 'Attiva' },
	{ valore: 'sospeso', etichetta: 'Sospesa' },
	{ valore: 'annullato', etichetta: 'Annullata' },
];
const PER_STATO = Object.fromEntries(STATI_SALA.map((s) => [s.valore, s]));
export const statoSalaValido = (v) => v in PER_STATO;

/** Perché una sala non può passare a `nuovo`, o null. */
export function motivoCambioStatoNonValido(attuale, nuovo) {
	return motivoCambioStato(attuale, nuovo, {
		valido: statoSalaValido,
		nonValido: 'Stato non valido: attiva, sospesa o annullata.',
		definitivo: 'Una sala annullata non si riattiva: creane una nuova.',
	});
}

/**
 * Il rifiuto, parola per parola, quando la sala è ancora in calendario da qui in avanti.
 *
 * Vale per l'eliminazione e per l'annullamento, e infatti li nomina entrambi: chi prova l'una
 * proverebbe l'altra dieci secondi dopo, e sentirsi dire due volte "non si può" senza sapere
 * che sono la stessa porta è il modo migliore per continuare a spingerla.
 */
export const SALA_PRENOTATA = 'La sala è prenotata per altri corsi. Non è possibile né eliminarla né annullarla.';

// Il nome sta su una riga sola della tile, e deve restare leggibile accanto al distintivo
// dello stato: oltre i cinquanta caratteri non è più un nome, è una descrizione.
export const NOME_MASSIMO = 50;
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
 * Lo stato da mostrare, che sono cinque pur essendo tre quelli salvati.
 *
 * Una sospensione ha un inizio e una fine, e finché non comincia la sala funziona: dirla
 * "sospesa" già da oggi manderebbe la segreteria a cercare un'altra stanza per niente. Quando
 * il periodo è passato la sala è di nuovo utilizzabile, e l'etichetta lo dice invece di restare
 * ferma su "sospesa" fino a che qualcuno se ne accorge.
 *
 * @returns {'attiva'|'sospesa'|'programmata'|'conclusa'|'annullata'}
 */
export function statoSala(sala, oggi = oggiIso()) {
	if (sala?.stato === 'annullato') return 'annullata';
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
	annullata: { etichetta: 'Annullata', tono: 'negativo' },
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

/**
 * Cosa si può fare di una sala, letto dal suo calendario.
 *
 * Tre casi, e il criterio è cosa si perderebbe.
 *
 * - Mai collegata a un evento: non è mai stata niente per nessuno, e si elimina davvero.
 * - Solo eventi passati: eliminarla cancellerebbe il "dove" di lezioni che si sono tenute per
 *   davvero, con gente dentro. Si annulla: sparisce da tutto quello che si programma da qui in
 *   avanti, e resta attaccata al passato che ha ospitato.
 * - Eventi in corso o futuri: non si tocca. Ci sono soci prenotati su lezioni che devono ancora
 *   arrivare, e toglierla di mezzo adesso lascerebbe loro un appuntamento senza stanza.
 *
 * Una sala già annullata con un passato non ha più niente da fare: è già dove deve stare. Prima
 * il cestino proponeva di nuovo "Annulla definitivamente", e il messaggio "Sala annullata"
 * arrivava senza che cambiasse niente.
 *
 * @param {{maiUsata: boolean, occupataDaQui: boolean, annullata?: boolean}} calendario
 * @returns {'elimina'|'annulla'|'niente'}
 */
export function azioneSullaSala({ maiUsata, occupataDaQui, annullata = false }) {
	if (occupataDaQui) return 'niente';
	if (maiUsata) return 'elimina';
	return annullata ? 'niente' : 'annulla';
}

/** Perché il cestino non fa niente su una sala: prenotata da qui in avanti, o già annullata. */
export const SALA_GIA_ANNULLATA = 'La sala è già annullata e ha ospitato lezioni: resta com\'è, attaccata al calendario passato.';

/**
 * Il messaggio che spiega perché una sala usata in passato si annulla invece di sparire.
 *
 * Non è un rifiuto: è la stessa intenzione, eseguita nel modo che non riscrive la storia.
 * Ha preso il posto di un "non si elimina" secco, che diceva di no senza dire cosa fare.
 *
 * Conta gli eventi se ce ne sono, altrimenti le lezioni (spostate qui da un evento che sta in
 * un'altra sala): dire "12 eventi" di 12 lezioni sarebbe falso.
 */
export function messaggioAnnullaInveceDiEliminare(nomeSala, { eventi = 0, lezioni = 0 } = {}) {
	const cosa = eventi
		? (eventi === 1 ? "c'è 1 evento che si è tenuto" : `ci sono ${eventi} eventi che si sono tenuti`)
		: (lezioni === 1 ? "c'è 1 lezione che si è tenuta" : `ci sono ${lezioni} lezioni che si sono tenute`);
	return `«${nomeSala}» non si elimina perché in questa sala ${cosa} davvero: cancellarla toglierebbe il «dove» a lezioni già fatte. Si annulla: non si potrà più programmarci niente, e il calendario passato resta com'è.`;
}

/**
 * Le sale fra cui scegliere quando si programma: le annullate non ci sono.
 *
 * Erano nella tendina, spente: una sala annullata non si userà mai più, e tenerla lì allunga
 * solo l'elenco.
 */
export function saleProgrammabili(sale) {
	return (sale ?? []).filter((s) => s.stato !== 'annullato');
}

/**
 * Il nome di una sala nella tendina, con il motivo se nel periodo scelto non si può usare.
 *
 * L'etichetta guardava lo stato di *oggi*: poteva dire "sospensione conclusa" di una sala chiusa
 * proprio nelle date dell'evento, e senza dire quali. E la gestione lezioni ne aveva un'altra.
 * Questa è una sola, e parla del periodo di cui si sta parlando.
 *
 * @param fine null se non è nota (evento a occorrenze).
 */
export function etichettaSalaNelPeriodo(sala, inizio, fine) {
	if (!sala) return '';
	if (sala.stato === 'annullato') return `${sala.name} — annullata`;
	if (inizio && sospensioneTocca(sala, inizio, fine)) {
		return `${sala.name} — sospesa dal ${dataIt(sala.sospesa_dal)} al ${dataIt(sala.sospesa_al)}`;
	}
	return sala.name;
}

/**
 * Se una sala si può prenotare fra `inizio` e `fine`, e perché no.
 *
 * Due ragioni diverse per la stessa risposta. Annullata vale per sempre e non guarda le date:
 * non è più una sala. Sospesa vale solo dentro il suo periodo, e fuori da quello la stanza
 * funziona come sempre.
 *
 * @param fine null quando non è nota: un evento a occorrenze non sa in che giorno finisce.
 */
export function motivoSalaNonPrenotabile(sala, inizio, fine) {
	if (!sala) return null;
	if (sala.stato === 'annullato') return `La sala «${sala.name}» è annullata: non ci si programmano più lezioni.`;
	if (sospensioneTocca(sala, inizio, fine)) return messaggioSalaSospesa(sala);
	return null;
}

/** Il messaggio che rifiuta un evento in una sala sospesa. */
function messaggioSalaSospesa(sala) {
	return `La sala «${sala.name}» è sospesa dal ${dataIt(sala.sospesa_dal)} al ${dataIt(sala.sospesa_al)}: in quel periodo non si programmano lezioni.`;
}

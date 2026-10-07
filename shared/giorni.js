// I giorni sul calendario: oggi a Roma, spostarsi di N giorni, contare i giorni fra due date.
//
// Stanno qui perché servono a tutti. Prima lo stesso conto era scritto quattro volte — nel
// portale (`fraGiorni`, `giorniDaOggi`), nella dashboard (`spostaGiorni`), nei test
// (`giornoRelativo`) e nelle schermate (`aggiungiGiorni`) — ognuna con la sua costante per il
// giorno in millisecondi e il suo modo di tornare alla mezzanotte.
//
// Si ragiona su stringhe YYYY-MM-DD, che sono giorni e non istanti, e i conti si fanno in UTC:
// in UTC non esiste l'ora legale, quindi fra due mezzanotti ci sono sempre 24 ore esatte e
// nessun arrotondamento nasconde un giorno perso a fine marzo.

const GIORNO_MS = 86_400_000;
const E_UNA_DATA = /^\d{4}-\d{2}-\d{2}/;

/** La data di oggi a Roma, YYYY-MM-DD: il server gira in UTC, la palestra no. */
export function oggiIso(adesso = new Date()) {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
}

/** L'ora di adesso a Roma, HH:MM: è quella che confronta gli orari delle lezioni. */
export function oraIso(adesso = new Date()) {
	return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(adesso);
}

/**
 * Vera se una lezione è già finita: un giorno passato, o oggi con l'orario di fine alle spalle.
 *
 * Guardare solo la data lasciava prenotare fino a mezzanotte una lezione finita alle nove del
 * mattino, e disdirne una di ieri.
 *
 * @param {{ date: string, end_time?: string, endTime?: string }} lezione
 */
export function lezioneFinita(lezione, adesso = new Date()) {
	const giorno = String(lezione?.date ?? '').slice(0, 10);
	const oggi = oggiIso(adesso);
	if (giorno !== oggi) return giorno < oggi;
	const fine = String(lezione.end_time ?? lezione.endTime ?? '').slice(0, 5);
	return Boolean(fine) && fine <= oraIso(adesso);
}

/** La mezzanotte UTC di un giorno, in millisecondi; null se non è una data. */
function mezzanotte(giorno) {
	const testo = String(giorno ?? '');
	if (!E_UNA_DATA.test(testo)) return null;
	const ms = Date.parse(`${testo.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(ms)) return null;
	// `Date.parse` accetta anche il 30 febbraio, e lo fa diventare il 2 marzo: un giorno esiste
	// solo se tornando indietro si ritrova lo stesso testo.
	return new Date(ms).toISOString().slice(0, 10) === testo.slice(0, 10) ? ms : null;
}

/** Vera se è un giorno YYYY-MM-DD che esiste. */
export const eUnGiorno = (giorno) => mezzanotte(giorno) !== null;

/** Lo stesso giorno spostato di N giorni (negativi per tornare indietro); null se non è una data. */
export function spostaGiorni(giorno, quanti) {
	const ms = mezzanotte(giorno);
	if (ms === null) return null;
	return new Date(ms + quanti * GIORNO_MS).toISOString().slice(0, 10);
}

/** Quanti giorni da `da` ad `a`: positivo se `a` viene dopo. Null se una delle due non è una data. */
export function giorniFra(da, a) {
	const inizio = mezzanotte(da);
	const fine = mezzanotte(a);
	if (inizio === null || fine === null) return null;
	return Math.round((fine - inizio) / GIORNO_MS);
}

/** Quanti giorni mancano a una data, contati da oggi a Roma. Negativo se è passata. */
export const giorniDaOggi = (giorno) => giorniFra(oggiIso(), giorno);

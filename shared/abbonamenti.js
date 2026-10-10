// Le regole dei tipi di abbonamento: durata, scadenza, stato, vendibilità.
//
// Stanno qui perché le usano in due: il server, che calcola la scadenza e rifiuta la vendita di
// un tipo non vendibile, e le schermate, che la mostrano prima di salvare. Due calcoli separati
// della stessa scadenza avrebbero finito per dare due date diverse.

import { oggiIso, giorniFra, spostaGiorni } from './giorni.js';
import { motivoCambioStato } from './stati.js';
import { SOGLIE } from './soglie.js';

// Oggi a Roma vive in `giorni.js`; resta esportato anche da qui perché server e schermate lo
// prendono da questo modulo da quando è nato.
export { oggiIso };

export const UNITA_DURATA = [
	{ valore: 'giorni', singolare: 'giorno', plurale: 'giorni' },
	{ valore: 'mesi', singolare: 'mese', plurale: 'mesi' },
	{ valore: 'anni', singolare: 'anno', plurale: 'anni' },
];
const PER_UNITA = Object.fromEntries(UNITA_DURATA.map((u) => [u.valore, u]));
export const unitaDurataValida = (v) => v in PER_UNITA;

/** "1 mese", "3 mesi", "30 giorni". */
export function descriviDurata(valore, unita) {
	const u = PER_UNITA[unita];
	if (!u || !valore) return '';
	return `${valore} ${Number(valore) === 1 ? u.singolare : u.plurale}`;
}

// Un tipo nasce attivo. Sospeso: non si vende per ora, e si può riattivare. Annullato: non si
// vende più, ed è definitivo — è la ragione per cui esistono due stati e non uno.
export const STATI_TIPO = [
	{ valore: 'attivo', etichetta: 'Attivo' },
	{ valore: 'sospeso', etichetta: 'Sospeso' },
	{ valore: 'annullato', etichetta: 'Annullato' },
];
const PER_STATO = Object.fromEntries(STATI_TIPO.map((s) => [s.valore, s]));
export const statoTipoValido = (v) => v in PER_STATO;

/** Perché un tipo non può passare a `nuovo`, o null. */
export function motivoCambioStatoNonValido(attuale, nuovo) {
	return motivoCambioStato(attuale, nuovo, {
		valido: statoTipoValido,
		nonValido: 'Stato non valido: attivo, sospeso o annullato.',
		definitivo: 'Un abbonamento annullato non si riattiva: creane uno nuovo.',
	});
}

export const NOTE_MASSIMO = 140;

/** Un tipo si vende se è attivo e la sua data massima di vendita, se c'è, non è passata. */
export function motivoNonVendibile(tipo, oggi = oggiIso()) {
	if (!tipo) return 'Abbonamento inesistente.';
	if (tipo.stato !== 'attivo') return `L'abbonamento «${tipo.name}» è ${tipo.stato}: non si può vendere.`;
	if (tipo.vendibile_fino_al && oggi > tipo.vendibile_fino_al) {
		return `L'abbonamento «${tipo.name}» si poteva vendere fino al ${tipo.vendibile_fino_al}.`;
	}
	return null;
}

/**
 * Da quanti giorni prima della fine un'iscrizione è "in scadenza".
 *
 * È la soglia che la dashboard della segreteria usava già per i suoi avvisi. Gli avvisi del
 * portale soci ne hanno una loro, più stretta (sette giorni): lì si parla al socio, qui alla
 * segreteria, che deve avere il tempo di proporre il rinnovo.
 */
export const GIORNI_ABBONAMENTO_IN_SCADENZA = SOGLIE.abbonamentoInScadenzaGiorni;

/**
 * Lo stato di un'iscrizione, calcolato dalle date: 'active' | 'expiring' | 'expired'.
 *
 * Nel database c'è una colonna `status`, ma nessun processo la aggiorna: un'iscrizione nasceva
 * "active" e restava tale per sempre, e dashboard, filtri, bollini e portale mostravano come
 * attivi abbonamenti scaduti da mesi. Lo stato è una conseguenza delle date — la stessa scelta
 * fatta per i documenti — e chi legge un'iscrizione dal server lo riceve già calcolato così.
 */
export function statoIscrizione(iscrizione, oggi = oggiIso()) {
	const fine = iscrizione?.end_date ? String(iscrizione.end_date).slice(0, 10) : null;
	if (!fine) return 'active';
	if (fine < oggi) return 'expired';
	return giorniFra(oggi, fine) <= GIORNI_ABBONAMENTO_IN_SCADENZA ? 'expiring' : 'active';
}

/**
 * Vera se almeno una delle iscrizioni copre quel giorno (inizio e fine compresi).
 *
 * È la regola della prenotazione: si prenota una lezione solo con un abbonamento valido il
 * giorno in cui si tiene — non oggi, perché chi rinnova il mese prossimo può già prenotare le
 * lezioni del mese prossimo, e chi scade domani non può prenotare quelle della settimana dopo.
 *
 * Un giorno dentro una sospensione non è coperto: le iscrizioni passate da `conSospensioni`
 * portano le loro (`sospensioni`), quelle lette senza non ne hanno.
 */
export function abbonamentoCopre(iscrizioni, giorno) {
	const data = String(giorno ?? '').slice(0, 10);
	if (!data) return false;
	return (iscrizioni ?? []).some((i) => {
		const inizio = i?.start_date ? String(i.start_date).slice(0, 10) : null;
		const fine = i?.end_date ? String(i.end_date).slice(0, 10) : null;
		return (!inizio || inizio <= data) && (!fine || data <= fine) && !dentro(i.sospensioni, data);
	});
}

export const MESSAGGIO_SENZA_ABBONAMENTO = "Per prenotare serve un abbonamento valido il giorno della lezione: rivolgiti alla reception.";
export const MESSAGGIO_SOSPESO = "Il tuo abbonamento è sospeso quel giorno: la prenotazione riapre alla ripresa.";

const dentro = (sospensioni, data) => (sospensioni ?? []).some((s) => s.dal <= data && data <= s.al);
const giornoDi = (d) => (d ? String(d).slice(0, 10) : null);

/** La sospensione che copre quel giorno, fra quelle delle iscrizioni (`conSospensioni`), o null. */
export function sospensioneIl(iscrizioni, giorno) {
	const data = giornoDi(giorno);
	for (const i of iscrizioni ?? []) {
		const s = (i.sospensioni ?? []).find((x) => x.dal <= data && data <= x.al);
		if (s) return s;
	}
	return null;
}

/** Perché quel giorno non si prenota: l'abbonamento è sospeso, o non c'è. null se si prenota. */
export function motivoSenzaCopertura(iscrizioni, giorno) {
	if (abbonamentoCopre(iscrizioni, giorno)) return null;
	return sospensioneIl(iscrizioni, giorno) ? MESSAGGIO_SOSPESO : MESSAGGIO_SENZA_ABBONAMENTO;
}

/**
 * Le iscrizioni di un socio con le date di oggi, dopo le sue sospensioni.
 *
 * Una sospensione (un congelamento, con una data di ripresa) ferma l'abbonamento: in quei giorni
 * il socio non entra e non prenota, e l'abbonamento finisce dopo, di altrettanti giorni. La
 * scadenza non si riscrive — come lo stato, si calcola: nel database `end_date` resta quella
 * venduta, e chi legge un'iscrizione riceve questa.
 *
 * L'iscrizione che copre il primo giorno sospeso si allunga; un rinnovo già comprato che le
 * viene dietro (che parte prima della nuova fine) slitta di altrettanto, così nessun giorno si
 * paga due volte. Un rinnovo che parte molto dopo resta dov'è.
 *
 * @param iscrizioni  [{ start_date, end_date, … }]
 * @param sospensioni [{ dal, al, … }] — `al` è l'ultimo giorno sospeso, compreso
 * @returns le iscrizioni, nello stesso ordine, con `start_date` ed `end_date` di oggi, e in più
 *   `sospensioni` (quelle che le fermano), `giorni_sospesi` e `fine_originale`.
 */
export function conSospensioni(iscrizioni = [], sospensioni = []) {
	const righe = iscrizioni.map((i) => ({
		...i, start_date: giornoDi(i.start_date), end_date: giornoDi(i.end_date), fine_originale: giornoDi(i.end_date), sospensioni: [], giorni_sospesi: 0,
	}));
	const periodi = sospensioni
		.map((s) => ({ ...s, dal: giornoDi(s.dal), al: giornoDi(s.al) }))
		.filter((s) => s.dal && s.al && s.al >= s.dal)
		.sort((a, b) => a.dal.localeCompare(b.dal));
	const perInizio = [...righe].sort((a, b) => String(a.start_date ?? '').localeCompare(String(b.start_date ?? '')));
	for (const s of periodi) {
		const durata = giorniFra(s.dal, s.al) + 1;
		const allunga = (i) => { if (i.end_date) i.end_date = spostaGiorni(i.end_date, durata); i.giorni_sospesi += durata; };
		// Fin dove arriva la catena di iscrizioni allungate: un rinnovo che parte entro, slitta.
		let catena = null;
		for (const i of perInizio) {
			const copre = (!i.start_date || i.start_date <= s.dal) && (!i.end_date || i.end_date >= s.dal);
			if (copre) {
				allunga(i);
				i.sospensioni.push(s);
				catena = i.end_date && (!catena || i.end_date > catena) ? i.end_date : catena;
			} else if (catena && i.start_date > s.dal && i.start_date <= catena) {
				i.start_date = spostaGiorni(i.start_date, durata);
				allunga(i);
				catena = i.end_date > catena ? i.end_date : catena;
			}
		}
	}
	return righe;
}

/** Vera se l'iscrizione vale ancora oggi (attiva o in scadenza). */
export const iscrizioneValida = (iscrizione, oggi = oggiIso()) => statoIscrizione(iscrizione, oggi) !== 'expired';

const iso = (d) => d.toISOString().slice(0, 10);
const giorniNelMese = (anno, mese) => new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate();

/**
 * L'ultimo giorno valido di un abbonamento, compreso.
 *
 * Prima la durata era solo in giorni, e "un mese" si scriveva 30: dal 1° gennaio scadeva il
 * 30, dal 1° febbraio il 3 marzo. Ora un mese è un mese di calendario: dal 1° settembre al 30,
 * dal 16 settembre al 15 ottobre. Se il giorno di partenza non esiste nel mese d'arrivo (dal
 * 31 gennaio), si arriva all'ultimo giorno di quel mese.
 *
 * @param {string} inizio YYYY-MM-DD
 * @param {number} valore
 * @param {'giorni'|'mesi'|'anni'} unita
 * @returns {string} YYYY-MM-DD
 */
export function dataFineAbbonamento(inizio, valore, unita) {
	const [a, m, g] = String(inizio).split('-').map(Number);
	const n = Number(valore);
	if (!a || !m || !g || !Number.isInteger(n) || n < 1 || !unitaDurataValida(unita)) return null;

	if (unita === 'giorni') return iso(new Date(Date.UTC(a, m - 1, g + n - 1)));

	const mesi = unita === 'anni' ? n * 12 : n;
	const indice = (m - 1) + mesi;
	const annoArrivo = a + Math.floor(indice / 12);
	const meseArrivo = indice % 12;
	const ultimo = giorniNelMese(annoArrivo, meseArrivo);
	if (g > ultimo) return iso(new Date(Date.UTC(annoArrivo, meseArrivo, ultimo)));
	return iso(new Date(Date.UTC(annoArrivo, meseArrivo, g - 1)));
}

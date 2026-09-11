import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * I file caricati non sono più raggiungibili da chiunque conosca l'indirizzo.
 *
 * Erano serviti da `/uploads/*` senza alcun controllo: il nome è casuale e quindi non si
 * indovina, ma un indirizzo si condivide, finisce in una cronologia, in un log del
 * proxy, in uno screenshot. E fra quei file ci sono i certificati medici dei soci, cioè
 * dati sanitari. "Difficile da indovinare" non è un controllo d'accesso.
 *
 * ## Perché una firma nell'indirizzo e non un token
 *
 * L'applicazione si autentica con un token nell'intestazione `Authorization`. Ma un file
 * non si chiede con `fetch`: si mette in un `<img src>` o in un `<a href>`, e il browser
 * quelle richieste le manda **senza** intestazioni nostre. Un controllo basato sul token
 * renderebbe quindi invisibili tutte le immagini dell'applicazione.
 *
 * La firma viaggia nell'indirizzo, che è l'unica cosa che il browser porta con sé.
 *
 * ## La scadenza è arrotondata, e non è un dettaglio
 *
 * Se ogni lettura producesse una scadenza diversa, l'indirizzo di una stessa immagine
 * cambierebbe a ogni caricamento della pagina e la cache del browser non servirebbe a
 * niente: la foto di ogni esercizio verrebbe riscaricata ogni volta. Arrotondando la
 * scadenza all'ora, lo stesso file ha lo stesso indirizzo per tutta l'ora — si mette in
 * cache — e smette comunque di funzionare poco dopo.
 */

const DURATA_MS = 12 * 60 * 60 * 1000; // dodici ore: una giornata di lavoro, non di più
const ARROTONDAMENTO_MS = 60 * 60 * 1000; // all'ora, per non rompere la cache del browser

function chiave() {
	// Stessa scelta fatta per il codice d'accesso: se manca una chiave dedicata si usa
	// quella dei token, perché un aggiornamento non deve rendere illeggibili i file.
	return config.qrSecret || config.jwtSecret;
}

/** Il nome del file dentro un indirizzo: è quello su cui si firma. */
export function nomeFileDa(url) {
	if (!url) return null;
	const senzaQuery = String(url).split('?')[0];
	const pezzi = senzaQuery.split('/uploads/');
	return pezzi.length > 1 ? pezzi[pezzi.length - 1] : null;
}

function firmaDi(nomeFile, scadenza) {
	return createHmac('sha256', chiave()).update(`${nomeFile}:${scadenza}`).digest('hex').slice(0, 32);
}

function prossimaScadenza(adesso = Date.now()) {
	return Math.ceil((adesso + DURATA_MS) / ARROTONDAMENTO_MS) * ARROTONDAMENTO_MS;
}

/**
 * Aggiunge la firma a un indirizzo di file. Se non è un file caricato, lo lascia com'è.
 */
export function firmaUrl(url, adesso = Date.now()) {
	const nome = nomeFileDa(url);
	if (!nome) return url;
	const scade = prossimaScadenza(adesso);
	const base = String(url).split('?')[0];
	return `${base}?scade=${scade}&firma=${firmaDi(nome, scade)}`;
}

/**
 * Toglie la firma da un indirizzo.
 *
 * Serve in scrittura: le schermate del gestionale rileggono l'indirizzo dell'immagine di un
 * esercizio, lo mettono in un campo del modulo e lo risalvano com'è. Senza questo, nel
 * database finirebbe un indirizzo con dentro una firma scaduta — cioè un'immagine che
 * smette di vedersi il giorno dopo, senza che nessuno abbia toccato niente.
 */
export function togliFirma(url) {
	if (!url || !nomeFileDa(url)) return url;
	return String(url).split('?')[0];
}

/** Vera se la firma è quella giusta e non è scaduta. */
export function firmaValida(nomeFile, scade, firma) {
	const scadenza = Number(scade);
	if (!nomeFile || !firma || !Number.isFinite(scadenza)) return false;
	if (scadenza < Date.now()) return false;

	const attesa = Buffer.from(firmaDi(nomeFile, scadenza));
	const ricevuta = Buffer.from(String(firma));
	// Confronto a tempo costante: su un valore che si può provare quante volte si vuole,
	// la differenza di tempo fra due stringhe direbbe quanti caratteri iniziali erano giusti.
	return attesa.length === ricevuta.length && timingSafeEqual(attesa, ricevuta);
}

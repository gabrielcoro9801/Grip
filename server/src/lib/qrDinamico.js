// La derivazione del codice d'accesso che cambia ogni minuto.
//
// Vive **solo qui**, sul server, perché è l'unica cosa che rende sicuro tutto il
// meccanismo. La versione precedente la calcolava nel browser con un semplice SHA-256 di
// `seme:finestra`: il seme era scritto in chiaro dentro al codice mostrato e la formula
// era pubblica, quindi chiunque ricevesse uno screenshot poteva calcolare il codice di
// qualunque minuto, per sempre. L'interfaccia intanto prometteva l'esatto contrario.
//
// Con un HMAC il seme dentro al codice torna a essere quello che dice di essere — un
// identificativo, come un nome utente — e la parte che non si può indovinare dipende da
// una chiave che dal server non esce mai.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import {
	ALFABETO,
	LUNGHEZZA_TOKEN,
	TOLLERANZA_FINESTRE,
	finestraCorrente,
} from '../../../shared/qrDinamico.js';

function chiave() {
	// In mancanza di QR_SECRET si usa il segreto dei token: due usi per una chiave sola non
	// è una bella cosa, ma un aggiornamento non deve lasciare i soci fuori dalla porta.
	return config.qrSecret || config.jwtSecret;
}

function token(seme, finestra) {
	const digest = createHmac('sha256', chiave()).update(`${seme}:${finestra}`).digest();
	let out = '';
	for (let i = 0; i < LUNGHEZZA_TOKEN; i++) out += ALFABETO[digest[i] % ALFABETO.length];
	return out;
}

/** Il codice da mostrare in questo minuto: identificativo del socio più token firmato. */
export function codiceDinamico(seme, finestra = finestraCorrente()) {
	if (!seme) return null;
	return `${seme}-${token(seme, finestra)}`;
}

/**
 * Confronto a tempo costante fra due codici.
 *
 * Un `===` su una stringa esce al primo carattere diverso, e la differenza di tempo
 * lascia intravedere quanti caratteri iniziali erano giusti: con sei caratteri e un
 * lettore che si può interrogare quante volte si vuole, è un margine che non conviene
 * regalare.
 */
function ugualiATempoCostante(a, b) {
	const primo = Buffer.from(String(a));
	const secondo = Buffer.from(String(b));
	if (primo.length !== secondo.length) return false;
	return timingSafeEqual(primo, secondo);
}

/** Se il codice scansionato è quello di adesso, o del minuto appena passato. */
export function verificaCodice(seme, scansionato, adesso = Date.now()) {
	if (!seme || !scansionato) return false;
	const corrente = finestraCorrente(adesso);
	let valido = false;
	for (let indietro = 0; indietro <= TOLLERANZA_FINESTRE; indietro++) {
		// Nessuna uscita anticipata: si controllano sempre tutte le finestre, o il tempo di
		// risposta direbbe quale delle due ha fatto scattare la verifica.
		if (ugualiATempoCostante(scansionato, codiceDinamico(seme, corrente - indietro))) valido = true;
	}
	return valido;
}

/** Il seme contenuto in un codice mostrato, cioè tutto tranne il token finale. */
export function semeDelCodice(codice) {
	const scritto = String(codice ?? '').trim().toUpperCase();
	const taglio = scritto.lastIndexOf('-');
	if (taglio <= 0) return null;
	return scritto.slice(0, taglio);
}

// Il codice che il socio mostra all'ingresso cambia ogni minuto.
//
// Il QR statico aveva un difetto che nessun controllo alla porta poteva correggere: una
// volta fotografato valeva per sempre, e uno screenshot girato in chat faceva entrare
// chiunque. Qui il codice mostrato non è più la credenziale: è derivato da quella e dal
// minuto corrente, come fanno le app di autenticazione a due fattori.
//
// **Derivazione, non registrazione.** Nessuno scrive niente in banca dati a ogni minuto, e
// i due lati — il portale del socio e il gestionale della reception — calcolano lo stesso
// valore dallo stesso seme senza doversi parlare. È questo che li tiene allineati: non una
// sincronizzazione, ma il fatto che partano dagli stessi due ingressi.
//
// Il seme resta `qr_accessi.codice`: la credenziale permanente, che si revoca e si
// rigenera come prima. Quello che scade ogni minuto è solo la sua proiezione.

/** Quanto vale un codice. Un minuto: abbastanza per scansionarlo, poco per condividerlo. */
export const DURATA_FINESTRA_MS = 60_000;

/**
 * Quante finestre passate restano valide.
 *
 * Senza tolleranza, un codice inquadrato al secondo 59 e letto al secondo 61 risulterebbe
 * falso — e il socio si sentirebbe rispondere "non valido" con il codice giusto in mano.
 * Una finestra copre sia la scansione lenta sia i due orologi che non coincidono.
 */
export const TOLLERANZA_FINESTRE = 1;

// Niente I, O, 0, 1: a chi legge il codice a voce alla reception si confondono.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LUNGHEZZA_TOKEN = 6;

/** L'indice del minuto corrente. Uguale ovunque, perché parte dall'epoch e non dal fuso. */
export function finestraCorrente(adesso = Date.now()) {
	return Math.floor(adesso / DURATA_FINESTRA_MS);
}

/** Quanto manca al prossimo cambio, per il conto alla rovescia sullo schermo. */
export function msResiduiFinestra(adesso = Date.now()) {
	return DURATA_FINESTRA_MS - (adesso % DURATA_FINESTRA_MS);
}

async function token(seme, finestra) {
	const dati = new TextEncoder().encode(`${seme}:${finestra}`);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', dati));
	let out = '';
	for (let i = 0; i < LUNGHEZZA_TOKEN; i++) out += ALFABETO[digest[i] % ALFABETO.length];
	return out;
}

/**
 * Il codice da mostrare: la credenziale permanente più il token del minuto.
 *
 * Il seme resta in chiaro dentro al codice perché è ciò che identifica il socio a chi
 * controlla; è il token che dice se il codice è di adesso.
 */
export async function codiceDinamico(seme, finestra = finestraCorrente()) {
	if (!seme) return null;
	return `${seme}-${await token(seme, finestra)}`;
}

/**
 * Se il codice scansionato è quello di adesso (o del minuto appena passato).
 *
 * Vive qui, e non nel browser, perché il controllo vero appartiene a chi apre la porta:
 * quando ci sarà un lettore all'ingresso userà questa, non una copia sua.
 */
export async function verificaCodice(seme, scansionato, adesso = Date.now()) {
	if (!seme || !scansionato) return false;
	const corrente = finestraCorrente(adesso);
	for (let indietro = 0; indietro <= TOLLERANZA_FINESTRE; indietro++) {
		if (scansionato === (await codiceDinamico(seme, corrente - indietro))) return true;
	}
	return false;
}

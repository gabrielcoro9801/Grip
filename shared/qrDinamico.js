// Il codice che il socio mostra all'ingresso cambia ogni minuto.
//
// Il QR statico aveva un difetto che nessun controllo alla porta poteva correggere: una
// volta fotografato valeva per sempre, e uno screenshot girato in chat faceva entrare
// chiunque. Il codice mostrato non è più la credenziale: è derivato da quella e dal minuto
// corrente, come fanno le app di autenticazione a due fattori.
//
// **La derivazione sta sul server, non qui.** La prima versione calcolava il token nel
// browser con un digest non chiavato: il seme viaggiava in chiaro dentro al codice
// mostrato e la formula era pubblica, quindi da uno screenshot si ricavavano tutti i
// codici futuri — esattamente ciò che il modulo diceva di impedire. Ora il token è un HMAC
// con un segreto che vive solo sul server (server/src/lib/qrDinamico.js): il seme dentro
// al codice resta visibile ma è solo un identificativo, come un nome utente, e senza la
// chiave non produce nulla.
//
// Qui resta la sola aritmetica delle finestre, che serve al conto alla rovescia a schermo
// e non è un segreto.

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
export const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LUNGHEZZA_TOKEN = 6;

/** L'indice del minuto corrente. Uguale ovunque, perché parte dall'epoch e non dal fuso. */
export function finestraCorrente(adesso = Date.now()) {
	return Math.floor(adesso / DURATA_FINESTRA_MS);
}

/** Quanto manca al prossimo cambio, per il conto alla rovescia sullo schermo. */
export function msResiduiFinestra(adesso = Date.now()) {
	return DURATA_FINESTRA_MS - (adesso % DURATA_FINESTRA_MS);
}

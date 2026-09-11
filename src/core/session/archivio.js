/**
 * Dove si tiene il token fra un'apertura e l'altra.
 *
 * core/ non lo sa e non deve saperlo: sul web è `localStorage`, su un telefono sarà
 * SecureStore o AsyncStorage, in un test è una mappa in memoria. Chi avvia l'applicazione
 * ne passa uno con `impostaArchivio`.
 *
 * **L'interfaccia è asincrona, e non per moda.** `localStorage` risponde subito, ma le
 * cassette di sicurezza dei telefoni no: se questa interfaccia fosse sincrona, un domani
 * non si potrebbe implementarla e ci si troverebbe a dover riscrivere tutto ciò che la usa.
 * Meglio pagare adesso il costo di tre `await` che stanno in un punto solo.
 *
 * Il resto dell'applicazione non se ne accorge perché il token, una volta letto all'avvio,
 * vive in memoria: vedi `sessione.js`.
 */

/** L'archivio predefinito: tiene tutto in memoria e dimentica alla chiusura. */
function archivioInMemoria() {
	const dati = new Map();
	return {
		async leggi(chiave) {
			return dati.has(chiave) ? dati.get(chiave) : null;
		},
		async scrivi(chiave, valore) {
			dati.set(chiave, valore);
		},
		async cancella(chiave) {
			dati.delete(chiave);
		},
	};
}

let archivio = archivioInMemoria();

export function impostaArchivio(nuovo) {
	if (!nuovo?.leggi || !nuovo?.scrivi || !nuovo?.cancella) {
		throw new Error('Un archivio deve avere leggi, scrivi e cancella.');
	}
	archivio = nuovo;
}

export function archivioCorrente() {
	return archivio;
}

/**
 * L'archivio può non funzionare: navigazione privata, cookie bloccati, spazio esaurito.
 *
 * Non è un caso limite teorico — è il browser di qualcuno, stamattina. La risposta giusta
 * è sempre la stessa: si resta senza sessione, cioè si rivede la schermata di accesso, e
 * l'applicazione funziona. Non si esplode, e non si interrompe l'avvio.
 */
export async function leggiInSicurezza(chiave) {
	try {
		return await archivio.leggi(chiave);
	} catch {
		return null;
	}
}

export async function scriviInSicurezza(chiave, valore) {
	try {
		if (valore) await archivio.scrivi(chiave, valore);
		else await archivio.cancella(chiave);
	} catch {
		// L'accesso non verrà ricordato alla prossima apertura. È tutto.
	}
}

import { api } from './client.js';

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

/** Anagrafica, abbonamento in corso e riepilogo dei documenti: la schermata iniziale. */
export function caricaProfilo() {
	return api.richiesta(`${BASE}/profilo`);
}

/** Lo storico degli abbonamenti. */
export async function caricaAbbonamenti() {
	const { abbonamenti } = await api.richiesta(`${BASE}/abbonamenti`);
	return abbonamenti;
}

/** I propri documenti, con scadenze già valutate dal server. */
export async function caricaDocumenti() {
	const { documenti } = await api.richiesta(`${BASE}/documenti`);
	return documenti;
}

/**
 * Il codice d'accesso del minuto corrente.
 *
 * Il codice lo firma il server: qui non si calcola niente, si chiede. `valido_per_ms` dice
 * quanto manca alla fine della finestra, ed è ciò su cui la schermata fa il conto alla
 * rovescia senza doversi sincronizzare con l'orologio del server.
 */
export function caricaAccesso() {
	return api.richiesta(`${BASE}/accesso`);
}

/**
 * Le lezioni prenotabili in un intervallo, già raggruppate per giorno e con i posti contati.
 *
 * Sostituisce sette richieste e l'incrocio che il browser faceva a mano — incluso lo
 * scaricamento di tutte le prenotazioni altrui per contare i posti liberi.
 */
export function caricaAgenda({ dal, al } = {}) {
	const parametri = new URLSearchParams();
	if (dal) parametri.set('dal', dal);
	if (al) parametri.set('al', al);
	const coda = parametri.toString();
	return api.richiesta(`${BASE}/corsi/agenda${coda ? `?${coda}` : ''}`);
}

export function prenotaLezione(idLezione) {
	return api.richiesta(`${BASE}/corsi/lezioni/${idLezione}/prenota`, { method: 'POST' });
}

export function disdiciPrenotazione(idPrenotazione) {
	return api.richiesta(`${BASE}/corsi/prenotazioni/${idPrenotazione}/disdici`, { method: 'POST' });
}

/** Schede, allenamento eventualmente lasciato aperto, storico, record e conti della settimana. */
export function caricaAllenamento() {
	return api.richiesta(`${BASE}/allenamento`);
}

/** Le serie fatte su un solo esercizio: quanto basta per disegnarne il grafico. */
export async function caricaProgressiEsercizio(nome) {
	const { serie } = await api.richiesta(`${BASE}/allenamento/progressi?esercizio=${encodeURIComponent(nome)}`);
	return serie;
}

/** Un allenamento da eseguire o riprendere, con le serie già spuntate e quelle della volta prima. */
export function caricaSessioneAllenamento(id) {
	return api.richiesta(`${BASE}/allenamento/sessioni/${id}`);
}

/** Annulla un allenamento: la sessione e tutte le sue serie, in una transazione sola. */
export function annullaSessioneAllenamento(id) {
	return api.richiesta(`${BASE}/allenamento/sessioni/${id}`, { method: 'DELETE' });
}

/**
 * Registra una serie appena fatta.
 *
 * Si manda solo quello che si è osservato — peso, ripetizioni, sforzo. A chi appartiene la
 * serie e a quale scheda lo decide il server leggendo la sessione: un identificativo che
 * parte da qui sarebbe un identificativo che si può cambiare.
 */
export async function registraSerie(idSessione, dati) {
	const { serie } = await api.richiesta(`${BASE}/allenamento/sessioni/${idSessione}/serie`, {
		method: 'POST',
		body: dati,
	});
	return serie;
}

/** Corregge una serie già registrata: capita di sbagliare a digitare sotto il bilanciere. */
export async function correggiSerie(idSerie, cambi) {
	const { serie } = await api.richiesta(`${BASE}/allenamento/serie/${idSerie}`, {
		method: 'PATCH',
		body: cambi,
	});
	return serie;
}

/** Toglie una serie: la spunta si può sempre togliere. */
export function eliminaSerie(idSerie) {
	return api.richiesta(`${BASE}/allenamento/serie/${idSerie}`, { method: 'DELETE' });
}

/** Chiude l'allenamento. L'ora di fine la mette il server, non l'orologio del telefono. */
export async function terminaSessioneAllenamento(idSessione, { note } = {}) {
	const { sessione } = await api.richiesta(`${BASE}/allenamento/sessioni/${idSessione}/termina`, {
		method: 'POST',
		body: { note },
	});
	return sessione;
}

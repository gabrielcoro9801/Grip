// Client applicativo verso il backend Grip (cartella server/).
// Espone `entities`, `auth` e `integrations`, cioè l'intera superficie che l'app usa.
//
// La forma dei metodi è volutamente identica a quella usata in tutta l'applicazione
// (list/filter/get/create/update/delete/bulkCreate), così le pagine e i componenti
// non hanno dovuto cambiare logica quando il datastore è stato sostituito.
/**
 * Dove sta il backend.
 *
 * In produzione è **lo stesso indirizzo del sito**: il server Fastify serve sia le pagine
 * sia l'API, quindi basta un percorso relativo — vuoto, che è il valore predefinito qui
 * sotto. Da lì discendono due semplificazioni che valgono più di quanto sembri: niente CORS
 * da configurare, perché non c'è nessuna chiamata fra domini diversi, e nessun indirizzo da
 * tenere aggiornato in due posti.
 *
 * In sviluppo invece sono due processi separati (Vite sulla 5173, il server sulla 3001), e
 * l'indirizzo serve per forza.
 *
 * Perché arriva da fuori invece di essere letto qui. Prima questa riga diceva
 * `import.meta.env.VITE_API_BASE_URL`, che è una cosa di Vite: fuori da Vite `import.meta.env`
 * non esiste proprio, e il file non si poteva nemmeno caricare — l'ha scoperto il primo test
 * che ha provato a importarlo con `node --test`. Un'app su telefono avrebbe avuto lo stesso
 * problema, ma se ne sarebbe accorta molto più tardi. Ora la domanda "dove sta il backend"
 * la risponde chi avvia l'applicazione, che è l'unico a saperlo.
 *
 * Nota per il giorno del telefono: là il percorso relativo non vuol dire niente, e questo
 * valore dovrà essere un indirizzo assoluto.
 */
let API_BASE = '';

export function configuraRete({ baseUrl = '' } = {}) {
	API_BASE = baseUrl;
}

// La sessione — quale area, quale token, dove si ricorda — vive in core/session. Qui si
// riesporta perché le pagine hanno sempre chiesto il token al client, e non c'è ragione di
// far cambiare quell'abitudine a quaranta file.
import { getToken, setToken } from '../session/sessione.js';

export { getToken, setToken };

function authHeaders() {
	const token = getToken();
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers: {
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			...authHeaders(),
			...headers,
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});

	if (!res.ok) {
		const payload = await res.json().catch(() => ({}));
		const error = new Error(payload.error || `Errore HTTP ${res.status}`);
		error.status = res.status;
		// Il codice del rifiuto, quando il server lo manda: le schermate decidono su quello e non
		// sul testo del messaggio, che può cambiare parole senza cambiare significato.
		if (payload.code) error.code = payload.code;
		throw error;
	}

	// 204 e simili non hanno corpo: leggerli come JSON solleverebbe un errore.
	if (res.status === 204) return null;
	return res.json();
}

function buildEntityClient(name) {
	const base = `/api/entities/${name}`;

	// list() e filter() condividono la stessa query string: filter aggiunge solo i
	// criteri di uguaglianza ai parametri di ordinamento/limite.
	const buildQuery = (filters, sort, limit) => {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(filters ?? {})) {
			if (value !== undefined && value !== null) params.set(key, String(value));
		}
		if (sort) params.set('_sort', sort);
		if (limit) params.set('_limit', String(limit));
		const qs = params.toString();
		return qs ? `${base}?${qs}` : base;
	};

	return {
		list: (sort, limit) => request(buildQuery(null, sort, limit)),
		filter: (query = {}, sort, limit) => request(buildQuery(query, sort, limit)),
		get: (id) => request(`${base}/${id}`),
		create: (data) => request(base, { method: 'POST', body: data }),
		update: (id, data) => request(`${base}/${id}`, { method: 'PUT', body: data }),
		delete: (id) => request(`${base}/${id}`, { method: 'DELETE' }),
		bulkCreate: (items) => request(`${base}/bulk`, { method: 'POST', body: items }),

		// Aggiornamenti in tempo reale non ancora implementati lato server (previsti
		// via SSE/Postgres NOTIFY). Restituisce una funzione di annullamento inerte
		// così i componenti che la usano continuano a funzionare senza modifiche.
		subscribe: () => () => {},
	};
}

const ENTITY_NAMES = [
	'Member', 'Subscription', 'Plan', 'MemberDocument', 'QRAccesso', 'CanaleContatto',
	'Course', 'Category', 'Instructor', 'Event', 'Session', 'Room', 'Booking',
	'StaffAccount',
	'Organization', 'AuditLog',
];

export const api = {
	// Una richiesta qualunque all'API, con il token già attaccato e gli errori già tradotti.
	// La usa `portale.js`, che parla con rotte dedicate invece che con l'endpoint generico
	// delle entità: senza questa, dovrebbe rifarsi da capo la gestione di token ed errori.
	richiesta: request,

	entities: Object.fromEntries(ENTITY_NAMES.map((name) => [name, buildEntityClient(name)])),

	organizzazione: {
		// Crea i ruoli predefiniti per un ente che non li ha ancora. Idempotente.
		bootstrapRuoli(organizationId) {
			return request(`/api/organizations/${organizationId}/bootstrap-ruoli`, { method: 'POST' });
		},
	},

	/**
	 * Prenotare e disdire.
	 *
	 * Non passano da `entities.Booking` perché prenotare non è scrivere una riga: è
	 * decidere se c'è posto, e quel conto va fatto dove nessuno può saltarlo — dentro una
	 * transazione, con la lezione bloccata.
	 */
	prenotazioni: {
		crea({ sessionId, memberId }) {
			return request('/api/prenotazioni', {
				method: 'POST',
				body: { session_id: sessionId, member_id: memberId },
			});
		},
		disdici(bookingId) {
			return request(`/api/prenotazioni/${bookingId}/disdici`, { method: 'POST' });
		},
		/** Solo staff: porta una prenotazione a confirmed / waitlisted / cancelled. → { booking, promossi } */
		cambiaStato(bookingId, stato, { oltreCapienza = false } = {}) {
			return request(`/api/prenotazioni/${bookingId}/stato`, { method: 'POST', body: { stato, oltre_capienza: oltreCapienza } });
		},
		/** Solo staff: sposta in lista d'attesa alla posizione indicata (1 = prima). */
		spostaInLista(bookingId, posizione) {
			return request(`/api/prenotazioni/${bookingId}/posizione`, { method: 'POST', body: { posizione } });
		},
		/** Solo staff: cancella davvero una prenotazione inserita per errore. → { eliminata, promossi } */
		elimina(bookingId) {
			return request(`/api/prenotazioni/${bookingId}`, { method: 'DELETE' });
		},
		/** Le prenotazioni delle lezioni da `dal` (YYYY-MM-DD) in avanti. Solo per lo staff. */
		dal(dal) {
			return request(`/api/prenotazioni?dal=${encodeURIComponent(dal)}`);
		},
	},

	/**
	 * Quello che la scheda di un socio deve sapere e che non sta nella tabella dei soci.
	 *
	 * L'accesso al portale è un account, e gli account si leggono solo da Admin & Utenti:
	 * questa rotta dice alla scheda se l'accesso c'è, con il permesso della scheda.
	 */
	soci: {
		async accessoPortale(memberId) {
			const { account } = await request(`/api/soci/${encodeURIComponent(memberId)}/accesso-portale`);
			return account;
		},
		/** Crea l'accesso al portale o ne reimposta la password. → { account, creato } */
		impostaAccessoPortale(memberId, password) {
			return request(`/api/soci/${encodeURIComponent(memberId)}/accesso-portale`, { method: 'POST', body: { password } });
		},
		/** Archivia un socio che ha lasciato la palestra: { motivo, nota? } → { socio, prenotazioni_disdette } */
		archivia(memberId, corpo) {
			return request(`/api/soci/${encodeURIComponent(memberId)}/archivia`, { method: 'POST', body: corpo });
		},
		/** Le sospensioni dell'abbonamento: { sospensioni: [{ id, dal, al, riprende_il, nota, stato }] } */
		sospensioni(memberId) {
			return request(`/api/soci/${encodeURIComponent(memberId)}/sospensioni`);
		},
		/** { dal, riprende_il, nota? } → { sospensione, prenotazioni_disdette } */
		sospendi(memberId, corpo) {
			return request(`/api/soci/${encodeURIComponent(memberId)}/sospensioni`, { method: 'POST', body: corpo });
		},
		/** Fa riprendere prima (oggi, o `riprende_il`). → { sospensione | null } */
		terminaSospensione(memberId, idSospensione, riprendeIl) {
			return request(`/api/soci/${encodeURIComponent(memberId)}/sospensioni/${idSospensione}/termina`, { method: 'POST', body: riprendeIl ? { riprende_il: riprendeIl } : {} });
		},
		/** Riattiva un socio archiviato. → { socio } */
		riattiva(memberId) {
			return request(`/api/soci/${encodeURIComponent(memberId)}/riattiva`, { method: 'POST' });
		},
	},

	/** La vista dell'istruttore (routes/istruttore.js): le sue lezioni e i soci che ci vengono. */
	istruttore: {
		/** { dal?, al? } → { collegato, istruttore, dal, al, lezioni, spesso } */
		lezioni(filtri = {}) {
			const q = new URLSearchParams(Object.entries(filtri).filter(([, v]) => v)).toString();
			return request(`/api/istruttore/lezioni${q ? `?${q}` : ''}`);
		},
		/** → { socio, note } */
		socio(memberId) {
			return request(`/api/istruttore/soci/${encodeURIComponent(memberId)}`);
		},
		nota(memberId, nota) {
			return request(`/api/istruttore/soci/${encodeURIComponent(memberId)}/note`, { method: 'POST', body: { nota } });
		},
	},

	/**
	 * Iscrivi, in un passo: { lead_id?, anagrafica, abbonamento?, certificato?, informativa_privacy,
	 * consensi?, portale? } → { member, riattivato, accesso_portale }. Tutto in una transazione.
	 */
	iscrivi(corpo) {
		return request('/api/iscrivi', { method: 'POST', body: corpo });
	},

	/**
	 * Numeri e avvisi della dashboard, contati dal server. Una parte che il ruolo non può
	 * vedere arriva `null`.
	 */
	dashboard() {
		return request('/api/dashboard');
	},

	/**
	 * Togliere lezioni e cambiare la data fine di una serie: molte righe insieme — lezioni,
	 * prenotazioni, evento, avvisi ai soci — in una transazione sul server. Con
	 * `anteprima: true` si hanno i conti senza scrivere niente.
	 */
	calendario: {
		/** { lezione_id, ambito: 'lezione' | 'serie', giorni?, anteprima? } → { eliminate, annullate, soci_avvisati, evento_eliminato } */
		elimina(corpo) {
			return request('/api/calendario/elimina', { method: 'POST', body: corpo });
		},
		/** { end_date, salta?, anteprima? } → { aggiunte, eliminate, annullate, soci_avvisati, nuove?, saltate_sala?, modello? } */
		dataFine(idEvento, corpo) {
			return request(`/api/calendario/eventi/${idEvento}/data-fine`, { method: 'POST', body: corpo });
		},
	},

	/** Gli ingressi in palestra (routes/ingressi.js). */
	ingressi: {
		/** { codice } | { member_id, alle? } → { valido, motivo? | socio, semaforo, avvisi, lezioni_oggi, ultimo_ingresso, metodo } */
		verifica(corpo) {
			return request('/api/ingressi/verifica', { method: 'POST', body: corpo });
		},
		/** { member_id, metodo, deroga?, entrato_alle? } → { ingresso } */
		registra(corpo) {
			return request('/api/ingressi', { method: 'POST', body: corpo });
		},
		/** Un ingresso registrato per errore. */
		annulla(id) {
			return request(`/api/ingressi/${encodeURIComponent(id)}`, { method: 'DELETE' });
		},
		/** { dal?, al?, member_id? } → { ingressi } (senza date: oggi) */
		elenco(filtri = {}) {
			const q = new URLSearchParams(Object.entries(filtri).filter(([, v]) => v)).toString();
			return request(`/api/ingressi${q ? `?${q}` : ''}`);
		},
		statistiche(giorni = 30) {
			return request(`/api/ingressi/statistiche?giorni=${giorni}`);
		},
	},

	/** Le prenotazioni fisse viste dal gestionale (routes/prenotazioniFisse.js). */
	prenotazioniFisse: {
		/** { member_id?, event_id? } → { fisse } (le attive) */
		elenco(filtri = {}) {
			const q = new URLSearchParams(Object.entries(filtri).filter(([, v]) => v)).toString();
			return request(`/api/prenotazioni-fisse${q ? `?${q}` : ''}`);
		},
		/** { member_id, event_id, giorni? } → { fissa, prenotate, in_attesa, senza_abbonamento } */
		crea(corpo) {
			return request('/api/prenotazioni-fisse', { method: 'POST', body: corpo });
		},
		/** → { disdette, rimaste } */
		termina(id) {
			return request(`/api/prenotazioni-fisse/${id}`, { method: 'DELETE' });
		},
	},

	/** Quanto è usata ogni sala, contato dal server sull'intero calendario. */
	sale: {
		uso() {
			return request('/api/sale/uso');
		},
	},

	/**
	 * I contatti (lead). Non passano da `entities`: un lead è una persona più una sua trattativa,
	 * e il server le scrive insieme, in una transazione.
	 */
	lead: {
		/** Un contatto nuovo, o una trattativa nuova su una persona già nota ({ persona_id, … }). → { lead } */
		crea(dati) {
			return request('/api/lead', { method: 'POST', body: dati });
		},
		/** Corregge dati del contatto e della trattativa. → { lead } */
		aggiorna(leadId, dati) {
			return request(`/api/lead/${leadId}`, { method: 'PUT', body: dati });
		},
		elimina(leadId) {
			return request(`/api/lead/${leadId}`, { method: 'DELETE' });
		},
		/** Le persone già note con quel telefono o quella email: { doppioni: [{ persona_id, nome, tipo, trattativa_aperta_id }] }. */
		doppioni({ telefono, email, escludi }) {
			const q = new URLSearchParams(Object.entries({ telefono, email, escludi }).filter(([, v]) => v));
			return request(`/api/lead/doppioni?${q}`);
		},
		/** Quanti contatti e quanti soci cita ogni canale: { [idCanale]: { contatti, soci } }. */
		usoCanali() {
			return request('/api/lead/canali/uso');
		},
		/** I lead col loro stato, i conteggi dei filtri rapidi e le soglie con cui sono contati: { leads, conteggi, soglie }. */
		lavoro() {
			return request('/api/lead/lavoro');
		},
		/** Un'azione che cambia lo stato: 'contatto' | 'richiamo' | 'chiudi' | 'riapri'. → { lead } */
		azione(leadId, nome, corpo = {}) {
			return request(`/api/lead/${leadId}/${nome}`, { method: 'POST', body: corpo });
		},
		/** Le righe anonime della pagina Andamento, e i canali: { righe, canali }. */
		andamento() {
			return request('/api/lead/andamento');
		},
		/** Il diario della persona del lead, dal più vecchio: { attivita }. */
		attivita(leadId) {
			return request(`/api/lead/${leadId}/attivita`);
		},
	},

	/** La storia di una persona per la segreteria: diario e consensi. */
	persone: {
		/** { attivita } */
		diario(personaId) {
			return request(`/api/persone/${personaId}/diario`);
		},
		nota(personaId, nota) {
			return request(`/api/persone/${personaId}/note`, { method: 'POST', body: { nota } });
		},
		/** I consensi di oggi e il registro intero. → { consensi, storico } */
		consensi(personaId) {
			return request(`/api/persone/${personaId}/consensi`);
		},
		/**
		 * Un consenso raccolto in reception (con il modulo firmato già fra i documenti) o la sua
		 * revoca (con il motivo): { tipi, valore, documento_id?, nota?, atteso } → { consensi }.
		 * 409 se il socio ha cambiato le sue scelte dal portale nel frattempo.
		 */
		registraConsensi(personaId, corpo) {
			return request(`/api/persone/${personaId}/consensi`, { method: 'POST', body: corpo });
		},
		/**
		 * Il "Fatto" su una cosa da fare: { canale, segnale, esito? } → { attivita }. Nasconde per
		 * qualche giorno quel segnale, e solo lui.
		 */
		fatto(personaId, corpo) {
			return request(`/api/persone/${personaId}/contatti`, { method: 'POST', body: corpo });
		},

		/** La ricerca di Ctrl+K: nome, telefono, codice fiscale o codice socio. → { risultati } */
		cerca(q) {
			return request(`/api/persone/cerca?q=${encodeURIComponent(q)}`);
		},
	},

	/** Le impostazioni di Da fare: soglie e segnali spenti. → { soglie, predefinite, segnali_spenti } */
	impostazioni: {
		daFare() { return request('/api/impostazioni/da-fare'); },
		salvaDaFare(corpo) { return request('/api/impostazioni/da-fare', { method: 'PUT', body: corpo }); },
	},

	/**
	 * Le comunicazioni automatiche (shared/comunicazioni.js): solo l'amministratore. Ogni scrittura
	 * restituisce la sezione intera, aggiornata. Le credenziali si mandano e non tornano mai.
	 */
	comunicazioni: {
		leggi() { return request('/api/comunicazioni'); },
		regole(corpo) { return request('/api/comunicazioni/regole', { method: 'PUT', body: corpo }); },
		canale(canale, corpo) { return request(`/api/comunicazioni/canali/${canale}`, { method: 'PUT', body: corpo }); },
		/** L'invio di prova: → { simulato, a, testo? } (il testo solo se simulato, per leggerne il codice). */
		prova(canale, a) { return request(`/api/comunicazioni/canali/${canale}/prova`, { method: 'POST', body: { a } }); },
		verifica(canale, codice) { return request(`/api/comunicazioni/canali/${canale}/verifica`, { method: 'POST', body: { codice } }); },
		playbook(codice, stato) { return request(`/api/comunicazioni/playbook/${codice}`, { method: 'PUT', body: { stato } }); },
		salvaTesto(codice, canale, corpo) { return request(`/api/comunicazioni/modelli/${codice}/${canale}`, { method: 'PUT', body: corpo }); },
		testoPredefinito(codice, canale) { return request(`/api/comunicazioni/modelli/${codice}/${canale}`, { method: 'DELETE' }); },
		conferma(voce, fatta) { return request('/api/comunicazioni/conferme', { method: 'PUT', body: { voce, fatta } }); },
		interruttore(attive) { return request('/api/comunicazioni/interruttore', { method: 'PUT', body: { attive } }); },
		/** "Domani sarebbero partiti N messaggi" → { giorno, totale, per_canale, bloccati, senza_canale, esempi } */
		anteprima(codice) { return request(`/api/comunicazioni/anteprima/${codice}`); },
		anteprimaTesto(corpo) { return request('/api/comunicazioni/anteprima-testo', { method: 'POST', body: corpo }); },
		messaggi(mese) { return request(`/api/comunicazioni/messaggi${mese ? `?mese=${mese}` : ''}`); },
	},

	/**
	 * Chi va seguito, e perché (shared/segnali.js).
	 * { persona?, tipo?: 'soci'|'lead', fase?, segnale?, pubblico?, da_fare? } → { oggi, persone, conteggi }
	 */
	segnali(filtri = {}) {
		const q = new URLSearchParams(Object.entries(filtri).filter(([, v]) => v)).toString();
		return request(`/api/segnali${q ? `?${q}` : ''}`);
	},

	/**
	 * Il codice d'accesso che cambia ogni minuto.
	 *
	 * Passa dal server perché è lì che vive la chiave con cui viene firmato: derivarlo nel
	 * browser vorrebbe dire spedire quella chiave a ogni visitatore.
	 */
	qr: {
		codice(clienteId) {
			const qs = clienteId ? `?cliente_id=${encodeURIComponent(clienteId)}` : '';
			return request(`/api/qr/codice${qs}`);
		},
		/** Se il codice che si ha davanti vale adesso, e di chi è. Solo per lo staff. */
		verifica(codice) {
			return request('/api/qr/verifica', { method: 'POST', body: { codice } });
		},
	},

	// Configurazione dei ruoli: la matrice dei permessi non è più una costante del codice.
	ruoli: {
		lista(organizationId) {
			return request(`/api/ruoli?organization_id=${organizationId}`);
		},
		salva(id, dati) {
			return request(`/api/ruoli/${id}`, { method: 'PUT', body: dati });
		},
		crea(dati) {
			return request('/api/ruoli', { method: 'POST', body: dati });
		},
		elimina(id) {
			return request(`/api/ruoli/${id}`, { method: 'DELETE' });
		},
	},

	auth: {
		async login(email, password) {
			const { token, user } = await request('/api/auth/login', {
				method: 'POST',
				body: { email, password },
			});
			setToken(token);
			return user;
		},

		async me() {
			const { user } = await request('/api/auth/me');
			return user;
		},

		logout() {
			setToken(null);
		},

		/**
		 * Cambia la propria password. Il server chiude tutte le sessioni dell'account e
		 * restituisce un token nuovo per questa: lo si tiene, e si resta dentro.
		 */
		async changePassword(currentPassword, newPassword) {
			const { token, user } = await request('/api/auth/change-password', {
				method: 'POST',
				body: { current_password: currentPassword, new_password: newPassword },
			});
			setToken(token);
			return user;
		},

		isAuthenticated() {
			return Boolean(getToken());
		},
	},

};

// Il caricamento di file non sta più qui: usa `FormData`, che è del browser, e lo fa solo il
// gestionale (al socio il server risponde 403). Vive in `src/staff/lib/uploads.js`, e queste
// due funzioni sono quanto gli serve da qui.
export function indirizzoApi() {
	return API_BASE;
}

export function intestazioniAutenticazione() {
	return authHeaders();
}

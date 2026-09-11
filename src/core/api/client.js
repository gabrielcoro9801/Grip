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

/**
 * Due sessioni, due chiavi.
 *
 * Prima ce n'era una sola, `grip_auth_token`, per lo staff e per i soci. Sembra un
 * dettaglio e non lo è: chi lavora in palestra e ha anche un suo abbonamento non poteva
 * tenere aperti il gestionale e il portale nello stesso browser — entrare da una parte
 * buttava fuori dall'altra, perché il secondo accesso sovrascriveva il token del primo.
 *
 * La chiave non si sceglie guardando dentro al token: si sceglie in base all'**area** in cui
 * l'applicazione sta girando, che è un'informazione che core/ non può ricavare da sé (non
 * sa cosa sia un indirizzo web, e sul telefono non ci sarebbe comunque). Gliela passa chi
 * avvia l'applicazione, con `impostaArea`.
 */
const CHIAVI = {
	staff: 'grip_staff_token',
	member: 'grip_member_token',
};

// La chiave di prima. Serve solo alla migrazione qui sotto, e si potrà togliere — insieme a
// `migraSessioneVecchia` — passato qualche mese dal rilascio (settembre 2026).
const CHIAVE_VECCHIA = 'grip_auth_token';

let areaCorrente = 'staff';

/**
 * Dice a quale delle due applicazioni appartengono le chiamate che seguono.
 * La chiama chi avvia l'interfaccia, una volta sola, prima del primo disegno.
 */
export function impostaArea(area) {
	if (!CHIAVI[area]) throw new Error(`Area sconosciuta: ${area}`);
	areaCorrente = area;
}

export function areaAttiva() {
	return areaCorrente;
}

/* eslint-disable no-undef -- Le uniche righe di core/ che parlano col browser, e sono qui
   di proposito, segnalate invece che nascoste.

   core/ deve girare anche dove `localStorage` non esiste: su un telefono il token si tiene
   in SecureStore, che per giunta ha un'interfaccia asincrona. La forma giusta è che il
   token venga tenuto in memoria e che chi avvia l'applicazione passi da fuori uno spazio di
   archiviazione — così questo file non sa più su cosa scrive.
   Finché quel lavoro non è fatto, queste righe restano l'unica dipendenza dal browser in
   tutto core/, e il lint le rende impossibili da dimenticare. */
function leggi(chiave) {
	try {
		return localStorage.getItem(chiave);
	} catch {
		// Navigazione privata o cookie bloccati: si resta senza sessione, non si esplode.
		return null;
	}
}

function scrivi(chiave, valore) {
	try {
		if (valore) localStorage.setItem(chiave, valore);
		else localStorage.removeItem(chiave);
	} catch {
		// Come sopra: l'applicazione funziona lo stesso, solo non ricorda l'accesso.
	}
}

/**
 * Porta avanti chi era già connesso quando c'era una chiave sola.
 *
 * Il token vecchio viene copiato in **entrambe** le chiavi nuove, e quella vecchia
 * cancellata. Sembra sbagliato dare a tutte e due lo stesso token, e invece è la cosa
 * semplice che funziona: nessuno deve aprire il token e interpretarne il contenuto — cosa
 * che richiederebbe di decodificarlo e di fidarsene — perché a dire chi è quel token ci
 * pensa `/api/auth/me`, che rilegge l'account dal database. L'area a cui non appartiene lo
 * scarta al primo controllo e cancella la propria chiave.
 *
 * In pratica: chi era dentro resta dentro, e chi era entrato come socio, la prima volta che
 * apre il gestionale, trova la schermata di accesso — che è il comportamento giusto.
 */
export function migraSessioneVecchia() {
	const vecchio = leggi(CHIAVE_VECCHIA);
	if (!vecchio) return;
	if (leggi(CHIAVI.staff) || leggi(CHIAVI.member)) {
		// Migrazione già avvenuta: la chiave vecchia è un residuo.
		scrivi(CHIAVE_VECCHIA, null);
		return;
	}
	scrivi(CHIAVI.staff, vecchio);
	scrivi(CHIAVI.member, vecchio);
	scrivi(CHIAVE_VECCHIA, null);
}
/* eslint-enable no-undef */

export function getToken() {
	return leggi(CHIAVI[areaCorrente]);
}

export function setToken(token) {
	scrivi(CHIAVI[areaCorrente], token);
}

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
	'Member', 'Subscription', 'Plan', 'MemberDocument', 'QRAccesso',
	'Course', 'Category', 'Instructor', 'Event', 'Session', 'Room', 'Booking',
	'Collaboratore', 'StaffAccount',
	'Exercise', 'ExercisePlan', 'WorkoutSession', 'WorkoutLog',
	'Organization', 'AuditLog',
];

export const api = {
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

		changePassword(currentPassword, newPassword) {
			return request('/api/auth/change-password', {
				method: 'POST',
				body: { current_password: currentPassword, new_password: newPassword },
			});
		},

		isAuthenticated() {
			return Boolean(getToken());
		},
	},

	integrations: {
		Core: {
			// Stessa firma e stessa forma di risposta ({ file_url }) dei punti che la
			// usano già per i documenti dei soci e il logo dell'organizzazione.
			async UploadFile({ file }) {
				// `FormData` è del browser. Il caricamento di file lo fa solo il gestionale
				// (al socio il server risponde 403), quindi questo metodo seguirà lo staff
				// quando il client verrà diviso in due.
				// eslint-disable-next-line no-undef
				const form = new FormData();
				form.append('file', file);
				const res = await fetch(`${API_BASE}/api/uploads`, {
					method: 'POST',
					headers: authHeaders(), // niente Content-Type: lo imposta il browser col boundary
					body: form,
				});
				if (!res.ok) {
					const payload = await res.json().catch(() => ({}));
					throw new Error(payload.error || `Upload fallito (HTTP ${res.status})`);
				}
				return res.json();
			},
		},
	},
};

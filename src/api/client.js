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
 * sia l'API, quindi basta un percorso relativo. Da lì discendono due semplificazioni che
 * valgono più di quanto sembri — niente CORS da configurare, perché non c'è nessuna chiamata
 * fra domini diversi, e nessun indirizzo da tenere aggiornato in due posti.
 *
 * In sviluppo invece sono due processi separati (Vite sulla 5173, il server sulla 3001), e
 * l'indirizzo serve per forza. `VITE_API_BASE_URL` resta come scappatoia se un giorno si
 * volessero separare di nuovo.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL
	?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

const TOKEN_KEY = 'grip_auth_token';

export function getToken() {
	return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
	if (token) localStorage.setItem(TOKEN_KEY, token);
	else localStorage.removeItem(TOKEN_KEY);
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
	'Member', 'Client', 'Subscription', 'Plan', 'MemberDocument', 'QRAccesso',
	'Course', 'Category', 'Instructor', 'Event', 'Session', 'Room', 'Booking',
	'ChartOfAccount', 'CausaleOperativa', 'JournalEntry', 'JournalLine', 'Loan', 'LoanInstallment',
	'AccountingSupplier', 'FixedAsset', 'PurchaseOrder', 'Bank', 'ExerciseClosure', 'JournalAttachment',
	'FiscalProfileSnapshot', 'FiscalYearData', 'ParametroFiscale', 'ReceiptTemplate', 'Receipt', 'Invoice',
	'Collaboratore', 'StaffAccount', 'Timbratura', 'Turno', 'RichiestaFeriePermesso', 'SedutaPT', 'LiquidazionePT', 'Payslip', 'PayrollRun',
	'Exercise', 'ExercisePlan', 'WorkoutLog',
	'Organization', 'AuditLog',
];

export const api = {
	entities: Object.fromEntries(ENTITY_NAMES.map((name) => [name, buildEntityClient(name)])),

	// Le registrazioni contabili non passano da `entities`: testata e righe devono essere
	// scritte insieme, in transazione, e il numero di protocollo lo assegna il server.
	accounting: {
		createJournalEntry(entry, lines) {
			return request('/api/journal-entries', { method: 'POST', body: { entry, lines } });
		},

		markSettled(entryId, journalEntrySaldoId) {
			return request(`/api/journal-entries/${entryId}/settle`, {
				method: 'PUT',
				body: { journal_entry_saldo_id: journalEntrySaldoId },
			});
		},

		// Registra la consegna di un ordine: è il momento in cui nasce il costo, quindi il
		// server crea la scrittura contabile insieme al cambio di stato, in transazione.
		deliverPurchaseOrder(orderId, { data_consegna, importo, conto_costo_id }) {
			return request(`/api/purchase-orders/${orderId}/deliver`, {
				method: 'POST',
				body: { data_consegna, importo, conto_costo_id },
			});
		},

		// Il numero di fattura lo assegna il server in transazione: dev'essere progressivo
		// per esercizio, senza salti né duplicati.
		createInvoice(dati) {
			return request('/api/invoices', { method: 'POST', body: dati });
		},

		// Scarica il file XML della fattura elettronica.
		// Non passa da `request()` perché la risposta è un file, non JSON: l'errore però
		// sì, e porta con sé l'elenco dei dati mancanti, che va riportato al chiamante
		// invece di ridursi a un generico "errore".
		async downloadInvoiceXml(id) {
			const res = await fetch(`${API_BASE}/api/invoices/${id}/xml`, { headers: authHeaders() });
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				const error = new Error(payload.error || `Errore HTTP ${res.status}`);
				error.mancanti = payload.mancanti;
				throw error;
			}
			const nome = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'fattura.xml';
			return { xml: await res.text(), nome };
		},

		// Ricevute: stesso motivo delle fatture. Due momenti in cui il numero viene
		// assegnato — alla creazione se l'incasso è già saldato, all'emissione se era
		// una bozza in attesa del pagamento.
		createReceipt(dati) {
			return request('/api/receipts', { method: 'POST', body: dati });
		},

		issueReceipt(receiptId, dati) {
			return request(`/api/receipts/${receiptId}/issue`, { method: 'PUT', body: dati });
		},

		// Registra gli stipendi del mese: una sola scrittura aggregata, generata dal server
		// che verifica la coerenza dei cedolini prima di scrivere.
		createPayrollRun({ organization_id, periodo_anno, periodo_mese, data_registrazione }) {
			return request('/api/payroll-runs', {
				method: 'POST',
				body: { organization_id, periodo_anno, periodo_mese, data_registrazione },
			});
		},

		// Crea piano dei conti e causali per un ente che non li ha ancora. Idempotente.
		bootstrapContabilita(organizationId) {
			return request(`/api/organizations/${organizationId}/bootstrap-contabilita`, { method: 'POST' });
		},

		// Chiude un esercizio: gira il risultato a patrimonio netto e blocca le scritture
		// su quell'anno. Operazione irreversibile dall'interfaccia.
		closeExercise({ organization_id, anno, note }) {
			return request('/api/exercise-closures', { method: 'POST', body: { organization_id, anno, note } });
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
			// usano già per ricevute PDF e logo organizzazione.
			async UploadFile({ file }) {
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

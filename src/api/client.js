// Client applicativo verso il backend Grip (cartella server/).
// Espone `entities`, `auth` e `integrations`, cioè l'intera superficie che l'app usa.
//
// La forma dei metodi è volutamente identica a quella usata in tutta l'applicazione
// (list/filter/get/create/update/delete/bulkCreate), così le pagine e i componenti
// non hanno dovuto cambiare logica quando il datastore è stato sostituito.
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

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
	'AccountingSupplier', 'FixedAsset', 'Revenue', 'Expense',
	'FiscalProfileSnapshot', 'FiscalYearData', 'ReceiptTemplate', 'Receipt',
	'Collaboratore', 'StaffAccount', 'Timbratura', 'Turno', 'RichiestaFeriePermesso', 'SedutaPT', 'LiquidazionePT',
	'Exercise', 'ExercisePlan', 'WorkoutLog',
	'Organization', 'AuditLog',
];

export const api = {
	entities: Object.fromEntries(ENTITY_NAMES.map((name) => [name, buildEntityClient(name)])),

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

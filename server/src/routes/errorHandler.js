// Traduce i codici errore PostgreSQL più comuni in risposte 400 leggibili invece del
// generico 500 — un client (es. un form) deve poter distinguere un proprio errore di
// input da un guasto del server.
const PG_ERROR_MESSAGES = {
	23503: 'Riferimento a un record inesistente (foreign key non valida).',
	23505: 'Valore duplicato su un campo che deve essere univoco.',
	23502: 'Campo obbligatorio mancante.',
	23514: 'Valore non valido per un vincolo del campo (check constraint).',
	// Errori di formato: un UUID malformato nell'indirizzo, un testo troppo lungo, una data o un
	// numero impossibili. Sono errori di chi chiede, non guasti del server: finivano in 500 e nei
	// log come tali.
	'22P02': 'Valore in formato non valido.',
	22001: 'Un testo supera la lunghezza consentita.',
	22007: 'Data non valida.',
	22008: "Data fuori dall'intervallo ammesso.",
	22003: "Numero fuori dall'intervallo ammesso.",
	// Scaduta l'attesa di un lock (lib/sale.js): qualcun altro sta lavorando sulla stessa sala.
	'55P03': 'Qualcun altro sta modificando la stessa sala in questo momento: riprova fra qualche secondo.',
};

// Per alcuni vincoli il messaggio generico non dice cosa fare. Il nome del vincolo arriva da
// Postgres ed è nostro (lo decide lo schema): non rivela nulla dei dati, a differenza di
// `error.detail`.
const VINCOLI_CON_MESSAGGIO = {
	members_codice_fiscale_univoco: 'Esiste già un socio con questo codice fiscale.',
	canali_contatto_nome_unique: 'Esiste già un canale con questo nome.',
	staff_accounts_email_lower_idx: 'Esiste già un account con questa email (le maiuscole non contano).',
	leads_canale_id_canali_contatto_id_fk: 'Il canale è usato da alcuni contatti: disattivalo invece di eliminarlo.',
	bookings_attiva_unica_idx: 'Il socio è già prenotato a questa lezione.',
	qr_accessi_attivo_unico_idx: "Il socio ha già un codice d'accesso attivo: revoca quello prima di crearne un altro.",
	staff_accounts_linked_member_id_idx: 'Il socio ha già un account per il portale.',
};

// Chi elimina una riga ancora citata da altre riceveva «Riferimento a un record inesistente»,
// che descrive il caso opposto — un inserimento che punta al vuoto. Il codice è lo stesso
// (23503), la tabella no: in un'eliminazione `error.table` è quella che cita ancora la riga.
const CHI_CITA = {
	subscriptions: 'abbonamenti',
	bookings: 'prenotazioni',
	member_documents: 'documenti',
	qr_accessi: "codici d'accesso",
	staff_accounts: 'un account',
	// L'allenamento è uscito dall'applicazione (ramo archivio/allenamento), le sue tabelle
	// no: un socio che aveva schede resta citato da lì.
	exercise_plans: 'schede di allenamento',
	workout_sessions: 'allenamenti registrati',
	workout_logs: 'allenamenti registrati',
	sessions: 'lezioni in calendario',
	events: 'eventi in calendario',
	courses: 'corsi',
	leads: 'contatti',
};

function messaggioEliminazioneBloccata(error) {
	const cosa = CHI_CITA[error.table];
	return cosa
		? `Non si può eliminare: è ancora collegato ad altri dati (${cosa}).`
		: 'Non si può eliminare: è ancora collegato ad altri dati.';
}

/**
 * L'errore di Postgres dentro quello che arriva.
 *
 * Da drizzle-orm 0.44 un errore del database arriva avvolto in un `DrizzleQueryError`, con
 * quello di Postgres in `cause`: leggendo solo il primo livello, codice e vincolo erano
 * spariti e ogni violazione tornava a essere un 500.
 */
function erroreDelDatabase(error) {
	for (let e = error; e; e = e.cause) {
		if (e.code && /^[0-9A-Z]{5}$/.test(String(e.code))) return e;
	}
	return error;
}

export function registerPgErrorHandler(fastify) {
	fastify.setErrorHandler((errore, request, reply) => {
		const error = erroreDelDatabase(errore);
		const message = VINCOLI_CON_MESSAGGIO[error.constraint]
			?? (error.code === '23503' && request.method === 'DELETE' ? messaggioEliminazioneBloccata(error) : null)
			?? PG_ERROR_MESSAGES[error.code];
		if (message) {
			// `error.detail` di Postgres contiene il valore che ha violato il vincolo — cose
			// come «Key (email)=(vittima@example.com) already exists». Rimandarlo al client
			// trasformava ogni vincolo in uno strumento per indovinare dati di righe che non
			// si ha diritto di leggere: si prova un valore, e la risposta conferma se c'è.
			// Nei log serve, in risposta no.
			request.log.warn({ code: error.code, detail: error.detail }, 'vincolo del database violato');
			reply.code(400).send({ error: message });
			return;
		}
		// Fastify segnala da sé gli errori di richiesta (JSON malformato, corpo vuoto,
		// payload troppo grande): rispondere 500 farebbe credere a un guasto del server
		// una richiesta che va semplicemente corretta.
		if (errore.statusCode >= 400 && errore.statusCode < 500) {
			reply.code(errore.statusCode).send({ error: errore.message });
			return;
		}

		request.log.error(errore);
		reply.code(500).send({ error: 'Errore interno del server' });
	});
}

// Traduce i codici errore PostgreSQL più comuni in risposte 400 leggibili invece del
// generico 500 — un client (es. un form) deve poter distinguere un proprio errore di
// input da un guasto del server.
const PG_ERROR_MESSAGES = {
	23503: 'Riferimento a un record inesistente (foreign key non valida).',
	23505: 'Valore duplicato su un campo che deve essere univoco.',
	23502: 'Campo obbligatorio mancante.',
	23514: 'Valore non valido per un vincolo del campo (check constraint).',
};

// Per alcuni vincoli il messaggio generico non dice cosa fare. Il nome del vincolo arriva da
// Postgres ed è nostro (lo decide lo schema): non rivela nulla dei dati, a differenza di
// `error.detail`.
const VINCOLI_CON_MESSAGGIO = {
	members_codice_fiscale_univoco: 'Esiste già un socio con questo codice fiscale.',
	canali_contatto_nome_unique: 'Esiste già un canale con questo nome.',
	leads_canale_id_canali_contatto_id_fk: 'Il canale è usato da alcuni contatti: disattivalo invece di eliminarlo.',
};

export function registerPgErrorHandler(fastify) {
	fastify.setErrorHandler((error, request, reply) => {
		const message = VINCOLI_CON_MESSAGGIO[error.constraint] ?? PG_ERROR_MESSAGES[error.code];
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
		if (error.statusCode >= 400 && error.statusCode < 500) {
			reply.code(error.statusCode).send({ error: error.message });
			return;
		}

		request.log.error(error);
		reply.code(500).send({ error: 'Errore interno del server' });
	});
}

// Cosa può leggere un socio dal portale.
//
// Il socio è un cliente, non un dipendente: entra con le proprie credenziali in un'area che
// deve mostrargli i suoi dati e nient'altro. Senza questi limiti l'API gli restituisce
// qualunque entità — anagrafiche degli altri soci, contabilità, account dello staff, e
// perfino i cedolini, cioè gli stipendi di tutti.
//
// Il controllo sta qui e non nell'interfaccia perché l'interfaccia non protegge nulla:
// basta la stessa richiesta fatta a mano.

// Le uniche entità che il portale soci ha ragione di leggere.
const LEGGIBILI = new Set([
	// I propri dati
	'Member', 'Subscription', 'Receipt', 'MemberDocument', 'QRAccesso',
	'ExercisePlan', 'WorkoutLog', 'Booking',
	// Il catalogo dei corsi, che serve a prenotare
	'Course', 'Category', 'Instructor', 'Event', 'Session', 'Room',
	// Intestazione dell'ente, per ricevute e schermate
	'Organization',
]);

// Entità che il socio vede solo per la parte che lo riguarda, e la colonna con cui
// si riconoscono le "sue" righe.
const COLONNA_PROPRIETARIO = {
	Member: 'id',
	Subscription: 'member_id',
	Receipt: 'member_id',
	MemberDocument: 'member_id',
	ExercisePlan: 'member_id',
	WorkoutLog: 'member_id',
	// Nonostante il nome storico, punta al socio.
	QRAccesso: 'cliente_id',
};

/**
 * Impone che un record creato da un socio appartenga a lui.
 * Senza questo, basterebbe cambiare un identificativo nella richiesta per generare un
 * codice di accesso valido intestato a un altro.
 */
export function forzaProprietario(entityName, body, memberId) {
	const colonna = COLONNA_PROPRIETARIO[entityName];
	if (!colonna || colonna === 'id') return body;
	return { ...body, [colonna]: memberId };
}

// Le prenotazioni fanno eccezione: servono tutte, perché è da quelle che si contano i posti
// liberi e la lista d'attesa di ogni lezione. Quello che non serve è sapere *chi* ha
// prenotato, quindi il nome viene rimosso dalla risposta.
const CAMPI_NASCOSTI = {
	Booking: ['member_name'],
};

// Le uniche cose che un socio crea da sé: il proprio codice di accesso e i propri
// allenamenti. Tutto il resto lo registra la palestra.
const SCRIVIBILI = new Set(['QRAccesso', 'WorkoutLog']);

export function memberPuoLeggere(entityName) {
	return LEGGIBILI.has(entityName);
}

export function memberPuoScrivere(entityName) {
	return SCRIVIBILI.has(entityName);
}

/** Colonna su cui filtrare le righe del socio, se l'entità va limitata. */
export function colonnaProprietario(entityName) {
	return COLONNA_PROPRIETARIO[entityName] ?? null;
}

export function campiNascostiPerSocio(entityName) {
	return CAMPI_NASCOSTI[entityName] ?? null;
}

/** Rimuove dalle righe i campi che un socio non deve vedere. */
export function nascondiCampiPerSocio(entityName, righe) {
	const campi = campiNascostiPerSocio(entityName);
	if (!campi) return righe;
	const pulisci = (r) => {
		const out = { ...r };
		for (const c of campi) delete out[c];
		return out;
	};
	return Array.isArray(righe) ? righe.map(pulisci) : pulisci(righe);
}

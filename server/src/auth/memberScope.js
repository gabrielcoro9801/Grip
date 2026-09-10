// Cosa può leggere un socio dal portale.
//
// Il socio è un cliente, non un dipendente: entra con le proprie credenziali in un'area che
// deve mostrargli i suoi dati e nient'altro. Senza questi limiti l'API gli restituisce
// qualunque entità — anagrafiche degli altri soci e account dello staff compresi.
//
// Il controllo sta qui e non nell'interfaccia perché l'interfaccia non protegge nulla:
// basta la stessa richiesta fatta a mano.

// Le uniche entità che il portale soci ha ragione di leggere.
const LEGGIBILI = new Set([
	// I propri dati
	'Member', 'Subscription', 'MemberDocument', 'QRAccesso',
	'ExercisePlan', 'WorkoutSession', 'WorkoutLog', 'Booking',
	// Il catalogo dei corsi, che serve a prenotare
	'Course', 'Category', 'Instructor', 'Event', 'Session', 'Room',
	// Il catalogo degli esercizi: la scheda si porta dietro il nome di ogni esercizio, ma
	// la spiegazione di come si esegue sta qui, ed è la parte che serve a chi si allena.
	// Non contiene dati di nessuno — è l'equivalente del catalogo dei corsi.
	'Exercise',
	// Intestazione dell'ente, per le schermate
	'Organization',
]);

// Entità che il socio vede solo per la parte che lo riguarda, e la colonna con cui
// si riconoscono le "sue" righe.
const COLONNA_PROPRIETARIO = {
	Member: 'id',
	Subscription: 'member_id',
	MemberDocument: 'member_id',
	ExercisePlan: 'member_id',
	WorkoutSession: 'member_id',
	WorkoutLog: 'member_id',
	// Nonostante il nome storico, punta al socio.
	QRAccesso: 'cliente_id',
};

/**
 * La colonna che dice di chi è una riga **quando la si scrive**.
 *
 * Quasi sempre coincide con quella della lettura, ma non per le prenotazioni: quelle si
 * leggono tutte, perché è da lì che si contano i posti liberi e la lista d'attesa di ogni
 * lezione, e se ne scrivono solo di proprie. Tenere una mappa sola costringerebbe a
 * scegliere fra due cose che non sono la stessa: chi posso vedere, e a nome di chi posso
 * agire.
 */
const COLONNA_PROPRIETARIO_SCRITTURA = {
	...COLONNA_PROPRIETARIO,
	Booking: 'member_id',
};

/**
 * Impone che un record creato da un socio appartenga a lui.
 * Senza questo, basterebbe cambiare un identificativo nella richiesta per generare un
 * codice di accesso valido intestato a un altro.
 */
export function forzaProprietario(entityName, body, memberId) {
	const colonna = COLONNA_PROPRIETARIO_SCRITTURA[entityName];
	if (!colonna || colonna === 'id') return body;
	return { ...body, [colonna]: memberId };
}

/** Colonna su cui verificare che una riga da modificare o cancellare sia davvero sua. */
export function colonnaProprietarioScrittura(entityName) {
	return COLONNA_PROPRIETARIO_SCRITTURA[entityName] ?? null;
}

// Le prenotazioni fanno eccezione: servono tutte, perché è da quelle che si contano i posti
// liberi e la lista d'attesa di ogni lezione. Quello che non serve è sapere *chi* ha
// prenotato, quindi il nome viene rimosso dalla risposta.
const CAMPI_NASCOSTI = {
	Booking: ['member_name'],
};

// Le uniche cose che un socio crea da sé: i propri allenamenti — la sessione che avvia e
// le serie che spunta mentre si allena. Tutto il resto lo registra la palestra.
//
// **QRAccesso non è qui.** Il codice d'accesso se lo creava il socio, con lo stato che
// voleva: bastava una richiesta per rifarsi una credenziale attiva dopo essere stato
// revocato, e la revoca diventava una formalità. Ora il codice lo emette la palestra, e il
// socio lo chiede soltanto a /api/qr/codice.
//
// **Nemmeno Booking è qui.** Prenotare non è scrivere una riga: è decidere se c'è posto, e
// quel conto dipende da tutte le altre prenotazioni della stessa lezione. Da questo
// endpoint il socio manderebbe una riga già decisa, con lo stato dentro, e il server la
// scriverebbe senza guardare — cioè si prenoterebbe su una lezione piena. Si passa da
// /api/prenotazioni, che conta dentro una transazione.
const SCRIVIBILI = new Set(['WorkoutSession', 'WorkoutLog']);

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

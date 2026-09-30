// La regola delle password, una sola per tutti.
//
// Prima ognuno aveva la sua: 8 caratteri per il cambio password, 12 per lo script di
// emergenza, 6 nel modulo della scheda socio e nessun limite per gli account creati
// dall'amministratore. Sta qui perché la usano il server, che decide, e le schermate, che
// avvisano prima di mandare.

export const LUNGHEZZA_MINIMA_PASSWORD = 10;

// bcrypt considera solo i primi 72 byte: oltre, due password diverse diventerebbero la stessa.
const BYTE_MASSIMI_PASSWORD = 72;

/** Perché una password nuova non va bene, o null. */
export function motivoPasswordNonValida(password) {
	if (typeof password !== 'string' || password.length < LUNGHEZZA_MINIMA_PASSWORD) {
		return `La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`;
	}
	if (new TextEncoder().encode(password).length > BYTE_MASSIMI_PASSWORD) {
		return 'La password è troppo lunga.';
	}
	return null;
}

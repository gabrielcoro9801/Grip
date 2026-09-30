import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// Segreto e scadenza arrivano dalla configurazione, che fuori dallo sviluppo si rifiuta di
// partire se il segreto non è stato impostato: un default noto significa che chiunque può
// firmarsi un token da amministratore.

// L'algoritmo è uno solo, e lo decide il server: senza l'elenco in `verify`, è l'intestazione
// del token — scritta da chi lo presenta — a dire come verificarlo. Oggi la libreria rifiuta già
// `none`, ma è una garanzia che non deve dipendere dalla versione installata.
const ALGORITMO = 'HS256';

/**
 * Firma un token.
 *
 * La scadenza dipende da chi è l'utente: il gestionale si apre al lavoro e rifare l'accesso
 * ogni mattina è normale; il portale si apre in palestra col telefono in mano, e una
 * sessione che scade ogni dodici ore vorrebbe dire digitare la password davanti al tornello.
 *
 * Nel token va anche `tv`, la versione della sessione: è ciò che permette di revocarla
 * davvero (vedi `sessioneRevocata`). Senza, una sessione da trenta giorni sarebbe un rischio
 * e non una comodità.
 */
export function signToken(payload) {
	const scadenza = payload.ruolo === 'member' ? config.jwtScadenzaSocio : config.jwtScadenza;
	return jwt.sign(payload, config.jwtSecret, { algorithm: ALGORITMO, expiresIn: scadenza });
}

export function verifyToken(token) {
	return jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITMO] });
}

// Estrae e verifica il bearer token; ritorna null se assente/non valido.
export function getUserFromRequest(request) {
	const header = request.headers.authorization;
	if (!header?.startsWith('Bearer ')) return null;
	try {
		return verifyToken(header.slice(7));
	} catch {
		return null;
	}
}

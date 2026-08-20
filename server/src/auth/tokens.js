import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// Segreto e scadenza arrivano dalla configurazione, che fuori dallo sviluppo si rifiuta di
// partire se il segreto non è stato impostato: un default noto significa che chiunque può
// firmarsi un token da amministratore.

export function signToken(payload) {
	return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtScadenza });
}

export function verifyToken(token) {
	return jwt.verify(token, config.jwtSecret);
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

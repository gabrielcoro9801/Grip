import jwt from 'jsonwebtoken';

// In sviluppo un default è comodo; in produzione l'assenza di JWT_SECRET deve essere
// un errore fatale, non un fallback silenzioso a un segreto noto.
const JWT_SECRET = process.env.JWT_SECRET || 'grip-dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
	throw new Error('JWT_SECRET è obbligatorio in produzione');
}

export function signToken(payload) {
	return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
	return jwt.verify(token, JWT_SECRET);
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

// Il codice socio: sei cifre, progressivo, mai due volte lo stesso.
//
// Stava dentro la trasformazione in scrittura di `Member` in entities/hooks.js. Ora un socio
// nasce anche convertendo un lead (routes/lead.js), e ricopiare lì la query avrebbe
// significato due numerazioni che un giorno partono da massimi diversi.
import { sql } from 'drizzle-orm';
import { members } from '../db/schema/index.js';
import { nextNumber } from './numbering.js';

/**
 * @param {Object} tx transazione Drizzle, o il db
 * @param {string} organizationId
 * @returns {Promise<string>} es. "000042"
 */
export async function assegnaCodiceSocio(tx, organizationId) {
	const numero = await nextNumber(
		tx, organizationId, 'codice_socio',
		sql`SELECT MAX(CAST(NULLIF(regexp_replace(codice_socio, '\\D', '', 'g'), '') AS INTEGER)) FROM ${members}`,
	);
	return String(numero).padStart(6, '0');
}

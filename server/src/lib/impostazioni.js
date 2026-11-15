// Le impostazioni della palestra (organizations.impostazioni), lette dove servono.
import { db } from '../db/client.js';
import { organizations } from '../db/schema/index.js';
import { soglieDi } from '../../../shared/soglie.js';

/** Le soglie in giorni della palestra, fuse con le predefinite (shared/soglie.js). */
export async function soglieEnte(conn = db) {
	const [ente] = await conn.select({ impostazioni: organizations.impostazioni }).from(organizations).limit(1);
	return soglieDi(ente?.impostazioni);
}

/** I recapiti che l'amministratore scrive in `impostazioni.contatti`. */
export const CAMPI_CONTATTI = ['telefono', 'whatsapp', 'email', 'orari'];

/**
 * Nome, indirizzo e recapiti della palestra, come li legge il socio nel portale: nome e
 * indirizzo dalle colonne, il resto da `impostazioni.contatti`. Un campo vuoto è null.
 */
export async function contattiPalestra(conn = db) {
	const [ente] = await conn.select().from(organizations).limit(1);
	const contatti = ente?.impostazioni?.contatti ?? {};
	const pieno = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
	return {
		nome: pieno(ente?.nome),
		indirizzo: pieno(ente?.indirizzo),
		...Object.fromEntries(CAMPI_CONTATTI.map((k) => [k, pieno(contatti[k])])),
	};
}

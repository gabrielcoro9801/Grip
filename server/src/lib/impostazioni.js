// Le impostazioni della palestra (organizations.impostazioni), lette dove servono.
import { db } from '../db/client.js';
import { organizations } from '../db/schema/index.js';
import { soglieDi } from '../../../shared/soglie.js';

/** Le soglie in giorni della palestra, fuse con le predefinite (shared/soglie.js). */
export async function soglieEnte(conn = db) {
	const [ente] = await conn.select({ impostazioni: organizations.impostazioni }).from(organizations).limit(1);
	return soglieDi(ente?.impostazioni);
}

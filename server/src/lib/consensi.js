// Il registro dei consensi letto dal database (shared/consensi.js, consensoProvato). Lo leggono
// la scheda, il portale e gli invii: un solo modo di dire se il consenso c'è.
import { inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consensi } from '../db/schema/index.js';
import { consensiAttuali } from '../../../shared/consensi.js';

/** Le righe del registro di più persone, dalla più vecchia: [{ persona_id, tipo, valore, fonte, … }]. */
export async function righeConsensi(idPersone, conn = db) {
	if (!idPersone.length) return [];
	return conn.select({
		id: consensi.id, persona_id: consensi.personaId, tipo: consensi.tipo, valore: consensi.valore, fonte: consensi.fonte,
		autore_nome: consensi.autoreNome, nota: consensi.nota, created_date: consensi.createdDate,
	}).from(consensi)
		.where(inArray(consensi.personaId, idPersone))
		.orderBy(consensi.createdDate);
}

/** I consensi di oggi di una persona. */
export async function consensiDi(personaId, conn = db) {
	return consensiAttuali(await righeConsensi([personaId], conn));
}

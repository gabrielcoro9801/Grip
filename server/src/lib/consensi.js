// Il registro dei consensi letto dal database, con la prova: per un consenso dato in reception,
// se il modulo firmato c'è ancora fra i documenti (shared/consensi.js, consensoProvato). Lo
// leggono la scheda, il portale e gli invii: un solo modo di dire se il consenso c'è.
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consensi, memberDocuments } from '../db/schema/index.js';
import { consensiAttuali } from '../../../shared/consensi.js';

/** Le righe del registro di più persone, dalla più vecchia: [{ persona_id, tipo, valore, fonte, …, documento_presente }]. */
export async function righeConsensi(idPersone, conn = db) {
	if (!idPersone.length) return [];
	return conn.select({
		id: consensi.id, persona_id: consensi.personaId, tipo: consensi.tipo, valore: consensi.valore, fonte: consensi.fonte,
		autore_nome: consensi.autoreNome, nota: consensi.nota, created_date: consensi.createdDate,
		documento_id: consensi.documentoId, documento_presente: sql`${memberDocuments.id} is not null`.mapWith(Boolean),
		documento_nome: memberDocuments.fileName,
	}).from(consensi)
		.leftJoin(memberDocuments, eq(memberDocuments.id, consensi.documentoId))
		.where(inArray(consensi.personaId, idPersone))
		.orderBy(consensi.createdDate);
}

/** I consensi di oggi di una persona. */
export async function consensiDi(personaId, conn = db) {
	return consensiAttuali(await righeConsensi([personaId], conn));
}

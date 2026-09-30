// Dove stanno i file caricati, e come se ne cancella uno davvero.
//
// Eliminare un documento dalla scheda di un socio cancellava la riga e lasciava il file: la
// finestra di conferma diceva "non si può recuperare", ma il certificato medico restava sul
// disco. Per un dato sanitario la cancellazione deve essere effettiva, non solo un link che
// sparisce dalla schermata.
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getColumnMaps } from '../entities/columnMaps.js';
import { config } from '../config.js';
import { nomeFileDa } from './urlFirmati.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UPLOAD_DIR = config.uploadDir || path.join(serverRoot, 'uploads');

// Un nome è uno dei nostri solo se è un nome e basta: niente barre, niente `..`.
const NOME_SICURO = /^[\w-][\w.-]*$/;

/** Il percorso sul disco del file a cui punta un indirizzo, o null se non è un nostro file. */
export function percorsoDi(url) {
	const nome = nomeFileDa(url);
	if (!nome || !NOME_SICURO.test(nome)) return null;
	return path.join(UPLOAD_DIR, nome);
}

/** Cancella un file dal disco. Un file che non c'è già più non è un errore. */
export async function cancellaFile(percorso) {
	if (!percorso) return;
	try {
		await unlink(percorso);
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
	}
}

/** Le colonne `*_url` di una tabella del registro. */
export function colonneFile(table) {
	const { dbNameToColumn } = getColumnMaps(table);
	return Object.entries(dbNameToColumn).filter(([nome]) => /_url$/.test(nome));
}

/**
 * Cancella i file a cui puntavano i campi `*_url` di una riga che non li usa più — eliminata,
 * o con un file nuovo al posto del vecchio.
 *
 * Prima di cancellare si controlla che nessun'altra riga della stessa tabella punti allo
 * stesso file: ogni caricamento produce un nome nuovo, ma una riga copiata a mano porterebbe
 * con sé l'indirizzo, e cancellare il file lo toglierebbe anche all'altra.
 *
 * @param rigaSnake la riga com'era, con le chiavi snake_case.
 * @param campi     quali campi guardare (tutti i `*_url` se omesso).
 */
export async function cancellaFileNonPiuUsati(table, rigaSnake, campi) {
	for (const [nome, colonna] of colonneFile(table)) {
		if (campi && !campi.includes(nome)) continue;
		const valore = rigaSnake?.[nome];
		const percorso = percorsoDi(valore);
		if (!percorso) continue;
		const suffisso = `/uploads/${path.basename(percorso)}`;
		const [{ ancora }] = await db
			.select({ ancora: sql`count(*)::int` })
			.from(table)
			.where(sql`${colonna} like ${'%' + suffisso}`);
		if (!ancora) await cancellaFile(percorso);
	}
}

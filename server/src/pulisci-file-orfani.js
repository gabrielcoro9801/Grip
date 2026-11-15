// Cancella i file caricati che nessuna riga cita più.
//
// Nascono così: si carica una foto o un certificato e poi si annulla il modulo, oppure il
// file è stato sostituito prima che la cancellazione dei vecchi esistesse. Restano sul disco
// per sempre, e fra loro ci possono essere dati sanitari.
//
// Un file più giovane di un giorno non si tocca: potrebbe essere di un modulo ancora aperto,
// caricato e non ancora salvato.
//
// **Di norma non cancella niente**: elenca. Si cancella solo con `--applica`.
//
// Uso:
//   npm run manutenzione:file-orfani                 (solo elenco)
//   npm run manutenzione:file-orfani -- --applica    (cancella)
//   railway run npm --prefix server run manutenzione:file-orfani      (per la produzione)
import 'dotenv/config';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { isNotNull } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { entityRegistry } from './entities/registry.js';
import { annunciaDatabase } from './lib/descriviDatabase.js';
import { UPLOAD_DIR, colonneFile, cancellaFile } from './lib/fileCaricati.js';
import { nomeFileDa } from './lib/urlFirmati.js';

const APPLICA = process.argv.includes('--applica');
const ETA_MINIMA_MS = 24 * 60 * 60 * 1000;

annunciaDatabase();
console.log(`Cartella: ${UPLOAD_DIR}\n`);

const citati = new Set();
for (const table of Object.values(entityRegistry)) {
	for (const [, colonna] of colonneFile(table)) {
		const righe = await db.select({ url: colonna }).from(table).where(isNotNull(colonna));
		for (const { url } of righe) {
			const nome = nomeFileDa(url);
			if (nome) citati.add(nome);
		}
	}
}

let nomi = [];
try {
	nomi = await readdir(UPLOAD_DIR);
} catch (err) {
	if (err.code !== 'ENOENT') throw err;
}

const adesso = Date.now();
const orfani = [];
for (const nome of nomi) {
	if (citati.has(nome)) continue;
	const percorso = path.join(UPLOAD_DIR, nome);
	const info = await stat(percorso);
	if (!info.isFile() || adesso - info.mtimeMs < ETA_MINIMA_MS) continue;
	orfani.push({ nome, percorso, kb: Math.round(info.size / 1024) });
}

for (const f of orfani) console.log(`• ${f.nome} (${f.kb} KB)`);
console.log(`\nFile nella cartella: ${nomi.length}. Citati: ${citati.size}. Orfani da più di un giorno: ${orfani.length}.`);

if (orfani.length && APPLICA) {
	for (const f of orfani) await cancellaFile(f.percorso);
	console.log(`Cancellati ${orfani.length} file.`);
} else if (orfani.length) {
	console.log('Nessun file cancellato. Per cancellarli: npm run manutenzione:file-orfani -- --applica');
}

await pool.end();
process.exit(0);

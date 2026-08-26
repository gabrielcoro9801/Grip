import 'dotenv/config';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { config, verificaConfigurazione, segretoDiSviluppoInUso } from './config.js';
import { caricaMatriceIniziale } from './lib/ruoli.js';

// Si controlla prima di qualunque altra cosa: partire e scoprire dopo che manca il segreto
// dei token significa aver già servito richieste.
verificaConfigurazione();

const port = config.porta;
const publicBaseUrl = config.publicBaseUrl || `http://localhost:${port}`;

// @fastify/static rifiuta di avviarsi se la cartella non esiste ancora: alla prima
// esecuzione (nessun upload effettuato) andrebbe in errore senza questa creazione.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(config.uploadDir || path.join(serverRoot, 'uploads'), { recursive: true });

// I permessi si leggono dalla banca dati prima di servire qualunque richiesta: partire
// con quelli predefiniti e sostituirli dopo significherebbe una finestra in cui i controlli
// rispondono in base a una matrice diversa da quella configurata.
await caricaMatriceIniziale();

const app = buildApp({ publicBaseUrl });

if (segretoDiSviluppoInUso()) {
	app.log.warn("JWT_SECRET non impostato: si sta usando il segreto di sviluppo. Va bene in locale, mai altrove.");
}

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
	app.log.error(err);
	process.exit(1);
});

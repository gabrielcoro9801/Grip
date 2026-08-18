import 'dotenv/config';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;

// @fastify/static rifiuta di avviarsi se la cartella non esiste ancora: alla prima
// esecuzione (nessun upload effettuato) andrebbe in errore senza questa creazione.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(serverRoot, 'uploads'), { recursive: true });

const app = buildApp({ publicBaseUrl });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
	app.log.error(err);
	process.exit(1);
});

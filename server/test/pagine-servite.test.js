// Le intestazioni con cui escono le pagine dell'applicazione.
//
// Gli upload sono serviti con una CSP che non concede nulla, perché un file caricato da un
// utente non deve poter eseguire niente sul nostro dominio. Quella CSP però vive nella
// chiusura del plugin statico che la registra, non nella cartella: quando era quel plugin a
// decorare `reply.sendFile`, l'index.html mandato al router per /member-portal usciva
// sandboxato e la pagina restava nera, senza script e senza foglio di stile. Il difetto non
// si vedeva sulla home, servita da un'altra rotta, e rientra in silenzio se qualcuno rimette
// `decorateReply` sullo static sbagliato: da qui questi due controlli, uno per lato.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/client.js';
import { config } from '../src/config.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.resolve(serverRoot, '..', 'dist');
const UPLOAD_DIR = config.uploadDir || path.join(serverRoot, 'uploads');
const SONDA = path.join(UPLOAD_DIR, '__sonda-intestazioni.txt');

let app;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	writeFileSync(SONDA, 'sonda');
});

after(async () => {
	rmSync(SONDA, { force: true });
	await app.close();
	await pool.end();
});

describe('le intestazioni delle pagine servite', () => {
	// In sviluppo il frontend lo serve Vite e dist/ non esiste: senza build non c'è nulla da
	// controllare, e far fallire i test per questo direbbe una cosa falsa.
	test('una rotta del router riceve index.html senza sandbox', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
		const risposta = await app.inject({ method: 'GET', url: '/member-portal', headers: { accept: 'text/html' } });

		assert.equal(risposta.statusCode, 200);
		assert.match(risposta.headers['content-type'], /text\/html/);
		assert.equal(risposta.headers['content-security-policy'], undefined);
	});

	test('un file caricato resta senza permessi', async () => {
		const risposta = await app.inject({ method: 'GET', url: '/uploads/__sonda-intestazioni.txt' });

		assert.equal(risposta.statusCode, 200);
		assert.equal(risposta.headers['content-security-policy'], "default-src 'none'; sandbox");
		assert.equal(risposta.headers['x-content-type-options'], 'nosniff');
	});
});

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
import { existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
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
	test('una rotta del router riceve un guscio senza sandbox', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
		const risposta = await app.inject({ method: 'GET', url: '/member-portal', headers: { accept: 'text/html' } });

		assert.equal(risposta.statusCode, 200);
		assert.match(risposta.headers['content-type'], /text\/html/);
		assert.equal(risposta.headers['content-security-policy'], undefined);
	});

	// Le applicazioni sono due, con due punti d'ingresso. Mandare il guscio sbagliato non dà
	// nessun errore lato server: il browser carica il gestionale, non trova nessuna rotta che
	// corrisponda a /member-portal/qr e mostra "pagina non trovata". Un guasto che sembra un
	// problema di routing del frontend e invece nasce qui.
	describe('ogni area riceve il proprio guscio', () => {
		const daGuscio = async (url) => (await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })).body;

		test('il portale soci riceve member.html', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
			assert.match(await daGuscio('/member-portal'), /src\/member\/main|assets\/member-/);
		});

		test('anche su un percorso profondo', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
			assert.match(await daGuscio('/member-portal/allenamento/sessione/abc'), /src\/member\/main|assets\/member-/);
		});

		// Il router non distingue le maiuscole, e questo non deve distinguerle di meno: se lo
		// facesse, /Member-Portal aprirebbe il gestionale.
		test('ignorando le maiuscole, come fa il router', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
			assert.match(await daGuscio('/Member-Portal/qr'), /src\/member\/main|assets\/member-/);
		});

		test('il gestionale riceve index.html', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
			const corpo = await daGuscio('/crm/soci/qualcosa');
			assert.match(corpo, /src\/staff\/main|assets\/staff-/);
			assert.doesNotMatch(corpo, /assets\/member-/);
		});
	});

	// Il seguito della stessa storia: la CSP sbagliata era sparita dal server, ma i browser che
	// l'avevano già presa continuavano a vedere la pagina nera. Rispondendo 304 il server non
	// ripete le intestazioni, e il browser tiene quelle vecchie: finché il guscio è conservabile,
	// un errore mandato una volta non si può più ritirare.
	// Entrambi i gusci, non solo quello che c'era prima: la regola è scritta al contrario
	// (`no-store` è il predefinito, `immutable` l'eccezione per assets/) proprio perché un
	// guscio nuovo nasca giusto senza che nessuno se ne ricordi. Questo test è ciò che
	// impedisce di riscriverla "in positivo" senza accorgersene.
	for (const [nome, url] of [['del gestionale', '/crm'], ['del portale soci', '/member-portal'], ['chiesto per nome', '/member.html']]) {
		test(`il guscio ${nome} non si conserva in cache`, { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
			const risposta = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } });

			assert.equal(risposta.statusCode, 200);
			assert.equal(risposta.headers['cache-control'], 'no-store');
		});
	}

	test('i file con impronta nel nome si conservano a lungo', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
		const nome = readdirSync(path.join(DIST_DIR, 'assets')).find((f) => f.endsWith('.js'));
		const risposta = await app.inject({ method: 'GET', url: `/assets/${nome}` });

		assert.equal(risposta.statusCode, 200);
		assert.match(risposta.headers['cache-control'], /immutable/);
	});

	test('un file caricato resta senza permessi', async () => {
		const risposta = await app.inject({ method: 'GET', url: '/uploads/__sonda-intestazioni.txt' });

		assert.equal(risposta.statusCode, 200);
		assert.equal(risposta.headers['content-security-policy'], "default-src 'none'; sandbox");
		assert.equal(risposta.headers['x-content-type-options'], 'nosniff');
	});
});

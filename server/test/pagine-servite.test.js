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
import { firmaUrl } from '../src/lib/urlFirmati.js';

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
		// La pagina ha la sua CSP, quella dell'applicazione: mai quella degli upload.
		assert.doesNotMatch(risposta.headers['content-security-policy'] ?? '', /sandbox/);
	});

	// Le pagine non avevano nessuna intestazione di sicurezza: si potevano incorniciare in un
	// altro sito, e uno script iniettato poteva leggere il token e mandarlo ovunque.
	test('una pagina esce con le intestazioni di sicurezza', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
		const risposta = await app.inject({ method: 'GET', url: '/crm', headers: { accept: 'text/html' } });
		const csp = risposta.headers['content-security-policy'];

		assert.match(csp, /script-src 'self'(;|$)/, 'niente script scritti nella pagina né da altri siti');
		assert.match(csp, /frame-ancestors 'none'/);
		assert.match(csp, /connect-src 'self'/);
		assert.equal(risposta.headers['x-frame-options'], 'SAMEORIGIN');
		assert.match(risposta.headers['strict-transport-security'], /max-age=31536000/);
		assert.equal(risposta.headers['referrer-policy'], 'same-origin');
	});

	// Con la CSP gli script scritti dentro la pagina non girano più: se uno dei gusci ne
	// contenesse ancora, il browser lo bloccherebbe senza che nessun test se ne accorga.
	test('i gusci non contengono script scritti nella pagina', { skip: !existsSync(DIST_DIR) && 'dist/ non compilata' }, async () => {
		for (const url of ['/crm', '/member-portal']) {
			const corpo = (await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })).body;
			const inline = [...corpo.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim());
			assert.deepEqual(inline.map((m) => m[1].slice(0, 60)), [], `script inline in ${url}`);
			assert.match(corpo, /<script src="\/tema\.js"><\/script>/);
		}
		assert.equal((await app.inject({ method: 'GET', url: '/tema.js' })).statusCode, 200);
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
			assert.match(await daGuscio('/member-portal/corsi/settimana/abc'), /src\/member\/main|assets\/member-/);
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

	// L'indirizzo va firmato: da quando i file caricati non sono più aperti a chiunque
	// (`lib/urlFirmati.js`), senza firma si riceve 404. Qui interessano le intestazioni, cioè
	// che un file aperto non possa comportarsi da pagina del nostro dominio: le due difese
	// convivono, una non sostituisce l'altra.
	test('un file caricato resta senza permessi', async () => {
		const risposta = await app.inject({ method: 'GET', url: firmaUrl('/uploads/__sonda-intestazioni.txt') });

		assert.equal(risposta.statusCode, 200);
		assert.equal(risposta.headers['content-security-policy'], "default-src 'none'; sandbox");
		assert.equal(risposta.headers['x-content-type-options'], 'nosniff');
	});
});

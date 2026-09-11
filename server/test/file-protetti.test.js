// I file caricati non si aprono più conoscendo l'indirizzo.
//
// Erano serviti da `/uploads/*` senza alcun controllo. Il nome è casuale, quindi non si
// indovina — ma un indirizzo si condivide, finisce in una cronologia, nel log di un proxy,
// in uno screenshot. E fra quei file ci sono i certificati medici dei soci: dati sanitari.
// "Difficile da indovinare" non è un controllo d'accesso, ed è il motivo per cui questo
// test esiste.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { staffAccounts, exercises } from '../src/db/schema/index.js';
import { config } from '../src/config.js';
import { firmaUrl, togliFirma, firmaValida, nomeFileDa } from '../src/lib/urlFirmati.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOAD_DIR = config.uploadDir || path.join(serverRoot, 'uploads');
const NOME = '__prova-file-protetti.txt';
const SONDA = path.join(UPLOAD_DIR, NOME);

let app;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	mkdirSync(UPLOAD_DIR, { recursive: true });
	writeFileSync(SONDA, 'contenuto riservato');
});

after(async () => {
	rmSync(SONDA, { force: true });
	await app.close();
	await pool.end();
});

const chiedi = (url) => app.inject({ method: 'GET', url });

describe("aprire un file caricato", () => {
	test("senza firma non si apre, e non si dice nemmeno che esiste", async () => {
		const risposta = await chiedi(`/uploads/${NOME}`);

		// 404 e non 403: a chi non può vederlo non si conferma l'esistenza del file.
		assert.equal(risposta.statusCode, 404);
		assert.ok(!risposta.body.includes('riservato'), 'il contenuto è uscito lo stesso');
	});

	test('con la firma giusta si apre', async () => {
		const firmato = firmaUrl(`/uploads/${NOME}`);
		const risposta = await chiedi(firmato);

		assert.equal(risposta.statusCode, 200, firmato);
		assert.equal(risposta.body, 'contenuto riservato');
	});

	test('con una firma alterata non si apre', async () => {
		const firmato = firmaUrl(`/uploads/${NOME}`);
		const manomesso = firmato.replace(/firma=(.)/, (_, primo) => `firma=${primo === 'a' ? 'b' : 'a'}`);

		assert.equal((await chiedi(manomesso)).statusCode, 404);
	});

	test('la firma di un file non vale per un altro', async () => {
		const altro = firmaUrl('/uploads/un-altro-file.pdf');
		const parametri = altro.split('?')[1];

		assert.equal((await chiedi(`/uploads/${NOME}?${parametri}`)).statusCode, 404);
	});

	test('una firma scaduta non vale', async () => {
		// Firmata come se fossimo un mese fa: la scadenza è già passata.
		const unMeseFa = Date.now() - 30 * 24 * 60 * 60 * 1000;
		const vecchia = firmaUrl(`/uploads/${NOME}`, unMeseFa);

		assert.equal((await chiedi(vecchia)).statusCode, 404);
	});

	// Le intestazioni che impedivano a un file caricato di comportarsi da pagina del nostro
	// dominio devono restare: il controllo d'accesso si aggiunge, non sostituisce.
	test('un file aperto resta senza permessi', async () => {
		const risposta = await chiedi(firmaUrl(`/uploads/${NOME}`));

		assert.equal(risposta.headers['content-security-policy'], "default-src 'none'; sandbox");
		assert.equal(risposta.headers['x-content-type-options'], 'nosniff');
	});
});

// Il giro completo, che è la parte che si rompe davvero: la firma non serve a niente se
// l'indirizzo che arriva alle schermate non ce l'ha. Le pagine mettono `esercizio.image_url`
// dentro un `<img src>` così com'è, e se uscisse nudo l'immagine non si vedrebbe più.
describe("l'indirizzo che arriva alle schermate è già firmato", () => {
	let idEsercizio;
	let idAccount;
	let token;
	const PASSWORD = 'prova-file-protetti-1234';

	before(async () => {
		// Il test si costruisce il proprio account e lo cancella: non dipende da com'è
		// popolato il database in cui gira.
		const email = `firma.file.${Date.now()}@test.local`;
		const [account] = await db
			.insert(staffAccounts)
			.values({ nome: 'Admin Firma File', email, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'admin' })
			.returning();
		idAccount = account.id;

		token = (await app.inject({
			method: 'POST',
			url: '/api/auth/login',
			payload: { email, password: PASSWORD },
		})).json().token;

		const creato = await app.inject({
			method: 'POST',
			url: '/api/entities/Exercise',
			headers: { authorization: `Bearer ${token}` },
			payload: { name: '__Prova firma file', muscle_group: 'petto', image_url: `https://gripcore.it/uploads/${NOME}` },
		});
		assert.equal(creato.statusCode, 201, creato.body);
		idEsercizio = creato.json().id;
	});

	after(async () => {
		if (idEsercizio) await db.delete(exercises).where(inArray(exercises.id, [idEsercizio]));
		if (idAccount) await db.delete(staffAccounts).where(inArray(staffAccounts.id, [idAccount]));
	});

	test("l'immagine di un esercizio esce firmata e si apre", async () => {
		const letto = await app.inject({
			method: 'GET',
			url: `/api/entities/Exercise/${idEsercizio}`,
			headers: { authorization: `Bearer ${token}` },
		});
		const url = letto.json().image_url;

		assert.match(url, /firma=/, "l'indirizzo è uscito senza firma: le immagini non si vedrebbero");
		assert.equal((await chiedi(url.replace('https://gripcore.it', ''))).statusCode, 200);
	});

	test("risalvando non si porta la firma nel database", async () => {

		// È quello che fa il gestionale: rilegge l'indirizzo, lo mette nel modulo e lo
		// risalva. Se la firma entrasse nel database, l'immagine smetterebbe di vedersi
		// qualche ora dopo senza che nessuno abbia toccato niente.
		const letto = (await app.inject({
			method: 'GET',
			url: `/api/entities/Exercise/${idEsercizio}`,
			headers: { authorization: `Bearer ${token}` },
		})).json();

		await app.inject({
			method: 'PUT',
			url: `/api/entities/Exercise/${idEsercizio}`,
			headers: { authorization: `Bearer ${token}` },
			payload: { name: letto.name, muscle_group: letto.muscle_group, image_url: letto.image_url },
		});

		const rileggi = (await app.inject({
			method: 'GET',
			url: `/api/entities/Exercise/${idEsercizio}`,
			headers: { authorization: `Bearer ${token}` },
		})).json();

		// Una firma sola, non una firma sopra l'altra.
		assert.equal((rileggi.image_url.match(/firma=/g) ?? []).length, 1);
		assert.equal(togliFirma(rileggi.image_url), `https://gripcore.it/uploads/${NOME}`);
	});
});

describe('la firma, come pezzo a sé', () => {
	test("lo stesso file ha lo stesso indirizzo per un'ora", () => {
		// Se cambiasse a ogni lettura, la cache del browser non servirebbe a niente e la
		// foto di ogni esercizio verrebbe riscaricata a ogni apertura della pagina.
		const adesso = Date.now();
		assert.equal(
			firmaUrl(`/uploads/${NOME}`, adesso),
			firmaUrl(`/uploads/${NOME}`, adesso + 5 * 60 * 1000)
		);
	});

	test('togliere la firma riporta l’indirizzo di partenza', () => {
		const nudo = `https://gripcore.it/uploads/${NOME}`;
		assert.equal(togliFirma(firmaUrl(nudo)), nudo);
	});

	test('quello che non è un file caricato non viene toccato', () => {
		assert.equal(firmaUrl('https://esempio.it/logo.png'), 'https://esempio.it/logo.png');
		assert.equal(nomeFileDa('https://esempio.it/logo.png'), null);
		assert.equal(firmaUrl(null), null);
	});

	test('una firma senza scadenza o senza valore non passa', () => {
		assert.equal(firmaValida(NOME, undefined, 'abc'), false);
		assert.equal(firmaValida(NOME, Date.now() + 1000, undefined), false);
		assert.equal(firmaValida(NOME, 'domani', 'abc'), false);
	});
});

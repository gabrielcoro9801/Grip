// Un file è quello che dice di essere.
//
// Il tipo lo dichiara il client: un file HTML mandato come `application/pdf` veniva salvato
// come .pdf e servito dalla scheda del socio al posto di un certificato. Ora i primi byte
// devono corrispondere al tipo dichiarato, e un file che non torna non resta sul disco.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { staffAccounts } from '../src/db/schema/index.js';
import { UPLOAD_DIR, percorsoDi, cancellaFile } from '../src/lib/fileCaricati.js';

const PASSWORD = 'prova-upload-1234';
const email = `upload.${Date.now()}@test.local`;
let app;
let token;
let idAccount;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

/** Un corpo multipart con un solo file, come lo manda il browser. */
function carica(contenuto, tipo, nome = 'file') {
	const confine = '----grip-prova';
	const corpo = Buffer.concat([
		Buffer.from(`--${confine}\r\nContent-Disposition: form-data; name="file"; filename="${nome}"\r\nContent-Type: ${tipo}\r\n\r\n`),
		contenuto,
		Buffer.from(`\r\n--${confine}--\r\n`),
	]);
	return app.inject({
		method: 'POST',
		url: '/api/uploads',
		headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${confine}` },
		payload: corpo,
	});
}

const fileSulDisco = async () => (await readdir(UPLOAD_DIR).catch(() => [])).length;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [account] = await db
		.insert(staffAccounts)
		.values({ nome: 'Admin Upload', email, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'admin' })
		.returning();
	idAccount = account.id;
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
	token = res.json().token;
});

after(async () => {
	if (idAccount) await db.delete(staffAccounts).where(inArray(staffAccounts.id, [idAccount]));
	await app.close();
	await pool.end();
});

describe('il contenuto deve corrispondere al tipo dichiarato', () => {
	test('un PNG vero e un PDF vero si caricano', async () => {
		for (const [contenuto, tipo] of [[PNG, 'image/png'], [PDF, 'application/pdf']]) {
			const res = await carica(contenuto, tipo);
			assert.equal(res.statusCode, 200, res.body);
			await cancellaFile(percorsoDi(res.json().file_url));
		}
	});

	test('una pagina HTML dichiarata PDF è rifiutata, e non resta sul disco', async () => {
		const prima = await fileSulDisco();
		const res = await carica(HTML, 'application/pdf', 'certificato.pdf');
		assert.equal(res.statusCode, 400, res.body);
		assert.equal(await fileSulDisco(), prima);
	});

	test('un PDF dichiarato immagine è rifiutato', async () => {
		const res = await carica(PDF, 'image/jpeg', 'foto.jpg');
		assert.equal(res.statusCode, 400, res.body);
	});

	test('un file vuoto è rifiutato', async () => {
		const res = await carica(Buffer.alloc(0), 'image/png', 'vuoto.png');
		assert.equal(res.statusCode, 400, res.body);
	});
});

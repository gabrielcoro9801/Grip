// Il codice d'accesso che cambia ogni minuto.
//
// La prima versione lo derivava nel browser con un digest non chiavato, e il seme viaggiava
// in chiaro dentro al codice mostrato: chiunque ricevesse uno screenshot poteva calcolare
// il codice di qualunque minuto, per sempre — mentre l'interfaccia prometteva l'esatto
// contrario. Questi controlli girano contro le rotte vere.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, qrAccessi } from '../src/db/schema/index.js';
import { codiceDinamico, verificaCodice, semeDelCodice } from '../src/lib/qrDinamico.js';
import { finestraCorrente, DURATA_FINESTRA_MS } from '../../shared/qrDinamico.js';

const PASSWORD = 'prova-qr-1234';
const SEME = 'GRIP-TEST-QRQR-AAAA-BBBB';

let app;
let tokenSocio;
let tokenStaff;
let idSocio;
let idQr;

function come(token, opzioni) {
	return app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}`, ...opzioni.headers } });
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const suffisso = Date.now();
	const [socio] = await db
		.insert(members)
		.values({ fullName: 'Socio QR', email: `socio.qr.${suffisso}@test.local` })
		.returning();
	idSocio = socio.id;

	const [qr] = await db
		.insert(qrAccessi)
		.values({ clienteId: socio.id, clienteName: 'Socio QR', codice: SEME, stato: 'attivo' })
		.returning();
	idQr = qr.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Reception QR', email: `rec.qr.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			{
				nome: 'Socio QR',
				email: `socio.qr.${suffisso}@test.local`,
				passwordHash,
				ruolo: 'member',
				linkedMemberId: socio.id,
			},
		])
		.returning();

	const accedi = async (email) => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
		assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
		return res.json().token;
	};
	tokenStaff = await accedi(account[0].email);
	tokenSocio = await accedi(account[1].email);
});

after(async () => {
	if (idQr) await db.delete(qrAccessi).where(inArray(qrAccessi.id, [idQr]));
	await db.delete(staffAccounts).where(inArray(staffAccounts.nome, ['Reception QR', 'Socio QR']));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio]));
	await app.close();
	await pool.end();
});

describe('la derivazione', () => {
	test('il token cambia a ogni minuto', () => {
		const adesso = finestraCorrente();
		assert.notEqual(codiceDinamico(SEME, adesso), codiceDinamico(SEME, adesso + 1));
	});

	test('due semi diversi non producono lo stesso codice', () => {
		const f = finestraCorrente();
		assert.notEqual(codiceDinamico(SEME, f), codiceDinamico('GRIP-ALTRO-SEME-XXXX-YYYY', f));
	});

	test('il codice del minuto scorso vale ancora, quello di due minuti fa no', () => {
		// La tolleranza copre la scansione lenta e i due orologi che non coincidono; oltre,
		// un codice vecchio deve smettere di funzionare, o non scadrebbe affatto.
		const adesso = Date.now();
		assert.equal(verificaCodice(SEME, codiceDinamico(SEME, finestraCorrente(adesso)), adesso), true);
		assert.equal(verificaCodice(SEME, codiceDinamico(SEME, finestraCorrente(adesso) - 1), adesso), true);
		assert.equal(verificaCodice(SEME, codiceDinamico(SEME, finestraCorrente(adesso) - 2), adesso), false);
	});

	test('un codice di domani non vale oggi', () => {
		const domani = Date.now() + 24 * 60 * 60 * 1000;
		const codiceFuturo = codiceDinamico(SEME, finestraCorrente(domani));
		assert.equal(verificaCodice(SEME, codiceFuturo, Date.now()), false);
	});

	test('dal codice si rilegge il seme, e nient\'altro', () => {
		assert.equal(semeDelCodice(codiceDinamico(SEME)), SEME);
		assert.equal(semeDelCodice('spazzatura'), null);
	});
});

describe("il socio chiede il proprio codice", () => {
	test('lo ottiene, e cambia entro il minuto', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: '/api/qr/codice' });
		assert.equal(res.statusCode, 200);
		const { codice, stato, ms_residui } = res.json();
		assert.equal(stato, 'attivo');
		assert.ok(codice.startsWith(SEME), 'il codice contiene il seme come identificativo');
		assert.ok(ms_residui > 0 && ms_residui <= DURATA_FINESTRA_MS);
	});

	test('non può chiedere quello di un altro socio', async () => {
		const res = await come(tokenSocio, {
			method: 'GET',
			url: `/api/qr/codice?cliente_id=00000000-0000-0000-0000-000000000000`,
		});
		assert.equal(res.statusCode, 403);
	});

	test('non può verificare codici: quello è il lavoro di chi apre la porta', async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/qr/verifica',
			payload: { codice: codiceDinamico(SEME) },
		});
		assert.equal(res.statusCode, 403);
	});
});

describe('la reception verifica', () => {
	test('un codice valido dice di chi è', async () => {
		const res = await come(tokenStaff, {
			method: 'POST',
			url: '/api/qr/verifica',
			payload: { codice: codiceDinamico(SEME) },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(res.json().valido, true);
		assert.equal(res.json().member_id, idSocio);
		assert.equal(res.json().member_name, 'Socio QR');
	});

	test('un codice inventato non passa', async () => {
		const res = await come(tokenStaff, {
			method: 'POST',
			url: '/api/qr/verifica',
			payload: { codice: `${SEME}-ZZZZZZ` },
		});
		assert.equal(res.json().valido, false);
	});

	test('un codice revocato non passa, per quanto sia fresco', async () => {
		// È il punto che rende la revoca una revoca: deve pesare sul controllo alla porta,
		// non su cosa il socio riesce a farsi disegnare sullo schermo.
		await db.update(qrAccessi).set({ stato: 'revocato' }).where(inArray(qrAccessi.id, [idQr]));
		const res = await come(tokenStaff, {
			method: 'POST',
			url: '/api/qr/verifica',
			payload: { codice: codiceDinamico(SEME) },
		});
		assert.equal(res.json().valido, false);
		assert.match(res.json().motivo, /revocato/i);

		// E il socio revocato non se ne fa dare uno nuovo dal portale.
		const suo = await come(tokenSocio, { method: 'GET', url: '/api/qr/codice' });
		assert.equal(suo.json().stato, 'assente');
		assert.equal(suo.json().codice, null);

		await db.update(qrAccessi).set({ stato: 'attivo' }).where(inArray(qrAccessi.id, [idQr]));
	});
});

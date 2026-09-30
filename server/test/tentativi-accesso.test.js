// Il login non limitava i tentativi: le password si provavano senza freni.
import test, { before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { staffAccounts } from '../src/db/schema/index.js';
import {
	secondiDiAttesa, registraFallimento, registraSuccesso, azzeraTentativi,
	MASSIMO_PER_EMAIL, MASSIMO_PER_IP, FINESTRA_MS,
} from '../src/lib/tentativiAccesso.js';

describe('il conto dei tentativi', () => {
	beforeEach(() => azzeraTentativi());

	test('dopo troppi errori sulla stessa email si aspetta, da qualunque IP', () => {
		const t = 1_000_000;
		for (let i = 0; i < MASSIMO_PER_EMAIL; i++) registraFallimento('Mario@Esempio.it', `10.0.0.${i}`, t);
		assert.ok(secondiDiAttesa('mario@esempio.it', '10.9.9.9', t) > 0, 'le maiuscole non cambiano l’account');
		assert.equal(secondiDiAttesa('altro@esempio.it', '10.9.9.9', t), 0);
	});

	test('dopo troppi errori dallo stesso IP si aspetta, su qualunque email', () => {
		const t = 1_000_000;
		for (let i = 0; i < MASSIMO_PER_IP; i++) registraFallimento(`persona${i}@esempio.it`, '10.0.0.1', t);
		assert.ok(secondiDiAttesa('nuova@esempio.it', '10.0.0.1', t) > 0);
		assert.equal(secondiDiAttesa('nuova@esempio.it', '10.0.0.2', t), 0);
	});

	test('passata la finestra si riprova', () => {
		const t = 1_000_000;
		for (let i = 0; i < MASSIMO_PER_EMAIL; i++) registraFallimento('a@b.it', null, t);
		assert.equal(secondiDiAttesa('a@b.it', null, t + FINESTRA_MS), 0);
	});

	test('un accesso riuscito azzera il conto di quell’email', () => {
		for (let i = 0; i < MASSIMO_PER_EMAIL - 1; i++) registraFallimento('a@b.it', null);
		registraSuccesso('a@b.it');
		registraFallimento('a@b.it', null);
		assert.equal(secondiDiAttesa('a@b.it', null), 0);
	});
});

describe("dall'API", () => {
	let app;
	let idAccount;
	const email = `tentativi.${Date.now()}@test.local`;
	const PASSWORD = 'prova-tentativi-1234';

	before(async () => {
		azzeraTentativi();
		app = buildApp({ logger: false });
		await app.ready();
		const [account] = await db.insert(staffAccounts)
			.values({ nome: 'Prova tentativi', email, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception' })
			.returning();
		idAccount = account.id;
	});

	after(async () => {
		azzeraTentativi();
		await db.delete(staffAccounts).where(inArray(staffAccounts.id, [idAccount]));
		await app.close();
		await pool.end();
	});

	const accedi = (password) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

	test('dopo troppi errori anche la password giusta aspetta, con un 429 che lo dice', async () => {
		for (let i = 0; i < MASSIMO_PER_EMAIL; i++) assert.equal((await accedi('sbagliata-sbagliata')).statusCode, 401);
		const bloccato = await accedi(PASSWORD);
		assert.equal(bloccato.statusCode, 429);
		assert.ok(Number(bloccato.headers['retry-after']) > 0);
		assert.match(bloccato.json().error, /Troppi tentativi/);
	});
});

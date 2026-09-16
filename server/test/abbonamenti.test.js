// I tipi di abbonamento del catalogo: nascono completi, si toccano solo nello stato, non si
// cancellano; e un'iscrizione si vende solo da un tipo vendibile, con la scadenza del server.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, plans, staffAccounts, subscriptions } from '../src/db/schema/index.js';

const PASSWORD = 'prova-abbonamenti-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);

let app;
let token;
let idSocio;
const idAccount = [];
const idTipi = [];

const come = (opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });
const creaTipo = (payload) => come({ method: 'POST', url: '/api/entities/Plan', payload });
const modificaTipo = (id, payload) => come({ method: 'PUT', url: `/api/entities/Plan/${id}`, payload });
const vendi = (payload) => come({ method: 'POST', url: '/api/entities/Subscription', payload: { member_id: idSocio, status: 'active', ...payload } });
const TIPO = { name: `Mensile ${suffisso}`, price: 40, durata_valore: 1, durata_unita: 'mesi' };

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [account] = await db
		.insert(staffAccounts)
		.values({ nome: 'Admin Abbonamenti', email: `adm.abb.${suffisso}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'admin' })
		.returning();
	idAccount.push(account.id);
	token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account.email, password: PASSWORD } })).json().token;
	const [socio] = await db.insert(members).values({ nome: 'Socio', cognome: 'Abbonamenti', codiceSocio: `AB${lettere}` }).returning();
	idSocio = socio.id;
});

after(async () => {
	await db.delete(subscriptions).where(eq(subscriptions.memberId, idSocio));
	if (idTipi.length) await db.delete(plans).where(inArray(plans.id, idTipi));
	await db.delete(members).where(eq(members.id, idSocio));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await app.close();
	await pool.end();
});

describe('il catalogo', () => {
	test('un tipo nasce attivo, qualunque stato gli si mandi', async () => {
		const res = await creaTipo({ ...TIPO, stato: 'annullato' });
		assert.equal(res.statusCode, 201, res.body);
		idTipi.push(res.json().id);
		assert.equal(res.json().stato, 'attivo');
		assert.equal(res.json().vendibile_fino_al, null);
	});

	test('durata, unità, note e data massima si controllano', async () => {
		assert.equal((await creaTipo({ ...TIPO, durata_valore: 0 })).statusCode, 400);
		assert.equal((await creaTipo({ ...TIPO, durata_unita: 'settimane' })).statusCode, 400);
		assert.equal((await creaTipo({ ...TIPO, description: 'x'.repeat(141) })).statusCode, 400);
		assert.equal((await creaTipo({ ...TIPO, vendibile_fino_al: '2000-01-01' })).statusCode, 400);
	});

	test('non si modifica: si cambia solo lo stato', async () => {
		const res = await modificaTipo(idTipi[0], { name: 'Altro nome' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /solo lo stato/);
		const sospeso = await modificaTipo(idTipi[0], { stato: 'sospeso' });
		assert.equal(sospeso.statusCode, 200, sospeso.body);
		assert.equal(sospeso.json().name, TIPO.name);
		assert.equal((await modificaTipo(idTipi[0], { stato: 'attivo' })).statusCode, 200);
	});

	test('non si elimina', async () => {
		const res = await come({ method: 'DELETE', url: `/api/entities/Plan/${idTipi[0]}` });
		assert.equal(res.statusCode, 400);
	});

	test('annullato è definitivo', async () => {
		const res = await creaTipo({ ...TIPO, name: `Da annullare ${suffisso}` });
		idTipi.push(res.json().id);
		assert.equal((await modificaTipo(res.json().id, { stato: 'annullato' })).statusCode, 200);
		const riattiva = await modificaTipo(res.json().id, { stato: 'attivo' });
		assert.equal(riattiva.statusCode, 400);
		assert.match(riattiva.json().error, /non si riattiva/);
	});
});

describe('vendere un abbonamento', () => {
	test('la scadenza la calcola il server, a mesi di calendario', async () => {
		const res = await vendi({ plan_id: idTipi[0], start_date: '2026-09-16', end_date: '2099-01-01', plan_name: 'Inventato' });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().end_date, '2026-10-15');
		assert.equal(res.json().plan_name, TIPO.name);
	});

	test('un tipo sospeso o annullato non si vende', async () => {
		assert.equal((await vendi({ plan_id: idTipi[1], start_date: '2026-09-16' })).statusCode, 400);
		await modificaTipo(idTipi[0], { stato: 'sospeso' });
		assert.equal((await vendi({ plan_id: idTipi[0], start_date: '2026-09-16' })).statusCode, 400);
		await modificaTipo(idTipi[0], { stato: 'attivo' });
	});

	test('oltre la data massima non si vende', async () => {
		await db.update(plans).set({ vendibileFinoAl: '2020-01-01' }).where(eq(plans.id, idTipi[0]));
		const res = await vendi({ plan_id: idTipi[0], start_date: '2026-09-16' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /fino al/);
	});
});

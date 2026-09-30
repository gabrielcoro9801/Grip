// I tipi di abbonamento del catalogo: nascono completi, si toccano solo nello stato, non si
// cancellano; e un'iscrizione si vende solo da un tipo vendibile, con la scadenza del server.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, plans, staffAccounts, subscriptions } from '../src/db/schema/index.js';
import { statoIscrizione, oggiIso } from '../../shared/abbonamenti.js';

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

	test('senza un tipo non si vende', async () => {
		const res = await vendi({ start_date: '2026-09-16', end_date: '2099-01-01', plan_name: 'Inventato' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /tipo di abbonamento/);
	});

	test('dopo la vendita si correggono solo inizio e importo, e la scadenza segue', async () => {
		const [venduta] = await db.select().from(subscriptions).where(eq(subscriptions.memberId, idSocio)).limit(1);
		const modifica = (payload) => come({ method: 'PUT', url: `/api/entities/Subscription/${venduta.id}`, payload });

		for (const campo of [{ end_date: '2099-01-01' }, { plan_id: idTipi[1] }, { member_id: idSocio }]) {
			const res = await modifica(campo);
			assert.equal(res.statusCode, 400, `${Object.keys(campo)[0]} non si deve poter cambiare`);
		}
		assert.equal((await modifica({ price_paid: -5 })).statusCode, 400);

		const res = await modifica({ start_date: '2026-10-01', price_paid: 35, status: 'expired' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().end_date, '2026-10-31');
		assert.equal(Number(res.json().price_paid), 35);
	});
});

// Nessun processo aggiornava la colonna `status`: un'iscrizione nasceva "active" e restava
// tale per sempre, e dashboard, filtri e portale mostravano come attivi abbonamenti scaduti.
describe('lo stato di un’iscrizione viene dalle date', () => {
	const oggi = '2026-09-30';

	test('"oggi" è il giorno di Roma, non quello UTC', () => {
		// Il server gira in UTC: fra mezzanotte e le due (ora legale) la sua data è ancora ieri,
		// e le lezioni di oggi risultavano "già passate", i giorni alla scadenza sbagliati di uno.
		assert.equal(oggiIso(new Date('2026-09-30T23:30:00Z')), '2026-10-01');
		assert.equal(oggiIso(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
	});

	test('la regola', () => {
		assert.equal(statoIscrizione({ end_date: '2026-09-29' }, oggi), 'expired');
		assert.equal(statoIscrizione({ end_date: '2026-09-30' }, oggi), 'expiring', "l'ultimo giorno vale ancora");
		assert.equal(statoIscrizione({ end_date: '2026-10-14' }, oggi), 'expiring');
		assert.equal(statoIscrizione({ end_date: '2026-10-15' }, oggi), 'active');
		assert.equal(statoIscrizione({ end_date: null }, oggi), 'active');
	});

	test("un'iscrizione scaduta esce scaduta, qualunque cosa dica la colonna", async () => {
		const [scaduta] = await db
			.insert(subscriptions)
			.values({ memberId: idSocio, planName: 'Vecchio', startDate: '2020-01-01', endDate: '2020-01-31', status: 'active' })
			.returning();
		const letta = (await come({ method: 'GET', url: `/api/entities/Subscription/${scaduta.id}` })).json();
		assert.equal(letta.status, 'expired');
	});

	test('e il filtro per stato guarda lo stato calcolato', async () => {
		const scadute = (await come({ method: 'GET', url: `/api/entities/Subscription?member_id=${idSocio}&status=expired` })).json();
		assert.ok(scadute.length >= 1);
		assert.ok(scadute.every((s) => s.status === 'expired'));
		const attive = (await come({ method: 'GET', url: `/api/entities/Subscription?member_id=${idSocio}&status=active` })).json();
		assert.ok(attive.every((s) => s.status === 'active'));
	});
});

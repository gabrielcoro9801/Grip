// I limiti dell'endpoint generico delle entità.
//
// Nessun tetto alle righe, `id` sovrascrivibile con un PUT, prenotazioni scritte a mano
// scavalcando capienza e lista d'attesa: tre scorciatoie aperte a chiunque avesse un permesso
// di scrittura qualunque.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { rooms, staffAccounts } from '../src/db/schema/index.js';

const suffisso = Date.now();
let app;
let token;
let idAccount;
let idAdmin;
const idSale = [];
const come = (opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const email = `generico.${suffisso}@test.local`;
	const [a] = await db.insert(staffAccounts).values({ nome: 'Prova generico', email, passwordHash: await bcrypt.hash('prova-generico-1234', 4), ruolo: 'reception' }).returning();
	idAccount = a.id;
	token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'prova-generico-1234' } })).json().token;
});

after(async () => {
	if (idSale.length) await db.delete(rooms).where(inArray(rooms.id, idSale));
	await db.delete(staffAccounts).where(eq(staffAccounts.id, idAccount));
	if (idAdmin) await db.delete(staffAccounts).where(eq(staffAccounts.id, idAdmin));
	await app.close();
	await pool.end();
});

describe('la chiave di una riga non si riscrive', () => {
	test('un PUT con un id diverso lascia l’id com’era', async () => {
		const sala = (await come({ method: 'POST', url: '/api/entities/Room', payload: { name: `Sala id ${suffisso}` } })).json();
		idSale.push(sala.id);
		const altro = '00000000-0000-0000-0000-000000000001';
		const res = await come({ method: 'PUT', url: `/api/entities/Room/${sala.id}`, payload: { id: altro, name: 'Rinominata' } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().id, sala.id);
	});

	test('nemmeno creando si sceglie l’id', async () => {
		const scelto = '00000000-0000-0000-0000-000000000002';
		const res = await come({ method: 'POST', url: '/api/entities/Room', payload: { id: scelto, name: `Sala scelta ${suffisso}` } });
		assert.equal(res.statusCode, 201, res.body);
		idSale.push(res.json().id);
		assert.notEqual(res.json().id, scelto);
	});
});

describe("l'email di un account è unica, maiuscole o no", () => {
	test('un secondo account con la stessa email scritta diversa non nasce', async () => {
		// Il login confronta in minuscolo: con due account così ne sceglieva uno a caso.
		const tokenAdmin = await (async () => {
			const email = `generico.admin.${suffisso}@test.local`;
			const [a] = await db.insert(staffAccounts).values({ nome: 'Admin generico', email, passwordHash: await bcrypt.hash('prova-generico-1234', 4), ruolo: 'admin' }).returning();
			idAdmin = a.id;
			return (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'prova-generico-1234' } })).json().token;
		})();
		const res = await app.inject({
			method: 'POST', url: '/api/entities/StaffAccount', headers: { authorization: `Bearer ${tokenAdmin}` },
			payload: { nome: 'Doppione', email: `GENERICO.${suffisso}@TEST.LOCAL`, ruolo: 'istruttore', password: 'doppione-12345' },
		});
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /già un account con questa email/);
	});
});

// Un id malformato o un testo troppo lungo finivano in "Errore interno del server": errori di
// chi chiede, trattati come guasti.
describe('gli errori di formato sono 400, non 500', () => {
	test('un id che non è un UUID', async () => {
		const res = await come({ method: 'GET', url: '/api/entities/Room/non-un-uuid' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /formato non valido/);
	});
});

describe('i tetti', () => {
	test('la creazione multipla ha un massimo', async () => {
		const troppe = Array.from({ length: 501 }, (_, i) => ({ name: `Sala ${i}` }));
		assert.equal((await come({ method: 'POST', url: '/api/entities/Room/bulk', payload: troppe })).statusCode, 400);
	});

	test('un _limit enorme non chiede più del massimo, e uno assurdo non rompe niente', async () => {
		assert.equal((await come({ method: 'GET', url: '/api/entities/Room?_limit=10000000' })).statusCode, 200);
		assert.equal((await come({ method: 'GET', url: '/api/entities/Room?_limit=abc' })).statusCode, 200);
	});
});

describe('le prenotazioni non passano dall’endpoint generico', () => {
	test('né creazione, né modifica, né cancellazione, nemmeno dallo staff', async () => {
		const id = '00000000-0000-0000-0000-000000000003';
		assert.equal((await come({ method: 'POST', url: '/api/entities/Booking', payload: { status: 'confirmed' } })).statusCode, 400);
		assert.equal((await come({ method: 'POST', url: '/api/entities/Booking/bulk', payload: [{ status: 'confirmed' }] })).statusCode, 400);
		assert.equal((await come({ method: 'PUT', url: `/api/entities/Booking/${id}`, payload: { status: 'confirmed' } })).statusCode, 400);
		assert.equal((await come({ method: 'DELETE', url: `/api/entities/Booking/${id}` })).statusCode, 400);
	});
});

// Gli utenti interni: il telefono, il codice fiscale e la partita IVA si controllano; il primo
// amministratore sta nel file di configurazione e non si cambia dall'applicazione; chi non è
// amministratore non crea né tocca un account admin, né assegna più di quanto ha.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { staffAccounts } from '../src/db/schema/index.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';

const PASSWORD = 'prova-utenti-1234';
const t = Date.now();
let app;
const token = {};
const id = { account: [] };

const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Amministratore prova', email: `ut.admin.${t}@test.local`, passwordHash, ruolo: 'admin' },
		{ nome: 'Gestore prova', email: `ut.gestore.${t}@test.local`, passwordHash, ruolo: 'gestore' },
		{ nome: 'Primo amministratore prova', email: `ut.protetto.${t}@test.local`, passwordHash, ruolo: 'admin', protetto: true },
	]).returning();
	id.account = account.map((a) => a.id);
	for (const [chi, a] of [['admin', account[0]], ['gestore', account[1]], ['protetto', account[2]]]) {
		token[chi] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: PASSWORD } })).json().token;
	}
	// Un ruolo con la gestione utenti ma senza i permessi dell'amministratore.
	impostaMatrice({
		permessi: { ...PERMESSI_PREDEFINITI, gestore: { utenti: ['view', 'edit'], ruoli: ['view'], crm_members: ['view'] } },
		capacita: {},
	});
});

after(async () => {
	ripristinaMatricePredefinita();
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await app.close();
	await pool.end();
});

describe('i dati di chi tiene dei corsi', () => {
	test('il telefono in formato sbagliato si rifiuta', async () => {
		const res = await come('admin', 'POST', '/api/entities/StaffAccount', { nome: 'Telefono Sbagliato', email: `tel.${t}@test.local`, password: PASSWORD, ruolo: 'reception', telefono: '333-98abc' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /non è un telefono valido/);
	});

	test('un telefono valido si salva in formato internazionale', async () => {
		const res = await come('admin', 'POST', '/api/entities/StaffAccount', { nome: 'Telefono Giusto', email: `tel.ok.${t}@test.local`, password: PASSWORD, ruolo: 'reception', telefono: '347 123 4567' });
		assert.equal(res.statusCode, 201);
		assert.match(res.json().telefono, /^\+39/);
		id.account.push(res.json().id);
	});

	test('codice fiscale e partita IVA non validi si rifiutano; vuoti sono ammessi', async () => {
		const cf = await come('admin', 'POST', '/api/entities/StaffAccount', { nome: 'CF', email: `cf.${t}@test.local`, password: PASSWORD, ruolo: 'reception', codice_fiscale: 'NONVALIDO' });
		assert.equal(cf.statusCode, 400);
		const piva = await come('admin', 'POST', '/api/entities/StaffAccount', { nome: 'PIVA', email: `piva.${t}@test.local`, password: PASSWORD, ruolo: 'reception', partita_iva: '123' });
		assert.equal(piva.statusCode, 400);
		const vuoti = await come('admin', 'POST', '/api/entities/StaffAccount', { nome: 'Senza dati', email: `vuoti.${t}@test.local`, password: PASSWORD, ruolo: 'reception', codice_fiscale: '', partita_iva: '' });
		assert.equal(vuoti.statusCode, 201);
		id.account.push(vuoti.json().id);
	});

	test("un account del portale non tiene corsi", async () => {
		const res = await come('admin', 'POST', '/api/entities/StaffAccount', { nome: 'Socio', email: `socio.${t}@test.local`, password: PASSWORD, ruolo: 'member', istruttore: true });
		assert.equal(res.statusCode, 400);
	});
});

describe('il primo amministratore', () => {
	test("non cambia email, ruolo e password dall'applicazione, e non si disattiva", async () => {
		const pid = id.account[2];
		assert.equal((await come('admin', 'PUT', `/api/entities/StaffAccount/${pid}`, { ruolo: 'reception' })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', `/api/entities/StaffAccount/${pid}`, { attivo: false })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', `/api/entities/StaffAccount/${pid}`, { email: `nuova.${t}@test.local` })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', `/api/entities/StaffAccount/${pid}`, { password: 'nuova-password-123' })).statusCode, 400);
	});

	test("non si elimina e non cambia la sua password da sé", async () => {
		const pid = id.account[2];
		assert.equal((await come('admin', 'DELETE', `/api/entities/StaffAccount/${pid}`)).statusCode, 400);
		const cambio = await come('protetto', 'POST', '/api/auth/change-password', { current_password: PASSWORD, new_password: 'nuova-password-123' });
		assert.equal(cambio.statusCode, 403);
	});

	test('il suo nome si può correggere', async () => {
		const pid = id.account[2];
		assert.equal((await come('admin', 'PUT', `/api/entities/StaffAccount/${pid}`, { nome: 'Primo amministratore' })).statusCode, 200);
	});
});

describe('chi non è amministratore', () => {
	test("non crea né modifica un account amministratore", async () => {
		const crea = await come('gestore', 'POST', '/api/entities/StaffAccount', { nome: 'Nuovo admin', email: `nuovo.admin.${t}@test.local`, password: PASSWORD, ruolo: 'admin' });
		assert.equal(crea.statusCode, 400);
		assert.match(crea.json().error, /Non puoi assegnare un ruolo/);
		const modifica = await come('gestore', 'PUT', `/api/entities/StaffAccount/${id.account[0]}`, { nome: 'Cambiato' });
		assert.equal(modifica.statusCode, 400);
		assert.match(modifica.json().error, /Solo l'amministratore/);
	});

	test('non assegna un ruolo con più permessi dei suoi', async () => {
		const res = await come('gestore', 'POST', '/api/entities/StaffAccount', { nome: 'Troppo', email: `troppo.${t}@test.local`, password: PASSWORD, ruolo: 'reception' });
		assert.equal(res.statusCode, 400);
	});

	test('crea un account con un ruolo che ha già', async () => {
		const res = await come('gestore', 'POST', '/api/entities/StaffAccount', { nome: 'Gestito', email: `gestito.${t}@test.local`, password: PASSWORD, ruolo: 'gestore' });
		assert.equal(res.statusCode, 201);
		id.account.push(res.json().id);
	});
});

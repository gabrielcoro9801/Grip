// Chi può leggere cosa, dal lato che conta.
//
// Il controllo dei permessi scattava solo sulle scritture: qualunque ruolo dello staff
// leggeva qualunque entità. Un istruttore apriva il registro delle azioni e l'elenco degli
// account, e un ruolo costruito senza i documenti leggeva lo stesso i certificati medici.
// Il menu nascondeva la voce; l'API rispondeva.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { staffAccounts } from '../src/db/schema/index.js';
import { canReadEntity, haRegolaDiLettura } from '../src/auth/authorize.js';
import { ENTITY_NAMES } from '../src/entities/registry.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';

describe('nessuna entità resta senza una decisione, nemmeno in lettura', () => {
	test('ogni entità del registro ha una regola di lettura', () => {
		// Una dimenticata è chiusa a tutto lo staff: meglio saperlo da qui che da un 403 in produzione.
		const dimenticate = ENTITY_NAMES.filter((entita) => !haRegolaDiLettura(entita));
		assert.deepEqual(dimenticate, [], `Entità senza regola di lettura: decidi in authorize.js chi le legge — ${dimenticate.join(', ')}`);
	});
});

describe('la matrice predefinita, in lettura', () => {
	test("l'istruttore non legge il registro né gli account", () => {
		for (const entita of ['AuditLog', 'StaffAccount', 'Collaboratore']) {
			assert.equal(canReadEntity('istruttore', entita), false, entita);
		}
	});

	test('la reception non legge il registro né gli account', () => {
		assert.equal(canReadEntity('reception', 'AuditLog'), false);
		assert.equal(canReadEntity('reception', 'StaffAccount'), false);
	});

	test("l'amministratore legge tutto", () => {
		for (const entita of ENTITY_NAMES) assert.equal(canReadEntity('admin', entita), true, entita);
	});

	test('i cataloghi li leggono tutti', () => {
		for (const ruolo of ['admin', 'reception', 'istruttore']) {
			for (const entita of ['Course', 'Session', 'Event', 'Room', 'Organization']) {
				assert.equal(canReadEntity(ruolo, entita), true, `${ruolo} / ${entita}`);
			}
		}
	});

	test('un socio non passa da questa regola', () => {
		assert.equal(canReadEntity('member', 'Course'), false);
	});
});

describe('un ruolo costruito a mano', () => {
	after(() => ripristinaMatricePredefinita());

	test('senza i documenti non legge i certificati', () => {
		impostaMatrice({
			permessi: { ...PERMESSI_PREDEFINITI, segreteria: { crm_members: ['view', 'edit'] } },
			capacita: {},
		});
		assert.equal(canReadEntity('segreteria', 'Member'), true);
		assert.equal(canReadEntity('segreteria', 'MemberDocument'), false);
	});

	test('con il solo calendario vede i nomi dei soci, ma non le loro iscrizioni', () => {
		impostaMatrice({
			permessi: { ...PERMESSI_PREDEFINITI, sala: { calendar: ['view', 'edit'] } },
			capacita: {},
		});
		assert.equal(canReadEntity('sala', 'Member'), true);
		assert.equal(canReadEntity('sala', 'Booking'), true);
		assert.equal(canReadEntity('sala', 'Subscription'), false);
		assert.equal(canReadEntity('sala', 'MemberDocument'), false);
	});
});

describe("dall'API", () => {
	let app;
	const idAccount = [];
	const token = {};
	const PASSWORD = 'prova-permessi-lettura-1234';

	before(async () => {
		app = buildApp({ logger: false });
		await app.ready();
		for (const ruolo of ['admin', 'istruttore', 'reception']) {
			const email = `lettura.${ruolo}.${Date.now()}@test.local`;
			const [account] = await db
				.insert(staffAccounts)
				.values({ nome: `Prova lettura ${ruolo}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo })
				.returning();
			idAccount.push(account.id);
			token[ruolo] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
		}
	});

	after(async () => {
		if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
		await app.close();
		await pool.end();
	});

	const leggi = (ruolo, url) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token[ruolo]}` } });

	test("un istruttore che chiede il registro delle azioni prende un 403", async () => {
		assert.equal((await leggi('istruttore', '/api/entities/AuditLog')).statusCode, 403);
	});

	test('un istruttore che chiede gli account prende un 403, anche per id', async () => {
		assert.equal((await leggi('istruttore', '/api/entities/StaffAccount')).statusCode, 403);
		assert.equal((await leggi('istruttore', `/api/entities/StaffAccount/${idAccount[0]}`)).statusCode, 403);
	});

	test("l'amministratore li legge", async () => {
		assert.equal((await leggi('admin', '/api/entities/StaffAccount?_limit=1')).statusCode, 200);
		assert.equal((await leggi('admin', '/api/entities/AuditLog?_limit=1')).statusCode, 200);
	});

	test('i cataloghi restano aperti a tutti', async () => {
		assert.equal((await leggi('istruttore', '/api/entities/Course?_limit=1')).statusCode, 200);
	});

	test("la scheda socio sa se c'è l'accesso al portale senza leggere gli account", async () => {
		const risposta = await leggi('reception', '/api/soci/00000000-0000-0000-0000-000000000000/accesso-portale');
		assert.equal(risposta.statusCode, 200, risposta.body);
		assert.deepEqual(risposta.json(), { account: null });
	});

	test("l'accesso al portale non lo chiede chi non ha le anagrafiche", async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { calendar: ['view'] } }, capacita: {} });
		try {
			const risposta = await leggi('istruttore', '/api/soci/00000000-0000-0000-0000-000000000000/accesso-portale');
			assert.equal(risposta.statusCode, 403);
		} finally {
			ripristinaMatricePredefinita();
		}
	});
});

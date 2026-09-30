// Il registro delle azioni lo scrive il server.
//
// Lo scriveva il browser, con attore, ruolo e orario scelti dal client: chiunque poteva
// aggiungere voci attribuite a un altro, e un'azione fatta direttamente sull'API non lasciava
// traccia. Queste prove passano dall'API come farebbe chiunque.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { auditLogs, rooms, staffAccounts } from '../src/db/schema/index.js';
import { tipoEntita, descriviModifica } from '../src/lib/registro.js';

const PASSWORD = 'prova-registro-1234';
const suffisso = Date.now();
let app;
const token = {};
const id = {};
const idSale = [];

const come = (chi, opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token[chi]}` } });
const vociSu = (entitaId) => db.select().from(auditLogs).where(eq(auditLogs.entitaId, String(entitaId)));

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	for (const ruolo of ['admin', 'reception']) {
		const email = `registro.${ruolo}.${suffisso}@test.local`;
		const [a] = await db.insert(staffAccounts).values({ nome: `Registro ${ruolo}`, email, passwordHash, ruolo }).returning();
		id[ruolo] = a.id;
		token[ruolo] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
	}
});

after(async () => {
	const tutti = [...Object.values(id), ...idSale].map(String);
	await db.delete(auditLogs).where(inArray(auditLogs.entitaId, tutti));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, Object.values(id)));
	if (idSale.length) await db.delete(rooms).where(inArray(rooms.id, idSale));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, Object.values(id)));
	await app.close();
	await pool.end();
});

describe('ogni modifica dello staff lascia una voce', () => {
	test('creare, modificare ed eliminare una sala: tre voci, con chi e quando lo dice il server', async () => {
		const sala = (await come('reception', { method: 'POST', url: '/api/entities/Room', payload: { name: `Sala registro ${suffisso}` } })).json();
		idSale.push(sala.id);
		await come('reception', { method: 'PUT', url: `/api/entities/Room/${sala.id}`, payload: { description: 'note' } });
		await come('reception', { method: 'DELETE', url: `/api/entities/Room/${sala.id}` });

		const voci = await vociSu(sala.id);
		assert.deepEqual(voci.map((v) => v.tipoAzione).sort(), ['create', 'delete', 'update']);
		for (const v of voci) {
			assert.equal(v.attoreId, id.reception);
			assert.equal(v.attoreNome, 'Registro reception');
			assert.equal(v.ruoloAttore, 'reception');
			assert.equal(v.entitaTipo, 'room');
			assert.ok(Date.now() - new Date(v.timestamp).getTime() < 60_000, "l'orario è quello del server");
		}
		assert.match(voci.find((v) => v.tipoAzione === 'update').dettagli, /description/);
	});

	test('un reset di password si registra come tale, senza la password', async () => {
		await come('admin', { method: 'PUT', url: `/api/entities/StaffAccount/${id.reception}`, payload: { password: 'nuova-password-reception' } });
		const [voce] = (await vociSu(id.reception)).filter((v) => v.tipoAzione === 'password_reset');
		assert.ok(voce, 'il reset non è nel registro');
		assert.doesNotMatch(JSON.stringify(voce), /nuova-password-reception/);
		await db.update(staffAccounts).set({ passwordHash: await bcrypt.hash(PASSWORD, 4), passwordDaCambiare: false }).where(eq(staffAccounts.id, id.reception));
		token.reception = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `registro.reception.${suffisso}@test.local`, password: PASSWORD } })).json().token;
	});
});

describe('dal browser non si scrive più', () => {
	test('nemmeno l’amministratore aggiunge voci a mano', async () => {
		const res = await come('admin', {
			method: 'POST', url: '/api/entities/AuditLog',
			payload: { attore_nome: 'Qualcun altro', tipo_azione: 'delete', entita_tipo: 'member', timestamp: '2020-01-01T00:00:00Z' },
		});
		assert.equal(res.statusCode, 403);
		const falsi = await db.select().from(auditLogs).where(and(eq(auditLogs.attoreNome, 'Qualcun altro'), eq(auditLogs.tipoAzione, 'delete')));
		assert.equal(falsi.length, 0);
	});
});

describe('le regole, come pezzi a sé', () => {
	test('il tipo di entità', () => {
		assert.equal(tipoEntita('StaffAccount'), 'staff_account');
		assert.equal(tipoEntita('Member'), 'member');
	});

	test('ruolo cambiato: prima e dopo', () => {
		assert.deepEqual(
			descriviModifica({ ruolo: 'istruttore' }, { ruolo: 'admin' }),
			{ tipoAzione: 'role_change', dettagli: 'Ruolo cambiato', valorePrecedente: 'istruttore', valoreNuovo: 'admin' },
		);
	});
});

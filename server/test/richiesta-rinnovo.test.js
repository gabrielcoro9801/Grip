// "Richiedi il rinnovo" dal portale: il socio chiede per sé, la richiesta va in cima a Oggi, il
// socio vede che è arrivata, e la chiude un contatto riuscito (non un "non ha risposto").
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, subscriptions, attivita, ingressi, auditLogs } from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-rinnovo-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (n) => spostaGiorni(oggiIso(), n);
const emailSocio = `rinnovo.socio.${t}@test.local`;

let app;
const token = {};
const id = { socio: null, persona: null, account: [] };
const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const inOggi = async () => (await come('reception', 'GET', '/api/segnali?da_fare=1')).json().persone.find((p) => p.socio_id === id.socio);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [socio] = await db.insert(members).values({ nome: 'Vuole', cognome: `Rinnovare${lettere}`, codiceSocio: `RR${lettere}`, email: emailSocio }).returning();
	id.socio = socio.id; id.persona = socio.personaId;
	// Valido per mesi ed entra spesso: senza la richiesta non avrebbe niente da fare.
	await db.insert(subscriptions).values({ memberId: socio.id, planName: 'Trimestrale', startDate: '2025-01-01', endDate: fra(60) });
	await db.insert(ingressi).values([1, 3, 6].map((g) => ({ memberId: socio.id, entratoAlle: new Date(`${fra(-g)}T08:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test' })));
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Rinnovo', email: `rinnovo.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Vuole Rinnovare', email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.socio = await login(emailSocio);
});

after(async () => {
	await db.delete(attivita).where(eq(attivita.personaId, id.persona));
	await db.delete(ingressi).where(eq(ingressi.memberId, id.socio));
	await db.delete(subscriptions).where(eq(subscriptions.memberId, id.socio));
	await db.delete(auditLogs).where(eq(auditLogs.entitaId, id.socio));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(eq(members.id, id.socio));
	await app.close();
	await pool.end();
});

describe('richiedi il rinnovo', () => {
	test('lo staff non passa dalla rotta del portale', async () => {
		assert.equal((await come('reception', 'POST', '/api/member/v1/abbonamento/richiesta-rinnovo')).statusCode, 403);
	});

	test('il socio chiede: una riga nel diario, e la seconda volta non se ne crea un\'altra', async () => {
		assert.equal((await inOggi()), undefined, 'prima non ha niente da fare');
		const prima = await come('socio', 'POST', '/api/member/v1/abbonamento/richiesta-rinnovo');
		assert.equal(prima.statusCode, 201, prima.body);
		const seconda = await come('socio', 'POST', '/api/member/v1/abbonamento/richiesta-rinnovo');
		assert.equal(seconda.statusCode, 200);
		assert.equal(seconda.json().richiesta_rinnovo.il, prima.json().richiesta_rinnovo.il);
		const righe = await db.select().from(attivita).where(eq(attivita.personaId, id.persona));
		assert.equal(righe.filter((r) => r.tipo === 'richiesta_rinnovo').length, 1);
		assert.ok((await come('socio', 'GET', '/api/member/v1/abbonamenti')).json().richiesta_rinnovo);
	});

	test('in Oggi è il primo segnale; un "non ha risposto" non la chiude', async () => {
		const p = await inOggi();
		assert.equal(p.da_fare[0], 'rinnovo_richiesto');
		const res = await come('reception', 'POST', `/api/persone/${id.persona}/contatti`, { canale: 'telefono', esito: 'nessuna_risposta' });
		assert.equal(res.statusCode, 201);
		assert.equal((await inOggi())?.da_fare[0], 'rinnovo_richiesto');
	});

	test('un contatto riuscito la chiude: sparisce da Oggi, e il socio può chiederla di nuovo', async () => {
		const res = await come('reception', 'POST', `/api/persone/${id.persona}/contatti`, { canale: 'telefono', esito: 'proposto_rinnovo' });
		assert.equal(res.statusCode, 201);
		assert.equal(await inOggi(), undefined);
		assert.equal((await come('socio', 'GET', '/api/member/v1/abbonamenti')).json().richiesta_rinnovo, null);
	});
});

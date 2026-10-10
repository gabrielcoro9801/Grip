// Il giro misura l'efficacia: chi, contattato perché assente, rientra entro 14 giorni, lascia una
// riga `ingresso_dopo_contatto` nel diario. Una per contatto, anche rilanciando il giro.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, subscriptions, attivita, ingressi } from '../src/db/schema/index.js';
import { giro } from '../src/giro.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-rientri-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (n) => spostaGiorni(oggiIso(), n);
const giorniFa = (n) => new Date(Date.now() - n * 86_400_000);

let app;
let token;
const id = { soci: [], persone: [], account: null };

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const soci = await db.insert(members).values([
		{ nome: 'Assente', cognome: `Rientri${lettere}`, codiceSocio: `RA${lettere}` },
		{ nome: 'Regolare', cognome: `Rientri${lettere}`, codiceSocio: `RB${lettere}` },
		{ nome: 'Tornato', cognome: `Rientri${lettere}`, codiceSocio: `RC${lettere}` },
	]).returning();
	id.soci = soci.map((s) => s.id); id.persone = soci.map((s) => s.personaId);
	await db.insert(subscriptions).values(soci.map((s) => ({ memberId: s.id, planName: 'Annuale', startDate: '2025-01-01', endDate: fra(200) })));
	// Il primo non entra da 20 giorni; il secondo è entrato ieri.
	await db.insert(ingressi).values([
		{ memberId: soci[0].id, entratoAlle: giorniFa(20), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test' },
		{ memberId: soci[1].id, entratoAlle: giorniFa(1), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test' },
		// Il terzo non veniva da un mese, ed è appena passato dal tornello.
		{ memberId: soci[2].id, entratoAlle: giorniFa(30), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Test' },
		{ memberId: soci[2].id, entratoAlle: new Date(), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Test' },
	]);
	const [account] = await db.insert(staffAccounts).values({
		nome: 'Reception Rientri', email: `rientri.${t}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception',
	}).returning();
	id.account = account.id;
	token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account.email, password: PASSWORD } })).json().token;
});

after(async () => {
	await db.delete(attivita).where(inArray(attivita.personaId, id.persone));
	await db.delete(ingressi).where(inArray(ingressi.memberId, id.soci));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
	await db.delete(staffAccounts).where(eq(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, id.soci));
	await app.close();
	await pool.end();
});

describe('chi è entrato dal tornello', () => {
	test('in cima a Da fare, con il bentornato; segnato il saluto, sparisce', async () => {
		const come = (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
		const entrati = async () => (await come('GET', '/api/segnali?entrati_oggi=1&tipo=soci')).json().persone.filter((p) => id.soci.includes(p.socio_id));
		const [p] = await entrati();
		assert.equal(p.socio_id, id.soci[2]);
		assert.equal(p.bancone[0].codice, 'bentornato');
		assert.match(p.bancone[0].motivo, /30 giorni/);
		assert.equal((await come('POST', `/api/persone/${id.persone[2]}/contatti`, { canale: 'di_persona', esito: 'salutato', segnale: 'bentornato' })).statusCode, 201);
		assert.deepEqual(await entrati(), []);
	});
});

describe('il rientro dopo un contatto', () => {
	test('il "Fatto" ricorda per che cosa: solo un segnale che la persona ha', async () => {
		const fatto = (persona) => app.inject({
			method: 'POST', url: `/api/persone/${persona}/contatti`, payload: { canale: 'telefono', segnale: 'assente' },
			headers: { authorization: `Bearer ${token}` },
		});
		const res = await fatto(id.persone[0]);
		assert.equal(res.statusCode, 201, res.body);
		const [assente] = await db.select().from(attivita).where(and(eq(attivita.personaId, id.persone[0]), eq(attivita.tipo, 'contatto')));
		assert.deepEqual(assente.riferimento, { segnali: ['assente'] });
		// Il regolare non è assente: non c'è niente da segnare come fatto.
		assert.equal((await fatto(id.persone[1])).statusCode, 400);
	});

	test('rientrato 3 giorni dopo: una riga nel diario, anche lanciando il giro due volte', async () => {
		// Il contatto di 5 giorni fa, l'ingresso di 2 giorni fa; per il regolare un ingresso dopo, che non conta.
		await db.update(attivita).set({ createdDate: giorniFa(5) }).where(and(inArray(attivita.personaId, id.persone), eq(attivita.tipo, 'contatto')));
		await db.insert(ingressi).values(id.soci.slice(0, 2).map((s) => ({ memberId: s, entratoAlle: giorniFa(2), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test' })));
		await giro();
		await giro();
		const rientri = await db.select().from(attivita).where(and(inArray(attivita.personaId, id.persone), eq(attivita.tipo, 'ingresso_dopo_contatto')));
		assert.equal(rientri.length, 1);
		assert.equal(rientri[0].personaId, id.persone[0]);
		assert.equal(rientri[0].esito, '3');
		assert.ok(rientri[0].riferimento.contatto && rientri[0].riferimento.ingresso);
	});
});

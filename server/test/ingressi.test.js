// Gli ingressi in palestra, contro le rotte vere: il semaforo, la registrazione, la deroga che
// finisce nel registro, i permessi e le statistiche (compreso chi non viene più).
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, subscriptions, ingressi, auditLogs } from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-ingressi-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();

let app;
const token = {};
const id = { soci: {}, account: [] };

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	// verde: abbonamento in regola; giallo: abbonamento in scadenza; rosso: niente abbonamento;
	// assente: abbonamento valido da tempo ma mai entrato (rischio abbandono).
	const [verde, giallo, rosso, assente] = await db.insert(members).values(['Verde', 'Giallo', 'Rosso', 'Assente'].map((n, i) => ({
		nome: n, cognome: 'Ingresso', codiceSocio: `IN${'ABCD'[i]}${lettere}`, dateOfBirth: '1990-01-01', phone: '333 000000',
	}))).returning();
	id.soci = { verde: verde.id, giallo: giallo.id, rosso: rosso.id, assente: assente.id };
	await db.insert(subscriptions).values([verde, giallo, assente].map((s) => ({
		memberId: s.id, planName: 'Annuale', startDate: spostaGiorni(oggi, -60), endDate: spostaGiorni(oggi, s === giallo ? 3 : 300),
	})));
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Ingressi', email: `ing.rec.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Istruttore Ingressi', email: `ing.ist.${t}@test.local`, passwordHash, ruolo: 'istruttore' },
		{ nome: 'Socio Ingressi', email: `ing.soc.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: verde.id },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.istruttore = await login(account[1].email);
	token.socio = await login(account[2].email);
});

after(async () => {
	const tutti = Object.values(id.soci);
	await db.delete(ingressi).where(inArray(ingressi.memberId, tutti));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, tutti));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, id.account));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, tutti));
	await app.close();
	await pool.end();
});

const verifica = (chi) => come('reception', 'POST', '/api/ingressi/verifica', { member_id: id.soci[chi] });

describe('il semaforo', () => {
	test('verde: in regola; giallo: abbonamento in scadenza; rosso: senza abbonamento', async () => {
		const v = (await verifica('verde')).json();
		assert.equal(v.valido, true);
		assert.equal(v.semaforo, 'verde');
		assert.equal(v.metodo, 'manuale');
		assert.equal(v.socio.nome, 'Verde Ingresso');

		const g = (await verifica('giallo')).json();
		assert.equal(g.semaforo, 'giallo');
		assert.deepEqual(g.avvisi.map((a) => a.codice), ['abbonamento_in_scadenza']);

		const r = (await verifica('rosso')).json();
		assert.equal(r.semaforo, 'rosso');
		assert.equal(r.avvisi[0].codice, 'abbonamento_non_valido');
	});

	test('senza il socio non si verifica: il codice QR non esiste più', async () => {
		assert.equal((await come('reception', 'POST', '/api/ingressi/verifica', { codice: 'GRIP-XXXX' })).statusCode, 400);
	});
});

describe('registrare', () => {
	test('verde e giallo si registrano; rosso solo in deroga, e la deroga va nel registro', async () => {
		const v = await come('reception', 'POST', '/api/ingressi', { member_id: id.soci.verde });
		assert.equal(v.statusCode, 201, v.body);
		assert.equal(v.json().ingresso.esito, 'ammesso');
		assert.equal((await come('reception', 'POST', '/api/ingressi', { member_id: id.soci.giallo })).json().ingresso.esito, 'ammesso_con_avvisi');

		const respinto = await come('reception', 'POST', '/api/ingressi', { member_id: id.soci.rosso });
		assert.equal(respinto.statusCode, 409);
		const deroga = await come('reception', 'POST', '/api/ingressi', { member_id: id.soci.rosso, deroga: true });
		assert.equal(deroga.json().ingresso.esito, 'ammesso_in_deroga');
		const voci = await db.select().from(auditLogs).where(eq(auditLogs.entitaId, id.soci.rosso));
		assert.ok(voci.some((v) => /deroga/.test(v.dettagli)));

		const [riga] = await db.select().from(ingressi).where(eq(ingressi.memberId, id.soci.giallo));
		assert.equal(riga.metodo, 'manuale', 'anche se il client chiede altro');
		assert.deepEqual(riga.avvisi, ['abbonamento_in_scadenza']);
		assert.equal(riga.registratoDaNome, 'Reception Ingressi');
	});

	test("il registro di oggi, e l'ultimo ingresso nella scheda", async () => {
		const elenco = (await come('reception', 'GET', '/api/ingressi')).json().ingressi;
		assert.ok(elenco.some((i) => i.member_id === id.soci.verde));
		assert.ok((await verifica('verde')).json().ultimo_ingresso);
	});

	test("l'istruttore verifica ma non registra; il socio nessuna delle due", async () => {
		assert.equal((await come('istruttore', 'POST', '/api/ingressi/verifica', { member_id: id.soci.verde })).statusCode, 200);
		assert.equal((await come('istruttore', 'POST', '/api/ingressi', { member_id: id.soci.verde })).statusCode, 403);
		// La query string non cambia la rotta: con '?x=1' resta una scrittura (audit di sicurezza).
		assert.equal((await come('istruttore', 'POST', '/api/ingressi?x=1', { member_id: id.soci.verde })).statusCode, 403);
		assert.equal((await come('socio', 'POST', '/api/ingressi/verifica', { member_id: id.soci.verde })).statusCode, 403);
		assert.equal((await come('socio', 'GET', '/api/ingressi')).statusCode, 403);
	});
});

describe('a mano, a posteriori, e da annullare', () => {
	test("il semaforo è quello del giorno dell'ingresso; nel futuro no", async () => {
		// Abbonamento finito ieri: ieri entrava (giallo: era l'ultimo giorno, quindi "in scadenza"), oggi no.
		const ieri = spostaGiorni(oggi, -1);
		const [socio] = await db.insert(members).values({ nome: 'Ieri', cognome: 'Ingresso', codiceSocio: `INE${lettere}`, dateOfBirth: '1990-01-01' }).returning();
		id.soci.ieri = socio.id;
		await db.insert(subscriptions).values({ memberId: socio.id, planName: 'Mensile', startDate: spostaGiorni(oggi, -30), endDate: ieri });
		const alle = `${ieri}T10:00:00Z`;
		assert.equal((await come('reception', 'POST', '/api/ingressi/verifica', { member_id: socio.id, alle })).json().semaforo, 'giallo');
		assert.equal((await come('reception', 'POST', '/api/ingressi/verifica', { member_id: socio.id })).json().semaforo, 'rosso');
		const r = await come('reception', 'POST', '/api/ingressi', { member_id: socio.id, metodo: 'manuale', entrato_alle: alle });
		assert.equal(r.statusCode, 201, r.body);
		assert.equal(r.json().ingresso.esito, 'ammesso_con_avvisi', 'non in deroga');
		assert.equal(new Date(r.json().ingresso.entrato_alle).toISOString(), new Date(alle).toISOString());
		assert.ok((await come('reception', 'GET', `/api/ingressi?dal=${ieri}&al=${ieri}`)).json().ingressi.some((i) => i.member_id === socio.id));

		const domani = new Date(Date.now() + 60 * 60_000).toISOString();
		assert.equal((await come('reception', 'POST', '/api/ingressi', { member_id: socio.id, entrato_alle: domani })).statusCode, 400);
		assert.equal((await come('reception', 'POST', '/api/ingressi', { member_id: socio.id, entrato_alle: 'ieri sera' })).statusCode, 400);
	});

	test("annullare: lo staff che modifica i soci sì, l'istruttore no; resta nel registro", async () => {
		const { ingresso } = (await come('reception', 'POST', '/api/ingressi', { member_id: id.soci.verde, metodo: 'manuale' })).json();
		assert.equal((await come('istruttore', 'DELETE', `/api/ingressi/${ingresso.id}`)).statusCode, 403);
		assert.equal((await come('reception', 'DELETE', `/api/ingressi/${ingresso.id}`)).statusCode, 204);
		assert.equal((await come('reception', 'DELETE', `/api/ingressi/${ingresso.id}`)).statusCode, 404);
		assert.ok(!(await come('reception', 'GET', '/api/ingressi')).json().ingressi.some((i) => i.id === ingresso.id));
		const voci = await db.select().from(auditLogs).where(eq(auditLogs.entitaId, id.soci.verde));
		assert.ok(voci.some((v) => v.tipoAzione === 'delete' && /Ingresso annullato/.test(v.dettagli)));
	});
});

describe('le statistiche', () => {
	test('conti del periodo, mappa e soci a rischio di abbandono', async () => {
		const s = (await come('reception', 'GET', '/api/ingressi/statistiche?giorni=30')).json();
		assert.equal(s.perGiorno.length, 30);
		assert.ok(s.perGiorno.at(-1).ingressi >= 3);
		assert.equal(s.mappa.length, 7);
		assert.equal(s.mappa[0].length, s.fasce.length);
		// Chi ha l'abbonamento da 60 giorni e non è mai entrato è a rischio; chi è entrato oggi no.
		assert.ok(s.rischio.some((r) => r.id === id.soci.assente && r.ultimo_ingresso === null));
		assert.ok(!s.rischio.some((r) => r.id === id.soci.verde));
		assert.ok(!s.rischio.some((r) => r.id === id.soci.rosso), 'senza abbonamento non è a rischio: è già fuori');
	});
});

describe('gli stessi avvisi nel portale del socio', () => {
	test("in regola: nessun avviso; l'abbonamento che sta per finire compare, e sparisce col rinnovo", async () => {
		const prima = (await come('socio', 'GET', '/api/member/v1/notifiche')).json();
		assert.deepEqual(prima.avvisi_elenco, []);
		assert.deepEqual(Object.keys((await come('socio', 'GET', '/api/member/v1/notifiche?solo_conteggio=1')).json()).sort(), ['avvisi', 'avvisi_gravi', 'non_lette']);

		await db.update(subscriptions).set({ endDate: spostaGiorni(oggi, 2) }).where(eq(subscriptions.memberId, id.soci.verde));
		const dopo = (await come('socio', 'GET', '/api/member/v1/notifiche')).json();
		assert.deepEqual(dopo.avvisi_elenco.map((a) => a.codice), ['abbonamento_in_scadenza']);
		assert.equal(dopo.avvisi, 1);
		assert.equal(dopo.avvisi_gravi, false);
		assert.equal(dopo.avvisi_elenco[0].azione, 'abbonamento');

		await db.insert(subscriptions).values({ memberId: id.soci.verde, planName: 'Annuale', startDate: spostaGiorni(oggi, 3), endDate: spostaGiorni(oggi, 365) });
		assert.deepEqual((await come('socio', 'GET', '/api/member/v1/notifiche')).json().avvisi_elenco, []);
	});
});

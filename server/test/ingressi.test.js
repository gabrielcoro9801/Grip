// Gli ingressi al bancone, contro le rotte vere: il semaforo, la registrazione, la deroga che
// finisce nel registro, i permessi e le statistiche (compreso chi non viene più).
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, subscriptions, memberDocuments, qrAccessi, ingressi, auditLogs } from '../src/db/schema/index.js';
import { codiceDinamico } from '../src/lib/qrDinamico.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-ingressi-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();

let app;
const token = {};
const id = { soci: {}, account: [] };
const semi = {};

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	// verde: abbonamento e documenti in regola; giallo: certificato scaduto; rosso: niente abbonamento;
	// assente: abbonamento valido da tempo ma mai entrato (rischio abbandono).
	const [verde, giallo, rosso, assente] = await db.insert(members).values(['Verde', 'Giallo', 'Rosso', 'Assente'].map((n, i) => ({
		nome: n, cognome: 'Ingresso', codiceSocio: `IN${'ABCD'[i]}${lettere}`, dateOfBirth: '1990-01-01', phone: '333 000000',
	}))).returning();
	id.soci = { verde: verde.id, giallo: giallo.id, rosso: rosso.id, assente: assente.id };
	await db.insert(subscriptions).values([verde, giallo, assente].map((s) => ({ memberId: s.id, planName: 'Annuale', startDate: spostaGiorni(oggi, -60), endDate: spostaGiorni(oggi, 300) })));
	const documenti = (m, scadenzaCertificato) => [
		{ memberId: m, documentType: 'certificato_medico', expiryDate: scadenzaCertificato },
		{ memberId: m, documentType: 'documento_identita', expiryDate: spostaGiorni(oggi, 900) },
	];
	await db.insert(memberDocuments).values([...documenti(verde.id, spostaGiorni(oggi, 200)), ...documenti(giallo.id, spostaGiorni(oggi, -3)), ...documenti(assente.id, spostaGiorni(oggi, 200))]);
	for (const [chi, m] of Object.entries({ verde, giallo, rosso })) {
		semi[chi] = `GRIP-${chi.toUpperCase()}-${lettere}`;
		await db.insert(qrAccessi).values({ clienteId: m.id, clienteName: m.fullName, codice: semi[chi] });
	}
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
	await db.delete(qrAccessi).where(inArray(qrAccessi.clienteId, tutti));
	await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, tutti));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, tutti));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, id.account));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, tutti));
	await app.close();
	await pool.end();
});

const verifica = (chi, codice) => come('reception', 'POST', '/api/ingressi/verifica', { codice: codiceDinamico(semi[chi]) ?? codice });

describe('il semaforo al bancone', () => {
	test('verde: in regola; giallo: certificato scaduto; rosso: senza abbonamento', async () => {
		const v = (await verifica('verde')).json();
		assert.equal(v.valido, true);
		assert.equal(v.semaforo, 'verde');
		assert.equal(v.metodo, 'qr');
		assert.equal(v.socio.nome, 'Verde Ingresso');

		const g = (await verifica('giallo')).json();
		assert.equal(g.semaforo, 'giallo');
		assert.deepEqual(g.avvisi.map((a) => a.codice), ['certificato_medico_scaduto']);

		const r = (await verifica('rosso')).json();
		assert.equal(r.semaforo, 'rosso');
		assert.equal(r.avvisi[0].codice, 'abbonamento_non_valido');
	});

	test('un codice inventato, o revocato, non è valido', async () => {
		assert.deepEqual((await come('reception', 'POST', '/api/ingressi/verifica', { codice: 'XYZ' })).json(), { valido: false, motivo: 'Codice illeggibile.' });
		await db.update(qrAccessi).set({ stato: 'revocato' }).where(eq(qrAccessi.codice, semi.verde));
		try {
			assert.equal((await verifica('verde')).json().motivo, 'Codice revocato.');
		} finally {
			await db.update(qrAccessi).set({ stato: 'attivo' }).where(eq(qrAccessi.codice, semi.verde));
		}
	});

	test('la ricerca per nome dà la stessa scheda, con metodo manuale', async () => {
		const m = (await come('reception', 'POST', '/api/ingressi/verifica', { member_id: id.soci.giallo })).json();
		assert.equal(m.metodo, 'manuale');
		assert.equal(m.semaforo, 'giallo');
	});
});

describe('registrare', () => {
	test('verde e giallo si registrano; rosso solo in deroga, e la deroga va nel registro', async () => {
		const v = await come('reception', 'POST', '/api/ingressi', { member_id: id.soci.verde, metodo: 'qr' });
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
		assert.deepEqual(riga.avvisi, ['certificato_medico_scaduto']);
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
		assert.equal((await come('socio', 'POST', '/api/ingressi/verifica', { member_id: id.soci.verde })).statusCode, 403);
		assert.equal((await come('socio', 'GET', '/api/ingressi')).statusCode, 403);
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

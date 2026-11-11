// La ricerca di chi prenotare a una lezione: GET /api/soci/cerca.
//
// Usa la regola dell'elenco dei soci (shared/ricerca.js): «Cognome Nome» in qualunque ordine,
// senza badare agli accenti. Restituisce 15 soci per pagina e il totale; gli archiviati non ci
// sono, perché non prenotano. La chiede chi modifica il calendario, non chi gestisce i soci.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, persone } from '../src/db/schema/index.js';

const PASSWORD = 'prova-ricerca-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
// Un cognome che nel database di prova c'è solo qui.
const COGNOME = `Ricercà${lettere}`;
const COGNOME_SCRITTO = `ricerca${lettere.toLowerCase()}`;

let app;
const token = {};
const id = { soci: [], account: [] };

const come = (chi, url) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token[chi]}` } });
const cerca = (q, pagina) => come('istruttore', `/api/soci/cerca?q=${encodeURIComponent(q)}${pagina ? `&pagina=${pagina}` : ''}`);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	// Diciassette soci con lo stesso cognome: una pagina piena e una da due. Più uno archiviato.
	const valori = Array.from({ length: 17 }, (_, i) => ({
		nome: i === 0 ? 'Niccolò' : `Nome${String(i).padStart(2, '0')}`,
		cognome: COGNOME,
		codiceSocio: `RC${String(i).padStart(2, '0')}${lettere}`.slice(0, 16),
		dateOfBirth: '1990-05-0' + ((i % 9) + 1),
	}));
	valori.push({ nome: 'Archiviato', cognome: COGNOME, codiceSocio: `RX${lettere}`.slice(0, 16), archiviatoIl: '2026-01-01' });
	const soci = await db.insert(members).values(valori).returning();
	id.soci = soci.map((s) => s.id);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Istruttore Ricerca', email: `ricerca.istruttore.${suffisso}@test.local`, passwordHash, ruolo: 'istruttore' },
		{ nome: 'Socio Ricerca', email: `ricerca.socio.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[1] },
	]).returning();
	id.account = account.map((a) => a.id);
	for (const [chi, a] of [['istruttore', account[0]], ['socio', account[1]]]) {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: PASSWORD } });
		token[chi] = res.json().token;
	}
});

after(async () => {
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	const idPersone = (await db.select({ id: members.personaId }).from(members).where(inArray(members.id, id.soci))).map((p) => p.id);
	await db.delete(members).where(inArray(members.id, id.soci));
	if (idPersone.length) await db.delete(persone).where(inArray(persone.id, idPersone));
	await app.close();
	await pool.end();
});

describe('GET /api/soci/cerca', () => {
	test('«Cognome Nome» trova il socio, anche scritto senza accenti', async () => {
		const res = await cerca(`${COGNOME_SCRITTO} Niccolo`);
		assert.equal(res.statusCode, 200, res.body);
		const { soci, totale } = res.json();
		assert.equal(totale, 1);
		assert.deepEqual(soci[0], {
			id: id.soci[0], nome: 'Niccolò', cognome: COGNOME, date_of_birth: '1990-05-01', codice_socio: `RC00${lettere}`.slice(0, 16),
		});
		// Nell'altro ordine, e con le maiuscole: lo stesso socio.
		const inverso = (await cerca(`NICCOLÒ ${COGNOME_SCRITTO}`)).json();
		assert.deepEqual(inverso.soci.map((s) => s.id), [id.soci[0]]);
	});

	test('15 per pagina, con il totale; l’archiviato non c’è', async () => {
		const prima = (await cerca(COGNOME_SCRITTO)).json();
		assert.equal(prima.totale, 17);
		assert.equal(prima.pagina, 1);
		assert.equal(prima.per_pagina, 15);
		assert.equal(prima.soci.length, 15);
		const seconda = (await cerca(COGNOME_SCRITTO, 2)).json();
		assert.equal(seconda.pagina, 2);
		assert.equal(seconda.soci.length, 2);
		const visti = [...prima.soci, ...seconda.soci].map((s) => s.id);
		assert.equal(new Set(visti).size, 17);
		assert.ok(!visti.includes(id.soci[17]), 'il socio archiviato non si prenota');
		// Una pagina oltre l'ultima dà l'ultima.
		assert.equal((await cerca(COGNOME_SCRITTO, 9)).json().pagina, 2);
		assert.equal((await cerca(`${COGNOME_SCRITTO} archiviato`)).json().totale, 0);
	});

	test('in ordine di cognome e nome', async () => {
		const { soci } = (await cerca(COGNOME_SCRITTO)).json();
		const attesi = ['Niccolò', ...Array.from({ length: 14 }, (_, i) => `Nome${String(i + 1).padStart(2, '0')}`)];
		assert.deepEqual(soci.map((s) => s.nome), attesi);
	});

	test('la chiede chi modifica il calendario: l’istruttore sì, il portale no', async () => {
		assert.equal((await cerca(COGNOME_SCRITTO)).statusCode, 200);
		assert.equal((await come('socio', `/api/soci/cerca?q=${COGNOME_SCRITTO}`)).statusCode, 403);
		// Il resto delle rotte dei soci resta della scheda: l'istruttore non la vede.
		assert.equal((await come('istruttore', `/api/soci/${id.soci[0]}/sospensioni`)).statusCode, 403);
	});
});

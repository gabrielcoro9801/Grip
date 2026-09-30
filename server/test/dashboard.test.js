// La dashboard contata dal server.
//
// La pagina scaricava sette tabelle intere e le incrociava nel browser. Ora chiede numeri e
// avvisi, e ogni parte arriva solo a chi può leggerla.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { memberDocuments, members, staffAccounts, subscriptions } from '../src/db/schema/index.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (giorni) => spostaGiorni(oggiIso(), giorni);
let app;
const token = {};
const idAccount = [];
const idSoci = [];

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const passwordHash = await bcrypt.hash('prova-dashboard-1234', 4);
	for (const ruolo of ['admin', 'istruttore']) {
		const email = `dash.${ruolo}.${suffisso}@test.local`;
		const [a] = await db.insert(staffAccounts).values({ nome: `Dash ${ruolo}`, email, passwordHash, ruolo }).returning();
		idAccount.push(a.id);
		token[ruolo] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'prova-dashboard-1234' } })).json().token;
	}
	const soci = await db.insert(members).values([
		{ nome: 'Rinnovo', cognome: 'Vicino', codiceSocio: `DA${lettere}` },
		{ nome: 'Rinnovato', cognome: 'Già', codiceSocio: `DB${lettere}` },
	]).returning();
	idSoci.push(...soci.map((s) => s.id));
	await db.insert(subscriptions).values([
		// In scadenza fra 5 giorni: è un avviso.
		{ memberId: soci[0].id, planName: 'Mensile', startDate: fra(-25), endDate: fra(5) },
		// Scaduto, ma già rinnovato: nessun avviso, e conta una volta sola fra gli attivi.
		{ memberId: soci[1].id, planName: 'Vecchio', startDate: fra(-60), endDate: fra(-31) },
		{ memberId: soci[1].id, planName: 'Nuovo', startDate: fra(-30), endDate: fra(60) },
	]);
	await db.insert(memberDocuments).values({ memberId: soci[0].id, documentType: 'certificato_medico', fileName: 'cert.pdf', expiryDate: fra(10) });
});

after(async () => {
	ripristinaMatricePredefinita();
	await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, idSoci));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, idSoci));
	await db.delete(members).where(inArray(members.id, idSoci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await app.close();
	await pool.end();
});

const leggi = (chi) => app.inject({ method: 'GET', url: '/api/dashboard', headers: { authorization: `Bearer ${token[chi]}` } });

describe('i numeri li conta il server', () => {
	test('gli avvisi di rinnovo: chi scade sì, chi ha già rinnovato no', async () => {
		const dati = (await leggi('admin')).json();
		const nomi = dati.rinnovi.map((r) => r.member_name);
		assert.ok(nomi.includes('Rinnovo Vicino'));
		assert.ok(!nomi.includes('Rinnovato Già'), 'chi ha già rinnovato non va richiamato');
		assert.equal(dati.rinnovi.find((r) => r.member_name === 'Rinnovo Vicino').giorni, 5);
	});

	test('il certificato in scadenza è un avviso', async () => {
		const dati = (await leggi('admin')).json();
		const suo = dati.certificati.find((c) => c.member_name === 'Rinnovo Vicino');
		assert.ok(suo);
		assert.equal(suo.giorni, 10);
		assert.equal(suo.scaduto, false);
	});

	test('i numeri ci sono tutti', async () => {
		const { kpi } = (await leggi('admin')).json();
		for (const campo of ['soci_attivi', 'soci_iscritti', 'certificati_in_scadenza', 'prossime_lezioni']) {
			assert.equal(typeof kpi[campo], 'number', campo);
		}
	});
});

describe('ogni parte a chi può leggerla', () => {
	test('un ruolo senza documenti non riceve gli avvisi sui certificati', async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_members: ['view'], calendar: ['view'] } }, capacita: {} });
		const dati = (await leggi('istruttore')).json();
		assert.equal(dati.certificati, null);
		assert.equal(dati.kpi.certificati_in_scadenza, null);
		assert.ok(Array.isArray(dati.rinnovi));
	});
});

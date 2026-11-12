// La dashboard contata dal server.
//
// La pagina scaricava sette tabelle intere e le incrociava nel browser. Ora chiede numeri e
// quanti avvisi aperti ci sono in ogni scheda di Da fare, e ogni parte arriva solo a chi può leggerla.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { avvisi, memberDocuments, members, staffAccounts, subscriptions } from '../src/db/schema/index.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (giorni) => spostaGiorni(oggiIso(), giorni);
let app;
const token = {};
const idAccount = [];
const idSoci = [];
const idPersone = [];

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
	idPersone.push(...soci.map((s) => s.personaId));
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
	await db.delete(avvisi).where(inArray(avvisi.personaId, idPersone));
	await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, idSoci));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, idSoci));
	await db.delete(members).where(inArray(members.id, idSoci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await app.close();
	await pool.end();
});

const leggi = (chi) => app.inject({ method: 'GET', url: '/api/dashboard', headers: { authorization: `Bearer ${token[chi]}` } });

describe('i numeri li conta il server', () => {
	test('gli avvisi di Da fare: cinque tessere, gli stessi numeri della barra', async () => {
		const dati = (await leggi('admin')).json();
		assert.deepEqual(Object.keys(dati.da_fare).sort(), ['compleanno', 'documento', 'frequenza', 'in_scadenza', 'scaduto']);
		// Gli altri file di test aggiungono soci mentre questo gira: i totali si confrontano solo nel tipo.
		assert.ok(Object.values(dati.da_fare).every((n) => Number.isInteger(n) && n >= 0));
		assert.ok(dati.da_fare.in_scadenza >= 1);
		// La dashboard allinea come Da fare: il nostro in scadenza ha il suo avviso; chi ha già rinnovato no.
		const aperti = (await app.inject({ method: 'GET', url: '/api/avvisi?tipo=in_scadenza', headers: { authorization: `Bearer ${token.admin}` } })).json().avvisi;
		const soci = aperti.map((a) => a.socio_id);
		assert.ok(soci.includes(idSoci[0]));
		assert.ok(!soci.includes(idSoci[1]), 'chi ha già rinnovato non va richiamato');
	});

	test('i numeri ci sono tutti', async () => {
		const { kpi, prossime } = (await leggi('admin')).json();
		for (const campo of ['soci_attivi', 'soci_iscritti', 'prossime_lezioni']) {
			assert.equal(typeof kpi[campo], 'number', campo);
		}
		// Una riga per lezione, con i posti: non una per prenotazione.
		assert.equal(kpi.prossime_lezioni, prossime.length);
		assert.equal(new Set(prossime.map((l) => l.id)).size, prossime.length);
		for (const l of prossime) assert.ok(Number.isInteger(l.confermati) && Number.isInteger(l.capacity), JSON.stringify(l));
	});
});

describe('ogni parte a chi può leggerla', () => {
	test('chi vede i soci riceve le cinque tessere; nessuna dei contatti', async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_members: ['view'], crm_leads: ['view'], calendar: ['view'] } }, capacita: {} });
		const dati = (await leggi('istruttore')).json();
		assert.equal(Object.keys(dati.da_fare).length, 5);
		assert.ok(!('contatti' in dati.da_fare));
	});

	test('chi segue solo i contatti non riceve Da fare: gli avvisi sono dei soci', async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_leads: ['view'], calendar: ['view'] } }, capacita: {} });
		assert.equal((await leggi('istruttore')).json().da_fare, null);
	});

	test('chi non segue né soci né contatti non riceve Da fare', async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { calendar: ['view'] } }, capacita: {} });
		assert.equal((await leggi('istruttore')).json().da_fare, null);
	});
});

// Da fare, oltre al motore: le impostazioni della palestra (segnali spenti e soglie, solo
// l'amministratore), l'archiviazione automatica di chi è senza abbonamento da troppo, e il diario
// delle cose da fare che il giro scrive — una riga quando compaiono, una quando non ci sono più.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, subscriptions, attivita, organizations, auditLogs, memberDocuments } from '../src/db/schema/index.js';
import { giro } from '../src/giro.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-da-fare-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (n) => spostaGiorni(oggiIso(), n);

let app;
const token = {};
const id = { soci: {}, persone: [], account: [] };
let impostazioniPrima;

const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const diarioDi = (chiave) => db.select().from(attivita).where(eq(attivita.personaId, id.persone[chiave]));
const statoDi = async (chiave) => (await db.select({ archiviatoIl: members.archiviatoIl }).from(members).where(eq(members.id, id.soci[chiave])))[0].archiviatoIl;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [p] = await db.select().from(organizations).limit(1);
	impostazioniPrima = p.impostazioni ?? {};

	const nomi = ['lontano', 'recente', 'scade'];
	const soci = await db.insert(members).values(nomi.map((n, i) => ({ nome: n, cognome: `DaFare${lettere}`, codiceSocio: `DF${'ABC'[i]}${lettere}` }))).returning();
	soci.forEach((s, i) => { id.soci[nomi[i]] = s.id; id.persone[nomi[i]] = s.personaId; });
	await db.insert(subscriptions).values([
		// Scaduto da 200 giorni: da archiviare. Scaduto da 10: ancora da recuperare.
		{ memberId: id.soci.lontano, planName: 'Vecchio', startDate: fra(-400), endDate: fra(-200) },
		{ memberId: id.soci.recente, planName: 'Mensile', startDate: fra(-40), endDate: fra(-10) },
		{ memberId: id.soci.scade, planName: 'Mensile', startDate: fra(-27), endDate: fra(3) },
	]);
	await db.insert(memberDocuments).values(soci.flatMap((s) => [
		{ memberId: s.id, documentType: 'certificato_medico', expiryDate: fra(300) },
		{ memberId: s.id, documentType: 'documento_identita', expiryDate: fra(3000) },
	]));

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Admin DaFare', email: `df.adm.${t}@test.local`, passwordHash, ruolo: 'admin' },
		{ nome: 'Reception DaFare', email: `df.rec.${t}@test.local`, passwordHash, ruolo: 'reception' },
	]).returning();
	id.account = account.map((a) => a.id);
	token.admin = await login(account[0].email);
	token.reception = await login(account[1].email);
});

after(async () => {
	// Le impostazioni di prima, solo per le chiavi toccate qui: altri test lavorano sulle comunicazioni.
	await db.transaction(async (tx) => {
		const [p] = await tx.select().from(organizations).limit(1).for('update');
		const imp = { ...(p.impostazioni ?? {}) };
		for (const k of ['soglie', 'segnali_spenti']) {
			if (k in impostazioniPrima) imp[k] = impostazioniPrima[k]; else delete imp[k];
		}
		await tx.update(organizations).set({ impostazioni: imp }).where(eq(organizations.id, p.id));
	});
	const tutti = Object.values(id.soci);
	await db.delete(attivita).where(inArray(attivita.personaId, Object.values(id.persone)));
	await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, tutti));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, tutti));
	await db.delete(auditLogs).where(eq(auditLogs.entitaTipo, 'impostazioni'));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, tutti));
	await app.close();
	await pool.end();
});

describe('le impostazioni di Da fare', () => {
	test('le legge chi segue i soci, le cambia solo l\'amministratore', async () => {
		const letta = await come('reception', 'GET', '/api/impostazioni/da-fare');
		assert.equal(letta.statusCode, 200, letta.body);
		assert.equal(typeof letta.json().soglie.segnali.assenzaGiorni, 'number');
		assert.ok(Array.isArray(letta.json().segnali_spenti));
		assert.equal((await come('reception', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: ['traguardo'] })).statusCode, 403);
	});

	test('si salvano solo soglie sensate e segnali che esistono; l\'archiviazione può essere "mai"', async () => {
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { assenzaGiorni: 0 } } })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { boh: 3 } })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: ['inventato'] })).statusCode, 400);
		const mai = await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { archiviazioneGiorni: 0 } } });
		assert.equal(mai.statusCode, 200, mai.body);
		assert.equal(mai.json().soglie.segnali.archiviazioneGiorni, 0);
	});

	test('un segnale spento sparisce dal motore, e il cambio finisce nel registro', async () => {
		await come('admin', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: [] });
		const res = await come('admin', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: ['traguardo'] });
		assert.equal(res.statusCode, 200, res.body);
		assert.deepEqual(res.json().segnali_spenti, ['traguardo']);
		const motore = (await come('reception', 'GET', `/api/segnali?persona=${id.persone.scade}`)).json();
		assert.deepEqual(motore.soglie.segnaliSpenti, ['traguardo']);
		const [voce] = await db.select().from(auditLogs).where(and(eq(auditLogs.entitaTipo, 'impostazioni'), eq(auditLogs.dettagli, 'Spenti: Traguardo')));
		assert.ok(voce, 'nel registro delle azioni');
		await come('admin', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: [] });
	});
});

describe('il giro', () => {
	test('con "mai" non archivia nessuno; con 180 giorni archivia chi è senza abbonamento da tanto, una volta sola', async () => {
		await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { archiviazioneGiorni: 0 } } });
		await giro();
		assert.equal(await statoDi('lontano'), null);

		await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { archiviazioneGiorni: 180 } } });
		await giro();
		await giro();
		assert.equal(await statoDi('lontano'), oggiIso());
		assert.equal(await statoDi('recente'), null, 'scaduto da 10 giorni: si recupera ancora');
		const righe = (await diarioDi('lontano')).filter((r) => r.tipo === 'archiviazione_automatica');
		assert.equal(righe.length, 1);
		assert.match(righe[0].nota, /180 giorni/);
	});

	test('scrive le cose da fare quando compaiono e quando non ci sono più, senza doppioni', async () => {
		await giro();
		await giro();
		// Solo il rinnovo: assenza e ambientamento dipendono dagli ingressi che gli altri test registrano.
		const aperti = (await diarioDi('scade')).filter((r) => r.tipo === 'segnale_aperto' && r.esito === 'in_scadenza');
		assert.equal(aperti.length, 1);
		assert.match(aperti[0].nota, /Abbonamento in scadenza — scade tra 3 giorni/);

		// Rinnova: il giro dopo chiude la cosa da fare.
		await db.insert(subscriptions).values({ memberId: id.soci.scade, planName: 'Mensile', startDate: fra(4), endDate: fra(34) });
		await giro();
		await giro();
		const chiusi = (await diarioDi('scade')).filter((r) => r.tipo === 'segnale_chiuso' && r.esito === 'in_scadenza');
		assert.equal(chiusi.length, 1);
		assert.ok((await diarioDi('scade')).every((r) => r.autoreNome === 'Sistema'));
	});
});

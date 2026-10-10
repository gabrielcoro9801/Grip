// Le comunicazioni: costruite, e spente. Ogni serratura si prova da sola; l'anteprima scrive solo
// "simulato"; il giro non raddoppia; il marketing chiede il consenso, il servizio no; le
// credenziali non tornano indietro; la sezione è solo dell'amministratore.
//
// Nessun messaggio vero: dove una serratura è aperta, a spedire è un adattatore finto del test.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, attivita, organizations, messaggi, notifiche, consensi, segretiCanali, modelliMessaggio,
} from '../src/db/schema/index.js';
import { config } from '../src/config.js';
import { giro } from '../src/giro.js';
import { giroInvii, contesto, spedisci } from '../src/lib/invii.js';
import { notifica } from '../src/lib/notifiche.js';
import { linkDisiscrizione } from '../src/lib/urlFirmati.js';
import { improntaCanale } from '../../shared/comunicazioni.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-comunicazioni-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (n) => spostaGiorni(oggiIso(), n);
// Le 11 di oggi, a Roma: fuori dalla fascia di silenzio.
const mattina = () => new Date(`${oggiIso()}T09:00:00Z`);

let app;
const tok = {};
const id = { soci: {}, persone: {}, account: [] };
let impostazioniPrima;
// L'adattatore "vero" del test: registra le chiamate, non spedisce niente.
const chiamate = [];
const spia = { invia: async (m) => { chiamate.push(m); return { idFornitore: `spia-${chiamate.length}`, costoCentesimi: 0 }; } };
const adattatori = { email: spia, sms: spia };

const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: chi ? { authorization: `Bearer ${tok[chi]}` } : {} });
const deiMiei = async () => db.select().from(messaggi).where(inArray(messaggi.personaId, Object.values(id.persone)));
// Solo la chiave delle comunicazioni, e in SQL: un altro file di test (le impostazioni di Da fare)
// scrive nella stessa riga nello stesso momento, e un "leggi, cambia, riscrivi" gli cancellerebbe le sue.
const impostaComunicazioni = async (com) => {
	await db.update(organizations).set({
		impostazioni: com === undefined
			? sql`coalesce(${organizations.impostazioni}, '{}'::jsonb) - 'comunicazioni'`
			: sql`coalesce(${organizations.impostazioni}, '{}'::jsonb) || jsonb_build_object('comunicazioni', ${JSON.stringify(com)}::jsonb)`,
	});
};

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	config.chiaveSegreti = 'chiave-dei-test-comunicazioni';
	config.publicBaseUrl ??= 'https://palestra.test';
	const [p] = await db.select().from(organizations).limit(1);
	impostazioniPrima = p.impostazioni ?? {};
	await impostaComunicazioni(undefined);

	const md = oggiIso().slice(5);
	const righe = await db.insert(members).values([
		// Scade tra 3 giorni, ha il portale: il rinnovo gli arriva lì.
		{ nome: 'Scadenza', cognome: `Com${lettere}`, codiceSocio: `CA${lettere}`, email: `scadenza.${t}@test.local`, phone: '+393330000001', dateOfBirth: '1990-01-15' },
		// Minorenne, scade tra 3 giorni, solo email: fuori dal portale non riceve.
		{ nome: 'Minore', cognome: `Com${lettere}`, codiceSocio: `CB${lettere}`, email: `minore.${t}@test.local`, dateOfBirth: `${Number(oggiIso().slice(0, 4)) - 12}-01-15` },
		// Compie gli anni oggi, senza consenso promozionale.
		{ nome: 'Senza', cognome: `Com${lettere}`, codiceSocio: `CC${lettere}`, email: `senza.${t}@test.local`, dateOfBirth: `1985-${md}` },
		// Compie gli anni oggi, con il consenso alle email promozionali.
		{ nome: 'Con', cognome: `Com${lettere}`, codiceSocio: `CD${lettere}`, email: `con.${t}@test.local`, dateOfBirth: `1986-${md}` },
	]).returning();
	['scadenza', 'minore', 'senza', 'con'].forEach((k, i) => { id.soci[k] = righe[i].id; id.persone[k] = righe[i].personaId; });
	await db.insert(subscriptions).values([
		{ memberId: id.soci.scadenza, planName: 'Trimestrale', startDate: fra(-87), endDate: fra(3) },
		{ memberId: id.soci.minore, planName: 'Trimestrale', startDate: fra(-87), endDate: fra(3) },
		{ memberId: id.soci.senza, planName: 'Annuale', startDate: fra(-100), endDate: fra(200) },
		{ memberId: id.soci.con, planName: 'Annuale', startDate: fra(-100), endDate: fra(200) },
	]);
	await db.insert(consensi).values({ personaId: id.persone.con, tipo: 'marketing_email', valore: true, fonte: 'portale', autoreNome: 'Test' });

	const hash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Admin Comunicazioni', email: `admin.com.${t}@test.local`, passwordHash: hash, ruolo: 'admin' },
		{ nome: 'Reception Comunicazioni', email: `reception.com.${t}@test.local`, passwordHash: hash, ruolo: 'reception' },
		{ nome: 'Socio Scadenza', email: `portale.com.${t}@test.local`, passwordHash: hash, ruolo: 'member', linkedMemberId: id.soci.scadenza },
	]).returning();
	id.account = account.map((a) => a.id);
	for (const [chi, a] of [['admin', account[0]], ['reception', account[1]]]) {
		tok[chi] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: PASSWORD } })).json().token;
	}
});

after(async () => {
	config.inviiReali = false;
	const persone = Object.values(id.persone);
	const soci = Object.values(id.soci);
	await db.delete(messaggi).where(inArray(messaggi.personaId, persone));
	await db.delete(notifiche).where(inArray(notifiche.memberId, soci));
	await db.delete(attivita).where(inArray(attivita.personaId, persone));
	await db.delete(consensi).where(inArray(consensi.personaId, persone));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, soci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, soci));
	const [p] = await db.select().from(organizations).limit(1);
	await db.delete(segretiCanali).where(eq(segretiCanali.organizationId, p.id));
	await db.delete(modelliMessaggio).where(eq(modelliMessaggio.organizationId, p.id));
	await impostaComunicazioni(impostazioniPrima.comunicazioni);
	await app.close();
	await pool.end();
});

describe('spento di default', () => {
	test('database appena migrato: il giro non scrive messaggi e non chiama nessuno', async () => {
		const esiti = await giro({ adesso: mattina(), adattatori });
		assert.ok(esiti.every((e) => e.invii.simulati === 0 && e.invii.accodati === 0 && e.invii.inviati === 0));
		assert.deepEqual(await deiMiei(), []);
		assert.equal(chiamate.length, 0);
		const v = (await come('admin', 'GET', '/api/comunicazioni')).json();
		assert.equal(v.attive, false);
		assert.equal(v.invii_reali, false);
		assert.ok(v.playbook.every((p) => p.stato === 'spento'));
		assert.ok(v.canali.every((c) => c.stato === 'non_configurato'));
	});
});

describe('chi può', () => {
	test('solo l\'amministratore: la reception riceve 403, senza accesso 401', async () => {
		assert.equal((await come(null, 'GET', '/api/comunicazioni')).statusCode, 401);
		assert.equal((await come('reception', 'GET', '/api/comunicazioni')).statusCode, 403);
		assert.equal((await come('reception', 'PUT', '/api/comunicazioni/interruttore', { attive: false })).statusCode, 403);
		assert.equal((await come('admin', 'GET', '/api/comunicazioni')).statusCode, 200);
	});

	test('le credenziali entrano e non escono: cifrate nel database, mai in una GET', async () => {
		const res = await come('admin', 'PUT', '/api/comunicazioni/canali/email', {
			fornitore: 'brevo', mittente: 'info@palestra.test', nome_mittente: 'Palestra', segreto: 'CHIAVE-SEGRETISSIMA-123',
		});
		assert.equal(res.statusCode, 200, res.body);
		assert.ok(!res.body.includes('CHIAVE-SEGRETISSIMA-123'));
		const v = (await come('admin', 'GET', '/api/comunicazioni')).body;
		assert.ok(!v.includes('CHIAVE-SEGRETISSIMA-123'));
		const email = JSON.parse(v).canali.find((c) => c.canale === 'email');
		assert.equal(email.segreto.impostato, true);
		assert.equal(email.stato, 'da_verificare');
		const [riga] = await db.select().from(segretiCanali);
		assert.ok(!riga.cifrato.includes('CHIAVE-SEGRETISSIMA'));
	});

	test('l\'invio di prova, simulato senza INVII_REALI, rende il canale pronto', async () => {
		const prova = await come('admin', 'POST', '/api/comunicazioni/canali/email/prova', {});
		assert.equal(prova.statusCode, 200, prova.body);
		const { simulato, testo } = prova.json();
		assert.equal(simulato, true);
		assert.equal((await come('admin', 'POST', '/api/comunicazioni/canali/email/verifica', { codice: '000000x' })).statusCode, 400);
		const codice = testo.match(/\d{6}/)[0];
		const v = (await come('admin', 'POST', '/api/comunicazioni/canali/email/verifica', { codice })).json();
		assert.equal(v.canali.find((c) => c.canale === 'email').stato, 'pronto');
		assert.equal(chiamate.length, 0);
	});
});

describe('l\'interruttore generale', () => {
	test('resta chiuso finché la lista di controllo non è completa', async () => {
		const no = await come('admin', 'PUT', '/api/comunicazioni/interruttore', { attive: true });
		assert.equal(no.statusCode, 409);
		assert.match(no.json().error, /informativa/);
		await come('admin', 'PUT', '/api/comunicazioni/conferme', { voce: 'informativa', fatta: true });
		assert.equal((await come('admin', 'PUT', '/api/comunicazioni/interruttore', { attive: true })).statusCode, 409);
		await come('admin', 'PUT', '/api/comunicazioni/conferme', { voce: 'testi', fatta: true });
		const si = await come('admin', 'PUT', '/api/comunicazioni/interruttore', { attive: true });
		assert.equal(si.statusCode, 200, si.body);
		assert.equal(si.json().attive, true);
		// Ri-spento per i test che seguono, che aprono le serrature una alla volta.
		await come('admin', 'PUT', '/api/comunicazioni/interruttore', { attive: false });
	});
});

describe('anteprima e serrature', () => {
	test('anteprima: "domani sarebbero partiti", e il giro scrive solo simulato', async () => {
		await come('admin', 'PUT', '/api/comunicazioni/canali/app', { attivo: true });
		await come('admin', 'PUT', '/api/comunicazioni/playbook/rinnovo', { stato: 'anteprima' });
		const a = (await come('admin', 'GET', '/api/comunicazioni/anteprima/rinnovo')).json();
		const mio = a.esempi.find((e) => e.persona_id === id.persone.scadenza);
		assert.ok(mio, 'chi scade compare nell\'anteprima');
		assert.equal(mio.canale, 'app');
		assert.match(mio.testo, /Ciao Scadenza/);
		assert.match(mio.oggetto, /scade tra 2 giorni/);

		const e1 = await giroInvii(db, { adesso: mattina(), adattatori });
		const e2 = await giroInvii(db, { adesso: mattina(), adattatori });
		assert.equal(e2.simulati, 0, 'il secondo giro non raddoppia');
		assert.ok(e1.simulati >= 1);
		const righe = await deiMiei();
		const scadenza = righe.filter((m) => m.personaId === id.persone.scadenza);
		assert.equal(scadenza.length, 1);
		assert.equal(scadenza[0].stato, 'simulato');
		assert.equal(scadenza[0].canale, 'app');
		// Il minore: sarebbe stato bloccato (solo email, fuori dal portale).
		const minore = righe.find((m) => m.personaId === id.persone.minore);
		assert.equal(minore.stato, 'simulato');
		assert.match(minore.motivo, /minorenne/);
		assert.equal(chiamate.length, 0);
		assert.equal((await db.select().from(notifiche).where(eq(notifiche.memberId, id.soci.scadenza))).length, 0);
	});

	test('playbook attivo ma interruttore spento: ancora simulato', async () => {
		await come('admin', 'PUT', '/api/comunicazioni/playbook/rinnovo', { stato: 'attivo' });
		config.inviiReali = true;
		try {
			await giroInvii(db, { adesso: mattina(), adattatori });
			const reali = (await deiMiei()).filter((m) => m.stato !== 'simulato');
			assert.deepEqual(reali, []);
		} finally { config.inviiReali = false; }
	});

	test('interruttore acceso ma senza INVII_REALI: ancora simulato', async () => {
		await come('admin', 'PUT', '/api/comunicazioni/interruttore', { attive: true });
		await giroInvii(db, { adesso: mattina(), adattatori });
		assert.deepEqual((await deiMiei()).filter((m) => m.stato !== 'simulato'), []);
		assert.equal(chiamate.length, 0);
	});

	test('canale non pronto: con le serrature aperte non parte niente su quel canale', async () => {
		config.inviiReali = true;
		try {
			// Con gli invii veri accesi l'email verificata in simulazione torna da verificare.
			const ctx = await contesto(db);
			assert.equal(ctx.statiCanali.email, 'da_verificare');
			await come('admin', 'PUT', '/api/comunicazioni/canali/app', { attivo: false });
			await giroInvii(db, { adesso: mattina(), adattatori });
			assert.deepEqual((await deiMiei()).filter((m) => m.stato !== 'simulato'), []);
			assert.equal(chiamate.length, 0);
		} finally {
			config.inviiReali = false;
			await come('admin', 'PUT', '/api/comunicazioni/canali/app', { attivo: true });
		}
	});

	test('tutte aperte: parte una volta sola, nel portale, e finisce nel diario; il minore no', async () => {
		config.inviiReali = true;
		try {
			const silenzio = await giroInvii(db, { adesso: new Date(`${oggiIso()}T20:30:00Z`), adattatori });
			assert.equal(silenzio.silenzio, true);
			await giroInvii(db, { adesso: mattina(), adattatori });
			await giroInvii(db, { adesso: mattina(), adattatori });
			const veri = (await deiMiei()).filter((m) => m.stato !== 'simulato');
			const scadenza = veri.filter((m) => m.personaId === id.persone.scadenza);
			assert.equal(scadenza.length, 1);
			assert.equal(scadenza[0].stato, 'inviato');
			assert.equal(scadenza[0].canale, 'app');
			const [avviso] = await db.select().from(notifiche).where(eq(notifiche.memberId, id.soci.scadenza));
			assert.match(avviso.titolo, /scade/);
			const [diario] = await db.select().from(attivita).where(and(eq(attivita.personaId, id.persone.scadenza), eq(attivita.tipo, 'messaggio')));
			assert.equal(diario.esito, 'rinnovo');
			// Il minore non ha il portale, e l'email (verificata solo in simulazione) qui non è pronta:
			// nessun canale possibile, nessun messaggio. Il blocco per età l'ha già mostrato l'anteprima.
			assert.equal(veri.find((m) => m.personaId === id.persone.minore), undefined);
			assert.equal(chiamate.length, 0, 'il portale non passa da un fornitore');
		} finally { config.inviiReali = false; }
	});
});

describe('consensi', () => {
	test('il marketing parte solo a chi ha il consenso; con il link di disiscrizione', async () => {
		// L'email verificata "davvero": in un test non si può, si scrive la verifica a mano.
		const [p] = await db.select().from(organizations).limit(1);
		const com = structuredClone(p.impostazioni.comunicazioni);
		const [segreto] = await db.select().from(segretiCanali).where(eq(segretiCanali.canale, 'email'));
		com.canali.email.verificato = { ...com.canali.email.verificato, reale: true, impronta: improntaCanale(com.canali.email, new Date(segreto.updatedDate).toISOString()) };
		com.canali.app = { attivo: false };
		com.playbook = { ...com.playbook, rinnovo: 'spento', compleanno: 'attivo' };
		await impostaComunicazioni(com);
		config.inviiReali = true;
		try {
			await giroInvii(db, { adesso: mattina(), adattatori });
			const righe = (await deiMiei()).filter((m) => m.playbook === 'compleanno' && m.stato !== 'simulato');
			const senza = righe.find((m) => m.personaId === id.persone.senza);
			const con = righe.find((m) => m.personaId === id.persone.con);
			assert.equal(senza.stato, 'bloccato_consenso');
			assert.equal(con.stato, 'inviato');
			const mia = chiamate.find((c) => c.a === `con.${t}@test.local`);
			assert.ok(mia, 'l\'adattatore email è stato chiamato per chi ha il consenso');
			assert.match(mia.testo, /disiscrizione\?p=/);
			assert.match(mia.intestazioni['List-Unsubscribe'], /disiscrizione/);
			assert.ok(!chiamate.some((c) => c.a === `senza.${t}@test.local`));
		} finally { config.inviiReali = false; }
	});

	test('la disiscrizione: si conferma con un pulsante e finisce nel registro dei consensi', async () => {
		const link = linkDisiscrizione(id.persone.con, 'marketing_email', 'http://x/disiscrizione');
		const percorso = link.slice('http://x'.length);
		const pagina = await app.inject({ method: 'GET', url: percorso });
		assert.equal(pagina.statusCode, 200);
		assert.match(pagina.body, /<form method="post"/);
		const prima = await db.select().from(consensi).where(eq(consensi.personaId, id.persone.con));
		assert.equal(prima.length, 1, 'aprire il link non toglie niente');
		const fatto = await app.inject({ method: 'POST', url: percorso, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
		assert.equal(fatto.statusCode, 200);
		const dopo = await db.select().from(consensi).where(eq(consensi.personaId, id.persone.con));
		const ultima = dopo.find((c) => c.fonte === 'disiscrizione');
		assert.equal(ultima.valore, false);
		const falso = percorso.replace(/f=[0-9a-f]+/, 'f=0000');
		assert.equal((await app.inject({ method: 'POST', url: falso })).statusCode, 404);
	});
});

describe('gli avvisi immediati', () => {
	test('la notifica nel portale c\'è sempre; email e SMS solo se il playbook è acceso', async () => {
		const avviso = { tipo: 'lezione_annullata', titolo: 'Lezione annullata: Prova', testo: 'La lezione di Prova è stata annullata.' };
		await db.transaction((tx) => notifica(tx, [id.soci.minore], avviso, { evento: 'lezione_annullata', riferimento: `lezione:${t}` }));
		assert.equal((await db.select().from(notifiche).where(eq(notifiche.memberId, id.soci.minore))).length, 1);
		assert.deepEqual((await deiMiei()).filter((m) => m.playbook === 'lezione_annullata'), []);

		await come('admin', 'PUT', '/api/comunicazioni/playbook/lezione_annullata', { stato: 'anteprima' });
		await db.transaction((tx) => notifica(tx, [id.soci.scadenza], avviso, { evento: 'lezione_annullata', riferimento: `lezione:${t}` }));
		const [m] = (await deiMiei()).filter((x) => x.playbook === 'lezione_annullata');
		assert.equal(m.stato, 'simulato');
		assert.equal(m.canale, 'email');
		assert.match(m.testo, /la lezione di Prova è stata annullata/);
	});
});

describe('testi', () => {
	test('un testo con un segnaposto sbagliato non si salva', async () => {
		const no = await come('admin', 'PUT', '/api/comunicazioni/modelli/rinnovo/email', { oggetto: 'Ciao', testo: 'Ciao {nomee}' });
		assert.equal(no.statusCode, 400);
		const si = await come('admin', 'PUT', '/api/comunicazioni/modelli/rinnovo/email', { oggetto: 'Rinnova, {nome}', testo: 'Ciao {nome}, {quando}.' });
		assert.equal(si.statusCode, 200, si.body);
		assert.equal(si.json().playbook.find((p) => p.codice === 'rinnovo').testi.email.personalizzato, true);
		const prova = (await come('admin', 'POST', '/api/comunicazioni/anteprima-testo', { playbook: 'rinnovo', canale: 'email', persona_id: id.persone.scadenza, oggetto: 'Rinnova, {nome}', testo: 'Ciao {nome}, {quando}.' })).json();
		assert.equal(prova.oggetto, 'Rinnova, Scadenza');
		assert.equal(prova.testo, 'Ciao Scadenza, scade tra 3 giorni.');
	});
});

describe('dopo la revisione', () => {
	test('spento l\'interruttore, quello che era in coda non parte più', async () => {
		const [p] = await db.select().from(organizations).limit(1);
		const [m] = await db.insert(messaggi).values({
			organizationId: p.id, personaId: id.persone.scadenza, playbook: 'rinnovo', canale: 'app', destinatario: id.soci.scadenza,
			oggetto: 'In coda', testo: 'Rimasto in coda', chiave: `prova-coda-${t}`, stato: 'in_coda',
		}).returning();
		config.inviiReali = true;
		try {
			await impostaComunicazioni({ ...p.impostazioni.comunicazioni, attive: false });
			await spedisci(db, { adattatori, adesso: mattina() });
		} finally { config.inviiReali = false; }
		const [dopo] = await db.select().from(messaggi).where(eq(messaggi.id, m.id));
		assert.equal(dopo.stato, 'fallito');
		assert.match(dopo.motivo, /Fermato: comunicazioni spente/);
		assert.ok(!(await db.select().from(notifiche).where(eq(notifiche.memberId, id.soci.scadenza))).some((n) => n.titolo === 'In coda'));
		await impostaComunicazioni(p.impostazioni.comunicazioni);
	});

	test('le impostazioni non escono e non entrano dall\'endpoint generico', async () => {
		const [p] = await db.select().from(organizations).limit(1);
		const letta = (await come('admin', 'GET', `/api/entities/Organization/${p.id}`)).json();
		assert.equal(letta.impostazioni, undefined);
		const prima = p.impostazioni;
		const res = await come('admin', 'PUT', `/api/entities/Organization/${p.id}`, { impostazioni: { comunicazioni: { attive: true } } });
		assert.ok(res.statusCode < 500, res.body);
		const [dopo] = await db.select().from(organizations).limit(1);
		// La chiave che ha provato a scrivere: le altre le cambia, intanto, il test di Da fare.
		assert.deepEqual(dopo.impostazioni.comunicazioni, prima.comunicazioni);
	});

	test('un\'email immediata parte anche in fascia di silenzio; il giro no', async () => {
		const [p] = await db.select().from(organizations).limit(1);
		const com = structuredClone(p.impostazioni.comunicazioni);
		const [segreto] = await db.select().from(segretiCanali).where(eq(segretiCanali.canale, 'email'));
		com.canali.email.verificato = { ...com.canali.email.verificato, reale: true, impronta: improntaCanale(com.canali.email, new Date(segreto.updatedDate).toISOString()) };
		await impostaComunicazioni({ ...com, attive: true, playbook: { ...com.playbook, lezione_annullata: 'attivo' } });
		const sera = new Date(`${oggiIso()}T20:30:00Z`);
		config.inviiReali = true;
		try {
			const { accodaAvviso } = await import('../src/lib/invii.js');
			await db.transaction((tx) => accodaAvviso(tx, 'lezione_annullata', [id.soci.con], { titolo: 'Lezione annullata: Sera', testo: 'La lezione di stasera è annullata.' }, `sera:${t}`, sera));
		} finally { config.inviiReali = false; }
		const [m] = (await deiMiei()).filter((x) => x.chiave.includes(`sera:${t}`));
		assert.equal(m.stato, 'in_coda');
		assert.equal(m.canale, 'email');
		await db.update(messaggi).set({ stato: 'fallito', motivo: 'chiuso dal test' }).where(eq(messaggi.id, m.id));
		await impostaComunicazioni(p.impostazioni.comunicazioni);
	});
});

describe('il budget SMS', () => {
	test('un tetto rigido: a budget zero bloccato, poi uno solo per quanto basta', async () => {
		// Due soci scaduti da 3 giorni, raggiungibili solo con un SMS.
		const due = await db.insert(members).values([1, 2].map((n) => ({
			nome: `Sms${n}`, cognome: `Com${lettere}`, codiceSocio: `CS${n}${lettere}`, phone: `+39333000010${n}`, dateOfBirth: '1980-03-03',
		}))).returning();
		due.forEach((s, i) => { id.soci[`sms${i}`] = s.id; id.persone[`sms${i}`] = s.personaId; });
		await db.insert(subscriptions).values(due.map((s) => ({ memberId: s.id, planName: 'Mensile', startDate: fra(-33), endDate: fra(-3) })));
		const [p] = await db.select().from(organizations).limit(1);
		const com = structuredClone(p.impostazioni.comunicazioni);
		com.canali.sms = { fornitore: 'finto', mittente: 'Palestra' };
		com.canali.sms.verificato = { reale: true, impronta: improntaCanale(com.canali.sms, null) };
		com.canali.email = {};
		com.canali.app = { attivo: false };
		com.playbook = { ...com.playbook, compleanno: 'spento', rinnovo: 'attivo' };
		com.budget_sms_centesimi = 0;
		com.costo_sms_centesimi = 6;
		await impostaComunicazioni(com);
		config.inviiReali = true;
		try {
			await giroInvii(db, { adesso: mattina(), adattatori });
			let miei = (await deiMiei()).filter((m) => due.some((s) => s.personaId === m.personaId));
			assert.deepEqual(miei.map((m) => m.stato), ['bloccato_budget', 'bloccato_budget']);

			// Nuove occasioni (altre iscrizioni scadute), budget per un SMS solo.
			await db.delete(messaggi).where(inArray(messaggi.personaId, due.map((s) => s.personaId)));
			await impostaComunicazioni({ ...com, budget_sms_centesimi: 6 });
			await giroInvii(db, { adesso: mattina(), adattatori });
			miei = (await deiMiei()).filter((m) => due.some((s) => s.personaId === m.personaId));
			assert.deepEqual(miei.map((m) => m.stato).sort(), ['bloccato_budget', 'inviato']);
			assert.equal(chiamate.filter((c) => c.canale === 'sms').length, 1);
		} finally { config.inviiReali = false; }
		await db.delete(subscriptions).where(inArray(subscriptions.memberId, due.map((s) => s.id)));
	});
});

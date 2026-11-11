// Da fare contro le rotte vere: gli avvisi salvati (GET /api/avvisi, chiudi, ripristina), come si
// chiudono da soli (rinnovo, archiviazione, scadenza, ritorno in palestra), le Regole della palestra
// (soglie e segnali spenti, solo l'amministratore), e il giro: l'archiviazione automatica, il diario
// delle cose da fare e l'allineamento degli avvisi anche se nessuno apre Da fare.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, persone, staffAccounts, subscriptions, attivita, organizations, auditLogs, memberDocuments, ingressi, avvisi,
} from '../src/db/schema/index.js';
import { giro } from '../src/giro.js';
import { situazioni } from '../src/lib/segnali.js';
import { allinea } from '../src/lib/avvisi.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-da-fare-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const fra = (n) => spostaGiorni(oggiIso(), n);
const giorniFa = (n) => new Date(Date.now() - n * 86_400_000);

let app;
const token = {};
const id = { soci: {}, persone: {}, abbonamenti: {}, account: [] };
let impostazioniPrima;

const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const diarioDi = (chiave) => db.select().from(attivita).where(eq(attivita.personaId, id.persone[chiave]));
const statoDi = async (chiave) => (await db.select({ archiviatoIl: members.archiviatoIl }).from(members).where(eq(members.id, id.soci[chiave])))[0].archiviatoIl;
/** Gli avvisi di un socio come li manda Da fare (allineati prima di leggere). */
const avvisiDi = async (chiave, vista = 'aperti') => {
	const res = await come('reception', 'GET', `/api/avvisi?vista=${vista}`);
	assert.equal(res.statusCode, 200, res.body);
	return res.json().avvisi.filter((a) => a.persona_id === id.persone[chiave]);
};
/** Le righe di un socio nella tabella, senza allineare. */
const righeDi = (chiave, tipo) => db.select().from(avvisi)
	.where(and(eq(avvisi.personaId, id.persone[chiave]), tipo ? eq(avvisi.tipo, tipo) : undefined));
const ingresso = (socio, alle) => ({ memberId: socio, entratoAlle: alle, esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test' });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [p] = await db.select().from(organizations).limit(1);
	impostazioniPrima = p.impostazioni ?? {};

	// "lontano" (scaduto da 200 giorni) nasce dentro il test del giro, dopo aver spento
	// l'archiviazione: gli altri file lanciano il giro in parallelo con le soglie predefinite, e un
	// socio da archiviare creato qui lo avrebbero archiviato loro prima del controllo.
	const nomi = ['recente', 'scade', 'rinnova', 'passa', 'lascia', 'calo', 'tornato'];
	const domani = fra(1).slice(5);
	const soci = await db.insert(members).values(nomi.map((n, i) => ({
		nome: n, cognome: `DaFare${lettere}`, codiceSocio: `DF${'BCDEFGH'[i]}${lettere}`,
		// Il compleanno domani, da un anno bisestile: il 29 febbraio esiste.
		dateOfBirth: n === 'lascia' ? `2000-${domani}` : null,
	}))).returning();
	soci.forEach((s, i) => { id.soci[nomi[i]] = s.id; id.persone[nomi[i]] = s.personaId; });
	const abbonamenti = await db.insert(subscriptions).values([
		// Scaduto da 10 giorni: ancora da recuperare.
		{ memberId: id.soci.recente, planName: 'Mensile', startDate: fra(-40), endDate: fra(-10) },
		{ memberId: id.soci.scade, planName: 'Mensile', startDate: fra(-27), endDate: fra(3) },
		{ memberId: id.soci.rinnova, planName: 'Mensile', startDate: fra(-25), endDate: fra(5) },
		{ memberId: id.soci.passa, planName: 'Mensile', startDate: fra(-28), endDate: fra(2) },
		{ memberId: id.soci.lascia, planName: 'Mensile', startDate: fra(-24), endDate: fra(6) },
		// Annuali e lontani dalla scadenza: per loro conta solo quanto vengono.
		{ memberId: id.soci.calo, planName: 'Annuale', startDate: '2025-01-01', endDate: fra(200) },
		{ memberId: id.soci.tornato, planName: 'Annuale', startDate: '2025-01-01', endDate: fra(200) },
	]).returning();
	abbonamenti.forEach((a, i) => { id.abbonamenti[nomi[i]] = a.id; });
	await db.insert(memberDocuments).values(soci.flatMap((s) => [
		// Il certificato di chi lascia scade fra 10 giorni: un avviso dei documenti.
		{ memberId: s.id, documentType: 'certificato_medico', expiryDate: s.id === id.soci.lascia ? fra(10) : fra(300) },
		{ memberId: s.id, documentType: 'documento_identita', expiryDate: fra(3000) },
	]));
	// Non entrano da 20 giorni: assenti, con l'avviso della frequenza.
	await db.insert(ingressi).values([ingresso(id.soci.calo, giorniFa(20)), ingresso(id.soci.tornato, giorniFa(20))]);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Admin DaFare', email: `df.adm.${t}@test.local`, passwordHash, ruolo: 'admin' },
		{ nome: 'Reception DaFare', email: `df.rec.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Istruttore DaFare', email: `df.ist.${t}@test.local`, passwordHash, ruolo: 'istruttore' },
		{ nome: 'Socio DaFare', email: `df.soc.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: soci[1].id },
	]).returning();
	id.account = account.map((a) => a.id);
	[token.admin, token.reception, token.istruttore, token.socio] = await Promise.all(account.map((a) => login(a.email)));
});

after(async () => {
	ripristinaMatricePredefinita();
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
	const personeTutte = Object.values(id.persone);
	await db.delete(avvisi).where(inArray(avvisi.personaId, personeTutte));
	await db.delete(attivita).where(inArray(attivita.personaId, personeTutte));
	await db.delete(ingressi).where(inArray(ingressi.memberId, tutti));
	await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, tutti));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, tutti));
	await db.delete(auditLogs).where(eq(auditLogs.entitaTipo, 'impostazioni'));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, tutti));
	await db.delete(persone).where(inArray(persone.id, personeTutte));
	await app.close();
	await pool.end();
});

describe('gli avvisi', () => {
	test('li legge chi vede i soci, ognuno con la sua chiave e la sua frase; l\'istruttore e il socio no', async () => {
		const res = await come('reception', 'GET', '/api/avvisi');
		assert.equal(res.statusCode, 200, res.body);
		const dati = res.json();
		assert.deepEqual(Object.keys(dati.conteggi).sort(), ['compleanno', 'documento', 'frequenza', 'in_scadenza', 'scaduto']);
		assert.equal(dati.oggi, oggiIso());

		const [scade] = dati.avvisi.filter((a) => a.persona_id === id.persone.scade && a.tipo === 'in_scadenza');
		assert.equal(scade.chiave, id.abbonamenti.scade, 'la chiave è l\'abbonamento');
		assert.equal(scade.socio_id, id.soci.scade);
		assert.equal(scade.codice_socio, `DFC${lettere}`);
		assert.equal(scade.dati.data, fra(3));
		assert.match(scade.dati.frase, /^Abbonamento in scadenza il \d\d\/\d\d\/\d{4}$/);
		assert.equal(scade.chiuso_il, null);
		const [recente] = dati.avvisi.filter((a) => a.persona_id === id.persone.recente);
		assert.equal(recente.tipo, 'scaduto');

		// Nell'ordine dell'urgenza: In scadenza dalla fine più vicina.
		const inScadenza = dati.avvisi.filter((a) => a.tipo === 'in_scadenza').map((a) => a.dati.data);
		assert.deepEqual(inScadenza, [...inScadenza].sort());
		// Un avviso per documento, il certificato di chi lascia; il compleanno di domani.
		const lascia = await avvisiDi('lascia');
		assert.deepEqual(lascia.map((a) => a.tipo).filter((x) => x !== 'frequenza').sort(), ['compleanno', 'documento', 'in_scadenza']);
		assert.equal(lascia.find((a) => a.tipo === 'documento').dati.tipo_documento, 'certificato_medico');

		assert.equal((await come('istruttore', 'GET', '/api/avvisi')).statusCode, 403);
		assert.equal((await come('socio', 'GET', '/api/avvisi')).statusCode, 403);
		assert.equal((await come('reception', 'GET', '/api/avvisi?vista=boh')).statusCode, 400);
		assert.equal((await come('reception', 'GET', '/api/avvisi?tipo=contatti')).statusCode, 400);
	});

	test('chi vede e basta legge, ma non chiude; chi segue solo i contatti non li legge', async () => {
		try {
			impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_members: ['view'] } }, capacita: {} });
			assert.equal((await come('istruttore', 'GET', '/api/avvisi')).statusCode, 200);
			const [avviso] = await avvisiDi('recente');
			assert.equal((await come('istruttore', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'nascosto' })).statusCode, 403);
			impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_leads: ['view', 'edit'] } }, capacita: {} });
			assert.equal((await come('istruttore', 'GET', '/api/avvisi')).statusCode, 403);
		} finally {
			ripristinaMatricePredefinita();
		}
	});

	test('Nascondi lo porta in Archivio con chi e quando; Ripristina lo rimette nella sua scheda', async () => {
		const [avviso] = await avvisiDi('recente');
		assert.equal((await come('reception', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'contattato' })).statusCode, 400, 'Contattato vale solo per la frequenza');
		assert.equal((await come('reception', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'boh' })).statusCode, 400);
		assert.equal((await come('reception', 'POST', '/api/avvisi/non-un-id/chiudi', { esito: 'nascosto' })).statusCode, 400);
		assert.equal((await come('reception', 'POST', '/api/avvisi/00000000-0000-0000-0000-000000000000/chiudi', { esito: 'nascosto' })).statusCode, 404);

		const res = await come('reception', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'nascosto' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().avviso.esito, 'nascosto');
		assert.equal(res.json().avviso.autore_nome, 'Reception DaFare');
		assert.ok(res.json().avviso.chiuso_il);
		assert.equal((await come('reception', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'nascosto' })).statusCode, 400, 'già chiuso');

		// L'allineamento non lo riapre: una chiusura a mano resta.
		assert.deepEqual(await avvisiDi('recente'), []);
		const [archiviato] = await avvisiDi('recente', 'archivio');
		assert.equal(archiviato.id, avviso.id);
		assert.equal(archiviato.esito, 'nascosto');
		const archivio = (await come('reception', 'GET', '/api/avvisi?vista=archivio&tipo=scaduto')).json();
		assert.ok(archivio.archiviati.scaduto >= 1);
		assert.ok(archivio.avvisi.every((a) => a.tipo === 'scaduto' && a.chiuso_il));

		const rimesso = await come('reception', 'POST', `/api/avvisi/${avviso.id}/ripristina`);
		assert.equal(rimesso.statusCode, 200, rimesso.body);
		assert.equal(rimesso.json().avviso.chiuso_il, null);
		assert.equal(rimesso.json().avviso.autore_nome, null);
		assert.deepEqual((await avvisiDi('recente')).map((a) => a.id), [avviso.id]);
		assert.equal((await come('reception', 'POST', `/api/avvisi/${avviso.id}/ripristina`)).statusCode, 400, 'si ripristina solo un nascosto');
	});

	test('Rinnova: l\'allineamento dopo la vendita lo chiude con «Rinnovato», in automatico', async () => {
		const [prima] = (await avvisiDi('rinnova')).filter((a) => a.tipo === 'in_scadenza');
		assert.ok(prima);
		await db.insert(subscriptions).values({ memberId: id.soci.rinnova, planName: 'Mensile', startDate: fra(6), endDate: fra(36) });
		assert.deepEqual((await avvisiDi('rinnova')).filter((a) => a.tipo === 'in_scadenza'), []);
		const [chiuso] = await righeDi('rinnova', 'in_scadenza');
		assert.equal(chiuso.id, prima.id);
		assert.equal(chiuso.esito, 'rinnovato');
		assert.equal(chiuso.autoreNome, null, 'in automatico');
	});

	test('Non rinnova: archiviare il socio chiude tutti i suoi avvisi', async () => {
		assert.ok((await avvisiDi('lascia')).length >= 3);
		const res = await come('reception', 'POST', `/api/soci/${id.soci.lascia}/archivia`, { motivo: 'prezzo' });
		assert.equal(res.statusCode, 200, res.body);
		assert.deepEqual(await avvisiDi('lascia'), []);
		const righe = await righeDi('lascia');
		assert.ok(righe.length >= 3);
		assert.ok(righe.every((r) => r.chiusoIl && r.esito === 'socio_archiviato'), JSON.stringify(righe.map((r) => [r.tipo, r.esito])));
	});

	test('l\'abbonamento che scade: In scadenza si chiude con «Passato in Scaduti» e si apre lo Scaduto, con la stessa chiave', async () => {
		const [prima] = (await avvisiDi('passa')).filter((a) => a.tipo === 'in_scadenza');
		assert.equal(prima.chiave, id.abbonamenti.passa);
		// Come se fossero passati 3 giorni: l'abbonamento è finito ieri.
		await db.update(subscriptions).set({ startDate: fra(-31), endDate: fra(-1) }).where(eq(subscriptions.id, id.abbonamenti.passa));
		await db.update(avvisi).set({ dati: sql`jsonb_set(${avvisi.dati}, '{data}', to_jsonb(${fra(-1)}::text))` }).where(eq(avvisi.id, prima.id));
		const dopo = await avvisiDi('passa');
		const scaduto = dopo.find((a) => a.tipo === 'scaduto');
		assert.equal(scaduto.chiave, id.abbonamenti.passa);
		assert.ok(!dopo.some((a) => a.tipo === 'in_scadenza'));
		const [chiuso] = await righeDi('passa', 'in_scadenza');
		assert.equal(chiuso.esito, 'passato_in_scaduti');
	});

	test('Contattato: la frequenza ricompare dopo frequenzaRiapriGiorni, solo se è ancora in calo', async () => {
		const frequenza = async (chiave) => (await avvisiDi(chiave)).filter((a) => a.tipo === 'frequenza');
		for (const chiave of ['calo', 'tornato']) {
			const [avviso] = await frequenza(chiave);
			assert.ok(avviso, `${chiave}: non entra da 20 giorni`);
			assert.equal(avviso.chiave, oggiIso(), 'la chiave è il giorno in cui è comparso');
			assert.equal(avviso.dati.segnale, 'assente');
			assert.equal((await come('reception', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'auguri_fatti' })).statusCode, 400);
			const res = await come('reception', 'POST', `/api/avvisi/${avviso.id}/chiudi`, { esito: 'contattato' });
			assert.equal(res.statusCode, 200, res.body);
		}
		// Contattato scrive un contatto nel diario, con il segnale e l'avviso: i rientri lo contano (giro.js).
		const [contatto] = (await diarioDi('calo')).filter((r) => r.tipo === 'contatto');
		assert.equal(contatto.esito, 'fatto');
		assert.equal(contatto.riferimento.segnali[0], 'assente');
		assert.ok(contatto.riferimento.avviso);
		// Ancora in calo, ma contattato oggi: non ricompare.
		assert.deepEqual(await frequenza('calo'), []);

		// Come se fossero passati 31 giorni dal contatto; intanto "tornato" è tornato in palestra.
		await db.update(avvisi).set({ apertoIl: giorniFa(31), chiusoIl: giorniFa(31), chiave: fra(-31) })
			.where(and(inArray(avvisi.personaId, [id.persone.calo, id.persone.tornato]), eq(avvisi.tipo, 'frequenza')));
		await db.insert(ingressi).values(ingresso(id.soci.tornato, new Date()));
		const [diNuovo] = await frequenza('calo');
		assert.ok(diNuovo, 'ancora in calo: ricompare');
		assert.equal(diNuovo.chiave, oggiIso(), 'un\'occorrenza nuova');
		assert.deepEqual(await frequenza('tornato'), [], 'è tornato a venire: non ricompare');
		assert.equal((await righeDi('calo', 'frequenza')).length, 2);
	});

	test('due allineamenti insieme non scrivono due volte', async () => {
		const { oggi, soglie, persone: tutte } = await situazioni();
		await Promise.all([
			come('reception', 'GET', '/api/avvisi'), come('admin', 'GET', '/api/avvisi'),
			allinea(db, tutte, oggi, soglie), allinea(db, tutte, oggi, soglie),
		]);
		const righe = await db.select().from(avvisi).where(inArray(avvisi.personaId, Object.values(id.persone)));
		const occorrenze = righe.map((r) => `${r.personaId}|${r.tipo}|${r.chiave}`);
		assert.equal(new Set(occorrenze).size, occorrenze.length);
		const frequenzeAperte = righe.filter((r) => r.tipo === 'frequenza' && !r.chiusoIl).map((r) => r.personaId);
		assert.equal(new Set(frequenzeAperte).size, frequenzeAperte.length, 'una sola frequenza aperta per socio');
	});
});

describe('le Regole', () => {
	test('le legge chi segue i soci, le cambia solo l\'amministratore', async () => {
		const letta = await come('reception', 'GET', '/api/impostazioni/da-fare');
		assert.equal(letta.statusCode, 200, letta.body);
		assert.equal(typeof letta.json().soglie.segnali.assenzaGiorni, 'number');
		assert.equal(typeof letta.json().soglie.scadutoGiorni, 'number');
		assert.ok(Array.isArray(letta.json().segnali_spenti));
		assert.equal((await come('reception', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: ['traguardo'] })).statusCode, 403);
	});

	test('si salvano solo soglie sensate e segnali che esistono; l\'archiviazione può essere "mai"', async () => {
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { assenzaGiorni: 0 } } })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { boh: 3 } })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { noShowSegnale: 2 } } })).statusCode, 400, 'una soglia tolta');
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: ['inventato'] })).statusCode, 400);
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { segnali_spenti: ['scaduto_recuperabile'] })).statusCode, 400, 'il nome vecchio dello scaduto');
		const mai = await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { segnali: { archiviazioneGiorni: 0 } } });
		assert.equal(mai.statusCode, 200, mai.body);
		assert.equal(mai.json().soglie.segnali.archiviazioneGiorni, 0);
	});

	test('le Regole nuove si salvano, i compleanni anche a zero, e il registro delle azioni lo dice', async () => {
		await db.delete(auditLogs).where(and(eq(auditLogs.entitaTipo, 'impostazioni'), eq(auditLogs.dettagli, 'Soglie cambiate')));
		assert.equal((await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { scadutoGiorni: 0 } })).statusCode, 400, 'lo scaduto non chiude il giorno stesso');
		const res = await come('admin', 'PUT', '/api/impostazioni/da-fare', {
			soglie: { scadutoGiorni: 61, frequenzaRiapriGiorni: 31, compleannoPrimaGiorni: 4, compleannoDopoGiorni: 0 },
		});
		assert.equal(res.statusCode, 200, res.body);
		const { soglie } = res.json();
		assert.deepEqual([soglie.scadutoGiorni, soglie.frequenzaRiapriGiorni, soglie.compleannoPrimaGiorni, soglie.compleannoDopoGiorni], [61, 31, 4, 0]);
		const [voce] = await db.select().from(auditLogs).where(and(eq(auditLogs.entitaTipo, 'impostazioni'), eq(auditLogs.dettagli, 'Soglie cambiate')));
		assert.ok(voce, 'nel registro delle azioni');
		assert.match(voce.valoreNuovo, /"scadutoGiorni":61/);
		// Le predefinite, per gli altri file che girano intanto.
		await come('admin', 'PUT', '/api/impostazioni/da-fare', { soglie: { scadutoGiorni: 60, frequenzaRiapriGiorni: 30, compleannoPrimaGiorni: 3, compleannoDopoGiorni: 3 } });
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
		const [lontano] = await db.insert(members).values({ nome: 'lontano', cognome: `DaFare${lettere}`, codiceSocio: `DFA${lettere}` }).returning();
		id.soci.lontano = lontano.id; id.persone.lontano = lontano.personaId;
		await db.insert(subscriptions).values({ memberId: lontano.id, planName: 'Vecchio', startDate: fra(-400), endDate: fra(-200) });
		await db.insert(memberDocuments).values([
			{ memberId: lontano.id, documentType: 'certificato_medico', expiryDate: fra(300) },
			{ memberId: lontano.id, documentType: 'documento_identita', expiryDate: fra(3000) },
		]);
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

	test('scrive le cose da fare quando compaiono e quando non ci sono più, e chiude gli avvisi anche se nessuno apre Da fare', async () => {
		// Due giri insieme (e gli altri file ne lanciano altri in parallelo): una riga sola.
		await Promise.all([giro(), giro()]);
		// Solo il rinnovo: l'assenza dipende dagli ingressi che gli altri test registrano.
		const aperti = (await diarioDi('scade')).filter((r) => r.tipo === 'segnale_aperto' && r.esito === 'in_scadenza');
		assert.equal(aperti.length, 1);
		assert.match(aperti[0].nota, /Abbonamento in scadenza — scade tra 3 giorni/);
		const [avviso] = await righeDi('scade', 'in_scadenza');
		assert.equal(avviso.chiusoIl, null);

		// Rinnova: il giro dopo chiude la cosa da fare, e l'avviso con «Rinnovato».
		await db.insert(subscriptions).values({ memberId: id.soci.scade, planName: 'Mensile', startDate: fra(4), endDate: fra(34) });
		await giro();
		await giro();
		const chiusi = (await diarioDi('scade')).filter((r) => r.tipo === 'segnale_chiuso' && r.esito === 'in_scadenza');
		assert.equal(chiusi.length, 1);
		assert.ok((await diarioDi('scade')).every((r) => r.autoreNome === 'Sistema'));
		const [dopo] = await righeDi('scade', 'in_scadenza');
		assert.equal(dopo.esito, 'rinnovato');
	});
});

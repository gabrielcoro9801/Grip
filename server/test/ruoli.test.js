// I ruoli configurabili, e quello che la configurazione non può fare.
//
// Portare la matrice dei permessi in banca dati è ciò che permette a ogni ente di darsi i
// propri ruoli. È anche il modo più facile per aprire un buco con una spunta sbagliata,
// quindi due regole restano nel codice e non hanno una schermata che le allenti:
// il socio non riceve mai permessi da qui, e l'amministratore non perde la gestione utenti.
//
// La terza protezione è un endpoint: nessuno può concedere ciò che non possiede.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { ruoli, staffAccounts, organizations } from '../src/db/schema/index.js';
import {
	applicaLimiti,
	impostaMatrice,
	ripristinaMatricePredefinita,
	canAccess,
	puo,
	capacitaDi,
	PERMESSI_PREDEFINITI,
} from '../../shared/permissions.js';
import { caricaMatrice } from '../src/lib/ruoli.js';

describe('il limite invalicabile', () => {
	test('al socio non si concede niente, per quanto lo si configuri', () => {
		const { permessi, capacita } = applicaLimiti({
			permessi: { member: { finance: ['view', 'edit'], admin_users: ['edit'], personale: ['view'] } },
			capacita: { member: ['registrazione_manuale', 'chiudere_esercizio'] },
		});
		assert.deepEqual(permessi.member, {});
		assert.deepEqual(capacita.member, []);
	});

	test("l'amministratore non può perdere la gestione utenti", () => {
		// Senza questa garanzia un salvataggio sbagliato chiuderebbe la porta dall'esterno:
		// nessuno potrebbe più aprire la schermata da cui si assegnano i permessi.
		const { permessi } = applicaLimiti({ permessi: { admin: { admin_users: [] } } });
		assert.deepEqual(permessi.admin.admin_users, ['view', 'edit']);
	});

	test("l'amministratore lo riottiene anche se il ruolo non compare affatto", () => {
		const { permessi } = applicaLimiti({ permessi: { reception: { crm_members: ['view'] } } });
		assert.deepEqual(permessi.admin.admin_users, ['view', 'edit']);
	});

	test('il limite non tocca gli altri ruoli', () => {
		const { permessi } = applicaLimiti({
			permessi: { reception: { finance: ['view', 'edit'] } },
		});
		assert.deepEqual(permessi.reception.finance, ['view', 'edit']);
	});

	test('il limite si applica anche in lettura, non solo in scrittura', () => {
		// Una riga scritta a mano nel database non deve poter scavalcare il controllo.
		impostaMatrice({ permessi: { member: { finance: ['view', 'edit'] } }, capacita: { member: ['chiudere_esercizio'] } });
		assert.equal(canAccess('member', 'finance', 'view'), false);
		assert.equal(puo('member', 'chiudere_esercizio'), false);
		ripristinaMatricePredefinita();
	});
});

describe('la matrice caricata sostituisce quella predefinita', () => {
	after(() => ripristinaMatricePredefinita());

	test('un ruolo può ricevere permessi che il codice non gli dava', () => {
		assert.equal(canAccess('reception', 'finance', 'edit'), false, 'di partenza non ce l’ha');
		impostaMatrice({
			permessi: { ...PERMESSI_PREDEFINITI, reception: { finance: ['view', 'edit'] } },
			capacita: { reception: ['chiudere_esercizio'] },
		});
		assert.equal(canAccess('reception', 'finance', 'edit'), true);
		assert.equal(puo('reception', 'chiudere_esercizio'), true);
	});

	test('e può perderne', () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, reception: {} }, capacita: {} });
		assert.equal(canAccess('reception', 'crm_members', 'view'), false);
		assert.deepEqual(capacitaDi('admin'), []);
	});

	test('il ripristino riporta i valori del codice', () => {
		ripristinaMatricePredefinita();
		assert.equal(canAccess('reception', 'crm_members', 'view'), true);
		assert.equal(canAccess('reception', 'finance', 'edit'), false);
		assert.ok(capacitaDi('admin').includes('chiudere_esercizio'));
	});
});

describe("nessuno concede ciò che non ha", () => {
	let app;
	let tokenAdmin;
	let tokenDelegato;
	let idOrg;
	let idRuoloReception;
	let permessiOriginaliReception;
	const idAccount = [];
	const nomiRuoliCreati = [];

	const PASSWORD = 'prova-ruoli-1234';

	before(async () => {
		ripristinaMatricePredefinita();
		app = buildApp({ logger: false });
		await app.ready();

		const [ente] = await db.select().from(organizations).limit(1);
		idOrg = ente.id;

		const suffisso = Date.now();
		const passwordHash = await bcrypt.hash(PASSWORD, 4);

		// Un ruolo che amministra gli utenti ma non tocca la contabilità: è il caso da
		// difendere — se potesse concedersi la contabilità, delegare gli utenti
		// equivarrebbe a delegare tutto.
		const nomeDelegato = `deleg${suffisso % 100000}`;
		nomiRuoliCreati.push(nomeDelegato);
		await db.insert(ruoli).values({
			organizationId: idOrg,
			nome: nomeDelegato,
			label: 'Segreteria',
			permessi: { admin_users: ['view', 'edit'], crm_members: ['view', 'edit'] },
			capacita: [],
			sistema: false,
		});

		const account = await db.insert(staffAccounts).values([
			{ nome: 'Admin prova', email: `admin.ruoli.${suffisso}@test.local`, passwordHash, ruolo: 'admin' },
			{ nome: 'Segreteria prova', email: `deleg.ruoli.${suffisso}@test.local`, passwordHash, ruolo: nomeDelegato },
		]).returning();
		idAccount.push(...account.map((a) => a.id));

		const login = async (email) => {
			const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
			assert.equal(res.statusCode, 200, res.body);
			return res.json().token;
		};
		// Il ruolo appena creato esiste in banca dati ma non ancora nella matrice in uso:
		// va caricata, come fa il server all'avvio.
		await caricaMatrice(idOrg);

		tokenAdmin = await login(account[0].email);
		tokenDelegato = await login(account[1].email);

		const [reception] = await db.select().from(ruoli)
			.where(and(eq(ruoli.organizationId, idOrg), eq(ruoli.nome, 'reception'))).limit(1);
		idRuoloReception = reception.id;
		permessiOriginaliReception = { permessi: reception.permessi, capacita: reception.capacita };
	});

	after(async () => {
		if (idRuoloReception) {
			await db.update(ruoli).set(permessiOriginaliReception).where(eq(ruoli.id, idRuoloReception));
		}
		if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
		if (nomiRuoliCreati.length) await db.delete(ruoli).where(inArray(ruoli.nome, nomiRuoliCreati));
		ripristinaMatricePredefinita();
		await app.close();
		await pool.end();
	});

	const salva = (token, corpo) => app.inject({
		method: 'PUT',
		url: `/api/ruoli/${idRuoloReception}`,
		headers: { authorization: `Bearer ${token}` },
		payload: corpo,
	});

	test('chi non amministra gli utenti non apre nemmeno la schermata', async () => {
		const res = await app.inject({ method: 'GET', url: `/api/ruoli?organization_id=${idOrg}` });
		assert.equal(res.statusCode, 401);
	});

	test('la segreteria non può concedere la contabilità, che non ha', async () => {
		const res = await salva(tokenDelegato, { permessi: { finance: ['view', 'edit'] }, capacita: [] });
		assert.equal(res.statusCode, 403);
		assert.match(res.json().error, /che tu stesso non hai/);
		assert.match(res.json().error, /Contabilità avanzata/);
	});

	test('né una capacità che non possiede', async () => {
		const res = await salva(tokenDelegato, { permessi: {}, capacita: ['chiudere_esercizio'] });
		assert.equal(res.statusCode, 403);
		assert.match(res.json().error, /Chiudere un esercizio/);
	});

	test('può però concedere quello che ha', async () => {
		const res = await salva(tokenDelegato, { permessi: { crm_members: ['view'] }, capacita: [] });
		assert.equal(res.statusCode, 200, res.body);
		assert.deepEqual(res.json().ruolo.permessi, { crm_members: ['view'] });
	});

	test("l'amministratore può concedere tutto, perché tutto ha", async () => {
		const res = await salva(tokenAdmin, {
			permessi: { finance: ['view', 'edit'], crm_members: ['view', 'edit'] },
			capacita: ['chiudere_esercizio'],
		});
		assert.equal(res.statusCode, 200, res.body);
		// E il cambiamento vale subito, senza riavviare.
		assert.equal(canAccess('reception', 'finance', 'edit'), true);
		assert.equal(puo('reception', 'chiudere_esercizio'), true);
	});

	test('moduli e capacità inventati vengono rifiutati', async () => {
		assert.equal((await salva(tokenAdmin, { permessi: { inventato: ['view'] } })).statusCode, 400);
		assert.equal((await salva(tokenAdmin, { permessi: {}, capacita: ['inventata'] })).statusCode, 400);
		assert.equal((await salva(tokenAdmin, { permessi: { finance: ['cancella'] } })).statusCode, 400);
	});

	// --- Creazione di ruoli nuovi

	const crea = (token, corpo) => app.inject({
		method: 'POST',
		url: '/api/ruoli',
		headers: { authorization: `Bearer ${token}` },
		payload: { organization_id: idOrg, ...corpo },
	});

	test('un ruolo nuovo nasce con un nome tecnico ricavato dall’etichetta', async () => {
		nomiRuoliCreati.push('tesoriere');
		const res = await crea(tokenAdmin, { label: 'Tesoriere', permessi: { finance: ['view'] } });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().ruolo.nome, 'tesoriere');
		assert.equal(res.json().ruolo.sistema, false);
		assert.equal(canAccess('tesoriere', 'finance', 'view'), true, 'vale subito, senza riavviare');
	});

	test('gli accenti e gli spazi non finiscono nel nome tecnico', async () => {
		nomiRuoliCreati.push('responsabile_attivita');
		const res = await crea(tokenAdmin, { label: 'Responsabile Attività' });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().ruolo.nome, 'responsabile_attivita');
	});

	test('un nome che collide viene rifiutato dicendo con chi', async () => {
		const res = await crea(tokenAdmin, { label: 'tesoriere' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /Esiste già un ruolo/);
	});

	test("un'etichetta senza lettere né cifre non è un nome", async () => {
		assert.equal((await crea(tokenAdmin, { label: '###' })).statusCode, 400);
		assert.equal((await crea(tokenAdmin, { label: '   ' })).statusCode, 400);
	});

	test('anche in creazione non si concede ciò che non si ha', async () => {
		// Senza questo controllo sul POST, chi amministra gli utenti creerebbe un ruolo con
		// quello che vuole e poi se lo assegnerebbe: stesso buco, altra porta.
		const res = await crea(tokenDelegato, { label: 'Scorciatoia', permessi: { finance: ['view', 'edit'] } });
		assert.equal(res.statusCode, 403);
		assert.match(res.json().error, /che tu stesso non hai/);
	});

	test('un ruolo senza account collegati si elimina', async () => {
		const creato = (await crea(tokenAdmin, { label: 'Effimero' })).json().ruolo;
		const res = await app.inject({
			method: 'DELETE', url: `/api/ruoli/${creato.id}`, headers: { authorization: `Bearer ${tokenAdmin}` },
		});
		assert.equal(res.statusCode, 200);
		assert.equal(canAccess('effimero', 'crm_members', 'view'), false);
	});

	test('un ruolo con account collegati no, e dice quanti', async () => {
		// Un account con un ruolo inesistente resterebbe senza alcun permesso, e chi lo usa
		// troverebbe l'applicazione vuota senza capire perché.
		const [ruoloDelegato] = await db.select().from(ruoli)
			.where(and(eq(ruoli.organizationId, idOrg), eq(ruoli.nome, nomiRuoliCreati[0]))).limit(1);
		const res = await app.inject({
			method: 'DELETE', url: `/api/ruoli/${ruoloDelegato.id}`, headers: { authorization: `Bearer ${tokenAdmin}` },
		});
		assert.equal(res.statusCode, 400);
		assert.equal(res.json().account_collegati, 1);
		assert.match(res.json().error, /spostali su un altro ruolo/);
	});

	test('i ruoli di base non si eliminano mai', async () => {
		const res = await app.inject({
			method: 'DELETE', url: `/api/ruoli/${idRuoloReception}`, headers: { authorization: `Bearer ${tokenAdmin}` },
		});
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /ruoli di base/);
	});
});

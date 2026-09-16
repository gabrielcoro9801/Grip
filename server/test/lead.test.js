// I lead e la loro trasformazione in soci, contro le rotte vere.
//
// Tre cose da non rompere: un lead è un contatto e non entra nella piattaforma; i canali da
// cui arrivano si disattivano ma non spariscono da sotto i contatti; e la trasformazione crea
// il socio e cancella il contatto insieme, o non fa niente.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, leads, canaliContatto, organizations, numberingCounters, ruoli } from '../src/db/schema/index.js';
import { caricaMatrice, caricaMatriceIniziale } from '../src/lib/ruoli.js';

const PASSWORD = 'prova-lead-1234';
const CF = 'RSSMRA85T10A562S';

let app;
const token = {};
const idAccount = [];
const idSocio = [];
const idLead = [];
const idCanali = [];
let canale;
let contatoreIniziale;
let idEnte;

const come = (chi, opzioni) =>
	app.inject({ ...opzioni, headers: { authorization: `Bearer ${token[chi]}`, ...opzioni.headers } });
const post = (chi, url, payload = {}) => come(chi, { method: 'POST', url, payload });

async function nuovoLead(dati = {}) {
	const res = await post('reception', '/api/entities/Lead', {
		nome: 'Anna', cognome: 'Verdi', data_contatto: '2026-09-10', canale_id: canale.id, sesso: 'F', ...dati,
	});
	assert.equal(res.statusCode, 201, res.body);
	idLead.push(res.json().id);
	return res.json();
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	const [socio] = await db.insert(members).values({ nome: 'Socio', cognome: 'Lead', email: `soc.lead.${suffisso}@test.local` }).returning();
	idSocio.push(socio.id);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Reception Lead', email: `rec.lead.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			{ nome: 'Istruttore Lead', email: `ist.lead.${suffisso}@test.local`, passwordHash, ruolo: 'istruttore' },
			{ nome: 'Socio Lead', email: `soc.lead.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	const accedi = async (email) => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
		assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
		return res.json().token;
	};
	token.reception = await accedi(account[0].email);
	token.istruttore = await accedi(account[1].email);
	token.socio = await accedi(account[2].email);

	const [c] = await db.insert(canaliContatto).values({ nome: `Canale prova ${suffisso}` }).returning();
	canale = c;
	idCanali.push(c.id);

	// La trasformazione consuma un codice socio: a fine prova il contatore torna dov'era.
	const [ente] = await db.select().from(organizations).limit(1);
	idEnte = ente?.id;
	if (idEnte) {
		const [riga] = await db.select().from(numberingCounters)
			.where(and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio')));
		contatoreIniziale = riga?.value ?? null;
	}
});

after(async () => {
	if (idLead.length) await db.delete(leads).where(inArray(leads.id, idLead));
	if (idCanali.length) await db.delete(canaliContatto).where(inArray(canaliContatto.id, idCanali));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await db.delete(members).where(inArray(members.id, idSocio));
	if (idEnte) {
		const dove = and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio'));
		if (contatoreIniziale === null) await db.delete(numberingCounters).where(dove);
		else await db.update(numberingCounters).set({ value: contatoreIniziale }).where(dove);
	}
	await app.close();
	await pool.end();
});

describe('i lead restano fuori', () => {
	test('il socio non legge né scrive lead e canali, e non trasforma', async () => {
		const lead = await nuovoLead();
		for (const url of ['/api/entities/Lead', '/api/entities/CanaleContatto', `/api/entities/Lead/${lead.id}`]) {
			assert.equal((await come('socio', { method: 'GET', url })).statusCode, 403, url);
		}
		assert.equal((await post('socio', '/api/entities/Lead', { nome: 'X' })).statusCode, 403);
		assert.equal((await post('socio', `/api/lead/${lead.id}/trasforma`, { nome: 'X' })).statusCode, 403);
	});

	test("l'istruttore li vede ma non li tocca", async () => {
		assert.equal((await come('istruttore', { method: 'GET', url: '/api/entities/Lead' })).statusCode, 200);
		assert.equal((await post('istruttore', '/api/entities/Lead', { nome: 'X' })).statusCode, 403);
		assert.equal((await post('istruttore', '/api/entities/CanaleContatto', { nome: 'X' })).statusCode, 403);
	});
});

describe("l'anagrafica di un lead", () => {
	test('nome, cognome, giornata, canale e sesso sono obbligatori; telefono, email e anno no', async () => {
		const completo = { nome: 'A', cognome: 'B', data_contatto: '2026-09-10', canale_id: canale.id, sesso: 'M' };
		for (const manca of Object.keys(completo)) {
			const { [manca]: _tolto, ...corpo } = completo;
			const res = await post('reception', '/api/entities/Lead', corpo);
			assert.equal(res.statusCode, 400, `senza ${manca}: ${res.body}`);
		}
		assert.equal((await post('reception', '/api/entities/Lead', { ...completo, nome: '  ' })).statusCode, 400, 'nome di soli spazi');
		assert.equal((await post('reception', '/api/entities/Lead', { ...completo, sesso: 'X' })).statusCode, 400);
		assert.equal((await post('reception', '/api/entities/Lead', { ...completo, anno_nascita: 1800 })).statusCode, 400);

		const lead = await nuovoLead({ telefono: '', email: '' });
		assert.equal(lead.telefono, null, 'un campo lasciato vuoto non è un numero');
		assert.equal(lead.email, null);
	});
});

describe('i canali', () => {
	test('un canale usato non si elimina, si disattiva', async () => {
		const [usato] = await db.insert(canaliContatto).values({ nome: `Usato ${Date.now()}` }).returning();
		idCanali.push(usato.id);
		await nuovoLead({ canale_id: usato.id });

		const elimina = await come('reception', { method: 'DELETE', url: `/api/entities/CanaleContatto/${usato.id}` });
		assert.equal(elimina.statusCode, 400);
		assert.match(elimina.json().error, /disattivalo/);

		const disattiva = await come('reception', { method: 'PUT', url: `/api/entities/CanaleContatto/${usato.id}`, payload: { attivo: false } });
		assert.equal(disattiva.json().attivo, false);
	});

	test('due canali con lo stesso nome no', async () => {
		const res = await post('reception', '/api/entities/CanaleContatto', { nome: canale.nome });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /canale con questo nome/);
	});
});

describe('la trasformazione in socio', () => {
	test('senza codice fiscale valido non si fa, e il lead resta', async () => {
		const lead = await nuovoLead();
		const base = { nome: 'Anna', cognome: 'Verdi', sesso: 'F' };
		assert.equal((await post('reception', `/api/lead/${lead.id}/trasforma`, base)).statusCode, 400);
		assert.equal((await post('reception', `/api/lead/${lead.id}/trasforma`, { ...base, codice_fiscale: 'RSSMRA85T10A562T' })).statusCode, 400);
		const [ancora] = await db.select().from(leads).where(eq(leads.id, lead.id));
		assert.ok(ancora);
	});

	test('crea il socio col codice e cancella il lead; la seconda volta non trova niente', async () => {
		const lead = await nuovoLead({ telefono: '333 111', email: 'anna@test.local' });
		const ok = await post('reception', `/api/lead/${lead.id}/trasforma`, {
			nome: 'Anna Maria', cognome: 'Verdi', sesso: 'F', codice_fiscale: CF.toLowerCase(), phone: '333 111',
			email: 'anna@test.local', gdpr_consent: true, full_name: 'Nome Inventato', codice_socio: '999999',
		});
		assert.equal(ok.statusCode, 201, ok.body);
		const { member } = ok.json();
		idSocio.push(member.id);

		assert.equal(member.full_name, 'Anna Maria Verdi', 'il nome completo lo calcola il database');
		assert.equal(member.codice_fiscale, CF, 'normalizzato in maiuscolo');
		assert.equal(member.gdpr_consent, true);
		assert.ok(member.gdpr_consent_date);
		if (idEnte) assert.match(member.codice_socio, /^\d{6}$/);
		assert.notEqual(member.codice_socio, '999999', 'il codice lo assegna il contatore');

		assert.equal((await db.select().from(leads).where(eq(leads.id, lead.id))).length, 0, 'il lead non c\'è più');
		assert.equal((await post('reception', `/api/lead/${lead.id}/trasforma`, { nome: 'A', cognome: 'B', sesso: 'F', codice_fiscale: CF })).statusCode, 404);
	});

	test('chi gestisce i lead ma non i soci non trasforma', async () => {
		// Si toglie alla reception la modifica dei soci, e si rimette com'era.
		const [ruolo] = await db.select().from(ruoli).where(eq(ruoli.nome, 'reception')).limit(1);
		if (!ruolo) return; // installazione senza ruoli salvati: la matrice è quella predefinita
		const originali = ruolo.permessi;
		try {
			await db.update(ruoli).set({ permessi: { ...originali, crm_members: ['view'], crm_leads: ['view', 'edit'] } }).where(eq(ruoli.id, ruolo.id));
			await caricaMatrice(ruolo.organizationId);
			const lead = await nuovoLead();
			const res = await post('reception', `/api/lead/${lead.id}/trasforma`, { nome: 'A', cognome: 'B', sesso: 'F', codice_fiscale: CF });
			assert.equal(res.statusCode, 403);
		} finally {
			await db.update(ruoli).set({ permessi: originali }).where(eq(ruoli.id, ruolo.id));
			await caricaMatriceIniziale();
		}
	});
});

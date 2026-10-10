// L'anagrafica dei soci e i loro documenti, contro l'endpoint generico.
//
// Il codice fiscale è obbligatorio per chi nasce oggi, ma i soci registrati prima non ce
// l'hanno: devono restare modificabili, senza che il codice si possa svuotare o scrivere male.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, memberDocuments, numberingCounters, persone } from '../src/db/schema/index.js';
import { enteDellaNumerazione } from '../src/lib/codiceSocio.js';

const PASSWORD = 'prova-anagrafica-1234';
const CF = 'MRTMTT25D09F205Z';

let app;
let tokenReception;
const idSoci = [];
const idAccount = [];
let idEnte;
let contatoreIniziale;

const come = (opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${tokenReception}` } });
const crea = (payload) => come({ method: 'POST', url: '/api/entities/Member', payload });
const modifica = (id, payload) => come({ method: 'PUT', url: `/api/entities/Member/${id}`, payload });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();
	const [account] = await db
		.insert(staffAccounts)
		.values({ nome: 'Reception Anagrafica', email: `rec.anag.${suffisso}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception' })
		.returning();
	idAccount.push(account.id);

	// Ogni socio creato consuma un codice: a fine prova il contatore torna dov'era.
	idEnte = await enteDellaNumerazione(db);
	const [riga] = await db.select().from(numberingCounters)
		.where(and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio')));
	contatoreIniziale = riga?.value ?? null;
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account.email, password: PASSWORD } });
	tokenReception = res.json().token;
});

after(async () => {
	if (idSoci.length) {
		await db.delete(memberDocuments).where(inArray(memberDocuments.memberId, idSoci));
		await db.delete(members).where(inArray(members.id, idSoci));
	}
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	const dove = and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio'));
	if (contatoreIniziale === null) await db.delete(numberingCounters).where(dove);
	// Mai sotto un codice ancora in uso: le altre prove girano in parallelo.
	else await db.update(numberingCounters).set({ value: sql`GREATEST(${contatoreIniziale}, COALESCE((SELECT MAX(CAST(NULLIF(regexp_replace(codice_socio, '\\D', '', 'g'), '') AS INTEGER)) FROM ${members}), 0))` }).where(dove);
	await app.close();
	await pool.end();
});

describe('creare un socio', () => {
	test('nome, cognome, sesso, codice fiscale valido e data di nascita sono obbligatori', async () => {
		const completo = { nome: 'Matteo', cognome: 'Moretti', sesso: 'M', codice_fiscale: CF, date_of_birth: '1985-12-10' };
		for (const manca of Object.keys(completo)) {
			const { [manca]: _tolto, ...corpo } = completo;
			assert.equal((await crea(corpo)).statusCode, 400, `senza ${manca}`);
		}
		const sbagliato = await crea({ ...completo, codice_fiscale: 'MRTMTT25D09F205A' });
		assert.equal(sbagliato.statusCode, 400);
		assert.match(sbagliato.json().error, /codice fiscale/i);
	});

	test('la data di nascita va scritta e non può essere nel futuro', async () => {
		const base = { nome: 'Matteo', cognome: 'Moretti', sesso: 'M', codice_fiscale: CF };
		const futura = await crea({ ...base, date_of_birth: '2999-01-01' });
		assert.equal(futura.statusCode, 400);
		assert.match(futura.json().error, /futuro/);
		assert.match((await crea({ ...base, date_of_birth: '2001-02-30' })).json().error, /non è valida/);
	});

	test('il nome completo non si scrive: lo calcola il database', async () => {
		const res = await crea({ nome: 'Matteo', cognome: 'Moretti', sesso: 'M', codice_fiscale: CF, date_of_birth: '1985-12-10', full_name: 'Altro Nome' });
		assert.equal(res.statusCode, 201, res.body);
		idSoci.push(res.json().id);
		assert.equal(res.json().full_name, 'Matteo Moretti');
	});

	test('il codice socio lo assegna sempre il contatore, anche senza ente nel modulo', async () => {
		const [creato] = await db.select().from(members).where(eq(members.id, idSoci[0]));
		assert.match(creato.codiceSocio, /^\d{6}$/);
	});

	test('lo stesso codice fiscale non vale per due soci, maiuscole o no', async () => {
		const res = await crea({ nome: 'Altro', cognome: 'Socio', sesso: 'M', codice_fiscale: CF.toLowerCase(), date_of_birth: '1990-01-01' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /già un socio con questo codice fiscale/);
	});
});

describe('modificare un socio', () => {
	test('cambiando il cognome cambia il nome completo', async () => {
		const res = await modifica(idSoci[0], { cognome: 'Moretti Rossi' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().full_name, 'Matteo Moretti Rossi');
	});

	test('il codice socio non si riscrive', async () => {
		const [prima] = await db.select().from(members).where(eq(members.id, idSoci[0]));
		const res = await modifica(idSoci[0], { codice_socio: 'XXXXXX' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().codice_socio, prima.codiceSocio);
	});

	test('il codice fiscale non si svuota e non si sbaglia', async () => {
		assert.equal((await modifica(idSoci[0], { codice_fiscale: '' })).statusCode, 400);
		assert.equal((await modifica(idSoci[0], { codice_fiscale: 'NONVALIDO' })).statusCode, 400);
	});

	test('nemmeno la data di nascita si svuota', async () => {
		assert.equal((await modifica(idSoci[0], { date_of_birth: '' })).statusCode, 400);
		assert.equal((await modifica(idSoci[0], { date_of_birth: null })).statusCode, 400);
	});

	test('un socio di prima, senza codice fiscale, resta modificabile nel resto', async () => {
		const [vecchio] = await db.insert(members).values({ nome: 'Socio', cognome: 'Storico', codiceSocio: `ST${String(Date.now()).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}` }).returning();
		idSoci.push(vecchio.id);
		const res = await modifica(vecchio.id, { phone: '333 000 1111' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().phone, '+393330001111');
	});

	test('i telefoni si salvano in formato internazionale, e uno che non è un numero si rifiuta', async () => {
		const ok = await modifica(idSoci[0], { phone: '0039 347.123.4567', emergency_contact_phone: '06 1234567' });
		assert.equal(ok.statusCode, 200, ok.body);
		assert.equal(ok.json().phone, '+393471234567');
		assert.equal(ok.json().emergency_contact_phone, '+39061234567');
		const sbagliato = await modifica(idSoci[0], { phone: '333 000' });
		assert.equal(sbagliato.statusCode, 400);
		assert.match(sbagliato.json().error, /non è un telefono valido/);
		assert.equal((await modifica(idSoci[0], { phone: '' })).json().phone, null, 'vuoto vuol dire nessun numero');
	});

	test('la persona del socio segue la sua anagrafica', async () => {
		await modifica(idSoci[0], { email: 'segue@test.local', notes: 'Nota da seguire' });
		const [socio] = await db.select().from(members).where(eq(members.id, idSoci[0]));
		const [persona] = await db.select().from(persone).where(eq(persone.id, socio.personaId));
		assert.equal(persona.email, 'segue@test.local');
		assert.equal(persona.nota, 'Nota da seguire');
		assert.equal(persona.fullName, socio.fullName);
		const spostato = await modifica(idSoci[0], { persona_id: '00000000-0000-0000-0000-000000000000' });
		assert.equal(spostato.statusCode, 200, spostato.body);
		assert.equal(spostato.json().persona_id, socio.personaId, 'la persona non si cambia dal modulo');
	});
});

describe('i documenti', () => {
	const carica = (payload) => come({ method: 'POST', url: '/api/entities/MemberDocument', payload: { member_id: idSoci[0], ...payload } });

	test('quattro tipi, e ognuno con quello che gli serve', async () => {
		assert.equal((await carica({ document_type: 'Certificato Medico', expiry_date: '2027-01-01' })).statusCode, 400, 'tipo non ammesso');
		assert.equal((await carica({ document_type: 'xyz' })).statusCode, 400, 'tipo inventato');
		assert.equal((await carica({ document_type: 'certificato_medico' })).statusCode, 400, 'certificato senza scadenza');
		assert.equal((await carica({ document_type: 'documento_identita' })).statusCode, 400, 'identità senza scadenza');
		assert.equal((await carica({ document_type: 'altro' })).statusCode, 400, 'altro senza titolo');

		assert.equal((await carica({ document_type: 'certificato_medico', expiry_date: '2027-01-01' })).statusCode, 201);
		assert.equal((await carica({ document_type: 'documento_identita', expiry_date: '2030-05-20' })).statusCode, 201);
		assert.equal((await carica({ document_type: 'altro', titolo: 'Contratto' })).statusCode, 201);
		// Il consenso dei genitori non scade: si carica senza data di scadenza.
		assert.equal((await carica({ document_type: 'consenso_genitori' })).statusCode, 201);

		const righe = await db.select().from(memberDocuments).where(eq(memberDocuments.memberId, idSoci[0]));
		assert.equal(righe.length, 4);
	});
});

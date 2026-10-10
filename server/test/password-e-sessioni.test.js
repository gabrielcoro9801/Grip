// Password scelte da altri e sessioni già aperte.
//
// Il meccanismo di revoca c'era, ma lo usava solo il cambio password fatto dall'interessato.
// Quando l'amministratore reimpostava una password o cambiava un ruolo, l'endpoint generico
// aggiornava la riga e basta: chi era già dentro restava dentro fino a dodici ore (staff) o
// trenta giorni (soci), e un utente declassato conservava i poteri di prima. E la password
// temporanea detta dalla reception restava valida per sempre, perché nessuno poteva cambiarla.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts } from '../src/db/schema/index.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';

const PASSWORD = 'prova-sessioni-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const email = (chi) => `sessioni.${chi}.${suffisso}@test.local`;

let app;
const id = {};
const idAccount = [];
const idSoci = [];

const accedi = async (chi, password = PASSWORD) => {
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: email(chi), password } });
	assert.equal(res.statusCode, 200, res.body);
	return res.json();
};
const come = (token, opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });
const chiSono = (token) => come(token, { method: 'GET', url: '/api/auth/me' });

// "Vede ma non modifica": fino alla fase 3 del CRM era l'istruttore predefinito, e questi test lo
// usano così. Oggi l'istruttore ha la sua vista e non le anagrafiche: gli si ridà qui la sola lettura.
const SOLA_LETTURA = { ...PERMESSI_PREDEFINITI, istruttore: { crm_members: ['view'], crm_documents: ['view'], crm_leads: ['view'], calendar: ['view', 'edit'] } };
const matriceDiProva = () => impostaMatrice({ permessi: SOLA_LETTURA, capacita: {} });

before(async () => {
	matriceDiProva();
	app = buildApp({ logger: false });
	await app.ready();
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	for (const [chi, ruolo] of [['admin', 'admin'], ['reception', 'reception'], ['istruttore', 'istruttore'], ['bersaglio', 'admin']]) {
		const [account] = await db.insert(staffAccounts).values({ nome: `Prova ${chi}`, email: email(chi), passwordHash, ruolo }).returning();
		id[chi] = account.id;
		idAccount.push(account.id);
	}
	const soci = await db
		.insert(members)
		.values([
			{ nome: 'Socio', cognome: 'Con Email', codiceSocio: `SE${lettere}`, email: email('socio') },
			{ nome: 'Socio', cognome: 'Senza Email', codiceSocio: `SN${lettere}` },
		])
		.returning();
	[id.socio, id.socioSenzaEmail] = soci.map((s) => s.id);
	idSoci.push(...soci.map((s) => s.id));
});

after(async () => {
	ripristinaMatricePredefinita();
	await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, idSoci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await db.delete(members).where(inArray(members.id, idSoci));
	await app.close();
	await pool.end();
});

describe("una password reimpostata dall'amministratore", () => {
	const NUOVA = 'temporanea-data-da-admin';

	test('butta fuori chi era già dentro', async () => {
		const { token: admin } = await accedi('admin');
		const { token: vecchia } = await accedi('bersaglio');

		const reset = await come(admin, { method: 'PUT', url: `/api/entities/StaffAccount/${id.bersaglio}`, payload: { password: NUOVA } });
		assert.equal(reset.statusCode, 200, reset.body);
		assert.equal((await chiSono(vecchia)).statusCode, 401);
	});

	test('va cambiata prima di fare qualunque altra cosa', async () => {
		const { token, user } = await accedi('bersaglio', NUOVA);
		assert.equal(user.password_da_cambiare, true);

		// Il server risponde a chi è e al cambio password, e a nient'altro.
		assert.equal((await chiSono(token)).statusCode, 200);
		const bloccata = await come(token, { method: 'GET', url: '/api/entities/Course' });
		assert.equal(bloccata.statusCode, 403);
		assert.equal(bloccata.json().code, 'password_da_cambiare');
	});

	test('cambiata, si continua con il token nuovo e il blocco sparisce', async () => {
		const { token } = await accedi('bersaglio', NUOVA);
		const cambio = await come(token, {
			method: 'POST', url: '/api/auth/change-password',
			payload: { current_password: NUOVA, new_password: 'scelta-da-me-stesso' },
		});
		assert.equal(cambio.statusCode, 200, cambio.body);
		assert.equal(cambio.json().user.password_da_cambiare, false);

		assert.equal((await chiSono(token)).statusCode, 401, 'la sessione di prima non deve valere più');
		assert.equal((await come(cambio.json().token, { method: 'GET', url: '/api/entities/Course' })).statusCode, 200);
	});

	test('troppo corta viene rifiutata, dal reset come dal cambio', async () => {
		const { token: admin } = await accedi('admin');
		const reset = await come(admin, { method: 'PUT', url: `/api/entities/StaffAccount/${id.bersaglio}`, payload: { password: 'corta' } });
		assert.equal(reset.statusCode, 400);
		assert.match(reset.json().error, /almeno 10/);
	});

	test("l'amministratore che si cambia la propria da qui non si impone l'obbligo", async () => {
		const { token } = await accedi('admin');
		const res = await come(token, { method: 'PUT', url: `/api/entities/StaffAccount/${id.admin}`, payload: { password: 'admin-la-sceglie-lui' } });
		assert.equal(res.statusCode, 200, res.body);
		const [riga] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, id.admin));
		assert.equal(riga.passwordDaCambiare, false);
		await db.update(staffAccounts).set({ passwordHash: await bcrypt.hash(PASSWORD, 4) }).where(eq(staffAccounts.id, id.admin));
	});
});

describe('un ruolo cambiato', () => {
	test('chiude le sessioni aperte con il ruolo di prima', async () => {
		const { token: admin } = await accedi('admin');
		const { token: vecchia } = await accedi('istruttore');

		const cambio = await come(admin, { method: 'PUT', url: `/api/entities/StaffAccount/${id.istruttore}`, payload: { ruolo: 'reception' } });
		assert.equal(cambio.statusCode, 200, cambio.body);

		assert.equal((await chiSono(vecchia)).statusCode, 401, 'con il vecchio ruolo nel token non si resta dentro');
		const { user } = await accedi('istruttore');
		assert.equal(user.ruolo, 'reception');
		await db.update(staffAccounts).set({ ruolo: 'istruttore' }).where(eq(staffAccounts.id, id.istruttore));
	});
});

describe("la reception dà l'accesso al portale", () => {
	const url = (idSocio) => `/api/soci/${idSocio}/accesso-portale`;
	const TEMPORANEA = 'detta-allo-sportello';

	test("lo crea con l'email del socio, e il socio dovrà cambiare la password", async () => {
		const { token } = await accedi('reception');
		const res = await come(token, { method: 'POST', url: url(id.socio), payload: { password: TEMPORANEA } });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().creato, true);
		assert.equal(res.json().account.email, email('socio'));
		assert.equal(res.json().account.password_da_cambiare, true);

		const [account] = await db.select().from(staffAccounts).where(eq(staffAccounts.linkedMemberId, id.socio));
		assert.equal(account.ruolo, 'member', 'dalla scheda socio nasce solo un accesso al portale');
	});

	test('reimpostarla chiude le sessioni del socio', async () => {
		const { token: reception } = await accedi('reception');
		const { token: socio } = await accedi('socio', TEMPORANEA);

		const res = await come(reception, { method: 'POST', url: url(id.socio), payload: { password: 'un-altra-temporanea' } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().creato, false);
		assert.equal((await chiSono(socio)).statusCode, 401);
	});

	test("senza email non si crea, e lo si dice", async () => {
		const { token } = await accedi('reception');
		const res = await come(token, { method: 'POST', url: url(id.socioSenzaEmail), payload: { password: TEMPORANEA } });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /email/);
	});

	test('chi vede i soci ma non li modifica non lo dà', async () => {
		const { token } = await accedi('istruttore');
		const res = await come(token, { method: 'POST', url: url(id.socio), payload: { password: TEMPORANEA } });
		assert.equal(res.statusCode, 403);
		// Ma vedere se c'è, sì.
		assert.equal((await come(token, { method: 'GET', url: url(id.socio) })).statusCode, 200);
	});
});

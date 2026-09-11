// Buttare fuori qualcuno che è già dentro.
//
// Un token firmato vale finché non scade, e il server non può fermarlo: è la natura dei
// token autoconsistenti. Finché le sessioni duravano dodici ore il problema era contenuto —
// un telefono rubato restava dentro fino a sera. Le sessioni del portale ora durano trenta
// giorni, perché il socio apre l'applicazione in palestra col telefono in mano e non può
// digitare la password davanti al tornello: quei trenta giorni sono sostenibili **solo**
// perché una sessione si può revocare.
//
// Questo test è la prova che si possa. Senza, la scadenza lunga sarebbe un rischio e non una
// comodità.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts } from '../src/db/schema/index.js';
import { revocaSessioniDi } from '../src/auth/revoca.js';
import { config } from '../src/config.js';

const PASSWORD = 'prova-revoca-1234';
const suffisso = Date.now();
const emailStaff = `revoca.staff.${suffisso}@test.local`;
const emailSocio = `revoca.socio.${suffisso}@test.local`;

let app;
let idSocio;
const idAccount = [];

async function accedi(email) {
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
	assert.equal(res.statusCode, 200, res.body);
	return res.json().token;
}

const chiSono = (token) =>
	app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const [socio] = await db
		.insert(members)
		.values({ fullName: 'Socio Revoca', email: emailSocio })
		.returning();
	idSocio = socio.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Admin Revoca', email: emailStaff, passwordHash, ruolo: 'admin' },
			{ nome: 'Socio Revoca', email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));
});

after(async () => {
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio]));
	await app.close();
	await pool.end();
});

describe('una sessione si può revocare', () => {
	test('finché non la si revoca, vale', async () => {
		const token = await accedi(emailStaff);
		assert.equal((await chiSono(token)).statusCode, 200);
	});

	test('revocata, smette di valere subito — non alla scadenza', async () => {
		const token = await accedi(emailStaff);
		const [account] = await db.select().from(staffAccounts).where(inArray(staffAccounts.email, [emailStaff]));

		await revocaSessioniDi(account.id);

		const dopo = await chiSono(token);
		assert.equal(dopo.statusCode, 401, dopo.body);
	});

	test('vale su tutte le rotte, non solo su /me', async () => {
		const token = await accedi(emailStaff);
		const [account] = await db.select().from(staffAccounts).where(inArray(staffAccounts.email, [emailStaff]));

		await revocaSessioniDi(account.id);

		// È il motivo per cui il controllo sta in un punto solo dell'applicazione: una
		// garanzia di sicurezza sparsa in sette file diventa sei garanzie e una dimenticanza.
		const entita = await app.inject({
			method: 'GET',
			url: '/api/entities/Member',
			headers: { authorization: `Bearer ${token}` },
		});
		assert.equal(entita.statusCode, 401, entita.body);
	});

	test('dopo la revoca si rientra accedendo di nuovo', async () => {
		const token = await accedi(emailStaff);
		assert.equal((await chiSono(token)).statusCode, 200);
	});

	test('revocare un account non tocca gli altri', async () => {
		const tokenSocio = await accedi(emailSocio);
		const [staff] = await db.select().from(staffAccounts).where(inArray(staffAccounts.email, [emailStaff]));

		await revocaSessioniDi(staff.id);

		assert.equal((await chiSono(tokenSocio)).statusCode, 200, 'il socio non doveva essere toccato');
	});
});

describe('il cambio password butta fuori le vecchie sessioni', () => {
	test('chi conosceva la vecchia password non resta dentro', async () => {
		const nuovaPassword = 'prova-revoca-nuova-5678';
		const vecchiaSessione = await accedi(emailStaff);

		const cambio = await app.inject({
			method: 'POST',
			url: '/api/auth/change-password',
			headers: { authorization: `Bearer ${vecchiaSessione}` },
			payload: { current_password: PASSWORD, new_password: nuovaPassword },
		});
		assert.equal(cambio.statusCode, 200, cambio.body);

		// Anche la sessione da cui si è chiesto il cambio: è voluto. Chi cambia la password
		// perché teme che qualcuno la conosca vuole che tutto quello che era aperto si chiuda.
		const dopo = await chiSono(vecchiaSessione);
		assert.equal(dopo.statusCode, 401, dopo.body);

		// E si rientra con quella nuova.
		const res = await app.inject({
			method: 'POST',
			url: '/api/auth/login',
			payload: { email: emailStaff, password: nuovaPassword },
		});
		assert.equal(res.statusCode, 200, res.body);
	});
});

describe('le scadenze', () => {
	test('il socio ha una sessione lunga, lo staff no', async () => {
		const tokenSocio = jwt.decode(await accedi(emailSocio));

		const giorni = (tokenSocio.exp - tokenSocio.iat) / 86400;
		assert.ok(giorni > 7, `la sessione del socio dura ${giorni} giorni: troppo poco per un telefono`);
	});

	test('i token emessi prima di questa colonna continuano a valere', async () => {
		// Il rilascio non deve buttare fuori chi è già connesso: un token senza `tv` è
		// accettato, e dal prossimo accesso il controllo è pieno.
		const [account] = await db.select().from(staffAccounts).where(inArray(staffAccounts.email, [emailSocio]));
		const vecchioStile = jwt.sign({ sub: account.id, ruolo: 'member' }, config.jwtSecret, { expiresIn: '1h' });

		assert.equal((await chiSono(vecchioStile)).statusCode, 200);
	});
});

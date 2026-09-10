// Il confine fra il portale soci e il resto dell'applicazione.
//
// È il punto in cui l'applicazione ha già sbagliato una volta: un socio autenticato
// riceveva 200 sugli account dello staff e sull'anagrafica degli altri soci, perché la
// separazione esisteva solo nell'interfaccia. Nascondere una voce di menu non impedisce
// la stessa richiesta fatta a mano, quindi questi controlli girano contro le rotte vere.
//
// Il test si costruisce i propri soci e i propri account e li cancella alla fine: non
// dipende da com'è popolato il database in cui gira.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, subscriptions, qrAccessi, exercisePlans, workoutLogs } from '../src/db/schema/index.js';

const PASSWORD = 'prova-permessi-1234';

let app;
let tokenSocio;
let tokenAdmin;
let idSocio;
let idEstraneo;
let idModello;
const idAccount = [];
const idAbbonamenti = [];
const idSchede = [];
const idAllenamenti = [];

async function login(email) {
	const res = await app.inject({
		method: 'POST',
		url: '/api/auth/login',
		payload: { email, password: PASSWORD },
	});
	assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
	return res.json().token;
}

function come(token, opzioni) {
	return app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}`, ...opzioni.headers } });
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const suffisso = Date.now();
	const [socio, estraneo] = await db
		.insert(members)
		.values([
			{ fullName: 'Socio Di Prova', email: `socio.prova.${suffisso}@test.local` },
			{ fullName: 'Socio Estraneo', email: `estraneo.prova.${suffisso}@test.local` },
		])
		.returning();
	idSocio = socio.id;
	idEstraneo = estraneo.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{
				nome: 'Socio Di Prova',
				email: `socio.prova.${suffisso}@test.local`,
				passwordHash,
				ruolo: 'member',
				linkedMemberId: socio.id,
			},
			{ nome: 'Admin Di Prova', email: `admin.prova.${suffisso}@test.local`, passwordHash, ruolo: 'admin' },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	// Un abbonamento a testa: senza quello dell'estraneo il filtro sembrerebbe funzionare
	// anche se non filtrasse nulla, perché non ci sarebbe niente da nascondere.
	const abbonamenti = await db
		.insert(subscriptions)
		.values([
			{ memberId: socio.id, planName: 'Abbonamento del socio', startDate: '2026-01-01', status: 'active' },
			{ memberId: estraneo.id, planName: "Abbonamento dell'estraneo", startDate: '2026-01-01', status: 'active' },
		])
		.returning();
	idAbbonamenti.push(...abbonamenti.map((s) => s.id));

	// Tre schede: un modello di catalogo, la scheda del socio, quella di un altro. Il
	// modello serve perché non appartiene a nessuno — è il caso che il filtro per socio
	// potrebbe lasciar passare senza che nessuno se ne accorga.
	const schede = await db
		.insert(exercisePlans)
		.values([
			{ isTemplate: true, name: 'Modello di catalogo', routines: [] },
			{ isTemplate: false, memberId: socio.id, name: 'La scheda del socio', routines: [] },
			{ isTemplate: false, memberId: estraneo.id, name: "La scheda dell'estraneo", routines: [] },
		])
		.returning();
	idModello = schede[0].id;
	idSchede.push(...schede.map((s) => s.id));

	tokenSocio = await login(account[0].email);
	tokenAdmin = await login(account[1].email);
});

after(async () => {
	// I codici di accesso li generano i test stessi e puntano al socio: vanno via per
	// primi, o l'anagrafica resta agganciata da una chiave esterna.
	if (idSocio) await db.delete(qrAccessi).where(inArray(qrAccessi.clienteId, [idSocio, idEstraneo]));
	if (idAllenamenti.length) await db.delete(workoutLogs).where(inArray(workoutLogs.id, idAllenamenti));
	if (idSchede.length) await db.delete(exercisePlans).where(inArray(exercisePlans.id, idSchede));
	if (idAbbonamenti.length) await db.delete(subscriptions).where(inArray(subscriptions.id, idAbbonamenti));
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	if (idSocio) await db.delete(members).where(inArray(members.id, [idSocio, idEstraneo]));
	await app.close();
	await pool.end();
});

describe('cosa un socio non deve poter leggere', () => {
	// Ciascuna di queste risposte è stata davvero 200 prima della correzione.
	for (const entita of [
		'StaffAccount',
		'Collaboratore',
		'AuditLog',
	]) {
		test(`${entita} è vietata`, async () => {
			const res = await come(tokenSocio, { method: 'GET', url: `/api/entities/${entita}` });
			assert.equal(res.statusCode, 403);
		});
	}
});

describe('cosa un socio legge di sé', () => {
	test('vede solo la propria anagrafica', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: '/api/entities/Member' });
		assert.equal(res.statusCode, 200);
		const righe = res.json();
		assert.equal(righe.length, 1);
		assert.equal(righe[0].id, idSocio);
	});

	test('vede solo il proprio abbonamento', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: '/api/entities/Subscription' });
		assert.equal(res.statusCode, 200);
		const altrui = res.json().filter((s) => s.member_id !== idSocio);
		assert.deepEqual(altrui, []);
	});

	test('chiedere per id la scheda di un altro socio non la restituisce', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: `/api/entities/Member/${idEstraneo}` });
		assert.equal(res.statusCode, 404);
	});

	test('la propria scheda per id si legge', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: `/api/entities/Member/${idSocio}` });
		assert.equal(res.statusCode, 200);
		assert.equal(res.json().id, idSocio);
	});

	test('il catalogo dei corsi resta leggibile per intero', async () => {
		for (const entita of ['Course', 'Session', 'Event', 'Room', 'Instructor', 'Organization']) {
			const res = await come(tokenSocio, { method: 'GET', url: `/api/entities/${entita}` });
			assert.equal(res.statusCode, 200, `${entita} dovrebbe essere leggibile`);
		}
	});

	test('vede la propria scheda e non quella di un altro', async () => {
		const res = await come(tokenSocio, { method: 'GET', url: '/api/entities/ExercisePlan' });
		assert.equal(res.statusCode, 200);
		const nomi = res.json().map((s) => s.name);
		assert.deepEqual(nomi, ['La scheda del socio']);
	});

	test('i modelli di catalogo restano fuori dal portale', async () => {
		// Un modello non ha member_id: il filtro del portale è un'uguaglianza, e
		// l'uguaglianza con NULL non è mai vera — è così che il catalogo resta dello staff.
		// Se un domani quel filtro imparasse a "lasciar passare i nulli", ogni socio si
		// troverebbe in mano l'intero catalogo della palestra: questo test lo impedisce.
		const elenco = await come(tokenSocio, { method: 'GET', url: '/api/entities/ExercisePlan' });
		assert.deepEqual(elenco.json().filter((s) => s.is_template), []);

		const perId = await come(tokenSocio, { method: 'GET', url: `/api/entities/ExercisePlan/${idModello}` });
		assert.equal(perId.statusCode, 404, 'nemmeno chiedendolo per id');
	});

	test('un socio non scrive le schede: le assegna il personal trainer', async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/ExercisePlan',
			payload: { name: 'Scheda che si è fatto da sé', routines: [] },
		});
		assert.equal(res.statusCode, 403);
	});

	test('il catalogo esercizi si legge ma non si tocca', async () => {
		// Serve a mostrare nome e descrizione degli esercizi della propria scheda.
		const lettura = await come(tokenSocio, { method: 'GET', url: '/api/entities/Exercise' });
		assert.equal(lettura.statusCode, 200);

		const scrittura = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/Exercise',
			payload: { name: 'Esercizio inventato', muscle_group: 'petto' },
		});
		assert.equal(scrittura.statusCode, 403);
	});

	test('le prenotazioni si leggono senza il nome di chi ha prenotato', async () => {
		// Servono tutte, perché è da quelle che si contano i posti liberi: quello che non
		// deve trapelare è l'identità.
		const res = await come(tokenSocio, { method: 'GET', url: '/api/entities/Booking' });
		assert.equal(res.statusCode, 200);
		assert.deepEqual(res.json().filter((b) => 'member_name' in b), []);
	});
});

describe('cosa un socio può scrivere', () => {
	test('genera il proprio codice di accesso', async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/QRAccesso',
			payload: { cliente_id: idSocio, codice: `PROVA-${Date.now()}`, stato: 'attivo' },
		});
		assert.equal(res.statusCode, 201);
		assert.equal(res.json().cliente_id, idSocio);
	});

	test('un codice intestato a un altro socio viene riportato a chi lo chiede', async () => {
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/QRAccesso',
			payload: { cliente_id: idEstraneo, codice: `PROVA-ALTRUI-${Date.now()}`, stato: 'attivo' },
		});
		assert.equal(res.statusCode, 201);
		assert.equal(res.json().cliente_id, idSocio, 'il server deve imporre il proprietario');
	});

	test('non crea né modifica nulla che riguardi la gestione', async () => {
		for (const entita of ['Member', 'Subscription', 'StaffAccount', 'Course']) {
			const res = await come(tokenSocio, { method: 'POST', url: `/api/entities/${entita}`, payload: { nome: 'x' } });
			assert.equal(res.statusCode, 403, `creare ${entita} dovrebbe essere vietato`);
		}
	});

	test("non modifica né cancella l'allenamento di un altro socio", async () => {
		// Il socio deve poter aggiornare i propri allenamenti — è così che il portale
		// chiude una sessione — ma solo i propri. Finché modifica e cancellazione non
		// controllavano l'intestatario, bastava l'identificativo di una riga altrui.
		const [altrui] = await db
			.insert(workoutLogs)
			.values({ memberId: idEstraneo, exerciseName: 'Panca', data: '2026-01-01', repsFatte: 8 })
			.returning();
		idAllenamenti.push(altrui.id);

		const modifica = await come(tokenSocio, {
			method: 'PUT',
			url: `/api/entities/WorkoutLog/${altrui.id}`,
			payload: { reps_fatte: 999 },
		});
		assert.equal(modifica.statusCode, 404);

		const cancellazione = await come(tokenSocio, {
			method: 'DELETE',
			url: `/api/entities/WorkoutLog/${altrui.id}`,
		});
		assert.equal(cancellazione.statusCode, 404);

		const [dopo] = await db.select().from(workoutLogs).where(inArray(workoutLogs.id, [altrui.id]));
		assert.ok(dopo, 'la riga altrui deve esistere ancora');
		assert.equal(dopo.repsFatte, 8, 'e non deve essere stata riscritta');
	});

	test('il proprio allenamento invece si aggiorna', async () => {
		const creato = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/WorkoutLog',
			payload: { exercise_name: 'Squat', data: '2026-01-02', reps_fatte: 5 },
		});
		assert.equal(creato.statusCode, 201);
		idAllenamenti.push(creato.json().id);

		const modifica = await come(tokenSocio, {
			method: 'PUT',
			url: `/api/entities/WorkoutLog/${creato.json().id}`,
			payload: { reps_fatte: 6 },
		});
		assert.equal(modifica.statusCode, 200);
		assert.equal(modifica.json().reps_fatte, 6);
	});

	test('non cancella nemmeno la propria anagrafica', async () => {
		const res = await come(tokenSocio, { method: 'DELETE', url: `/api/entities/Member/${idSocio}` });
		assert.equal(res.statusCode, 403);
	});
});

describe('le rotte fuori da /api/entities', () => {
	// Hanno un controllo proprio, e l'upload non chiedeva nemmeno l'autenticazione.
	for (const [metodo, url] of [
		['POST', '/api/organizations/00000000-0000-0000-0000-000000000000/bootstrap-ruoli'],
		['POST', '/api/uploads'],
	]) {
		test(`${metodo} ${url} è chiusa al socio`, async () => {
			const res = await come(tokenSocio, { method: metodo, url, payload: {} });
			assert.equal(res.statusCode, 403);
		});
	}

	test("l'upload senza autenticazione è rifiutato", async () => {
		const res = await app.inject({ method: 'POST', url: '/api/uploads' });
		assert.equal(res.statusCode, 401);
	});
});

describe('lo staff continua a vedere tutto', () => {
	test('un amministratore legge le aree vietate al socio', async () => {
		for (const entita of ['StaffAccount', 'Collaboratore', 'AuditLog']) {
			const res = await come(tokenAdmin, { method: 'GET', url: `/api/entities/${entita}` });
			assert.equal(res.statusCode, 200, `${entita} dovrebbe essere leggibile da un admin`);
		}
	});

	test('un amministratore vede tutte le anagrafiche, non una sola', async () => {
		const res = await come(tokenAdmin, { method: 'GET', url: '/api/entities/Member' });
		assert.equal(res.statusCode, 200);
		const id = res.json().map((m) => m.id);
		assert.ok(id.includes(idSocio) && id.includes(idEstraneo));
	});
});

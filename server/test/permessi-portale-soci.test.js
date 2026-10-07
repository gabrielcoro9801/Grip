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
import {
	members, staffAccounts, subscriptions, qrAccessi,
	rooms, courses, events, sessions, bookings,
} from '../src/db/schema/index.js';

const PASSWORD = 'prova-permessi-1234';

let app;
let tokenSocio;
let tokenAdmin;
let idSocio;
let idEstraneo;
const idAccount = [];
const idAbbonamenti = [];
const idPrenotazioni = [];
let idSala;
let idCorso;
let idEvento;
let idSessioneCorso;

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
			{ nome: 'Socio', cognome: 'Di Prova', codiceSocio: `PA${String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`, email: `socio.prova.${suffisso}@test.local` },
			{ nome: 'Socio', cognome: 'Estraneo', codiceSocio: `PB${String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`, email: `estraneo.prova.${suffisso}@test.local` },
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

	// Una lezione vera su cui prenotare: senza, non si può provare che il socio prenoti
	// solo per sé, che è il punto.
	const [sala] = await db.insert(rooms).values({ name: `Sala prova ${suffisso}` }).returning();
	idSala = sala.id;
	const [corso] = await db.insert(courses).values({ name: `Corso prova ${suffisso}` }).returning();
	idCorso = corso.id;
	const [evento] = await db
		.insert(events)
		.values({
			courseId: corso.id,
			roomId: sala.id,
			capacity: 20,
			recurrenceType: 'single',
			startDate: '2026-12-01',
			startTime: '10:00',
			endTime: '11:00',
		})
		.returning();
	idEvento = evento.id;
	const [sessione] = await db
		.insert(sessions)
		.values({
			eventId: evento.id,
			date: '2026-12-01',
			startTime: '10:00',
			endTime: '11:00',
			roomId: sala.id,
			capacity: 20,
		})
		.returning();
	idSessioneCorso = sessione.id;

	tokenSocio = await login(account[0].email);
	tokenAdmin = await login(account[1].email);
});

after(async () => {
	// I codici di accesso li generano i test stessi e puntano al socio: vanno via per
	// primi, o l'anagrafica resta agganciata da una chiave esterna.
	if (idSocio) await db.delete(qrAccessi).where(inArray(qrAccessi.clienteId, [idSocio, idEstraneo]));
	if (idPrenotazioni.length) await db.delete(bookings).where(inArray(bookings.id, idPrenotazioni));
	if (idSessioneCorso) await db.delete(sessions).where(inArray(sessions.id, [idSessioneCorso]));
	if (idEvento) await db.delete(events).where(inArray(events.id, [idEvento]));
	if (idCorso) await db.delete(courses).where(inArray(courses.id, [idCorso]));
	if (idSala) await db.delete(rooms).where(inArray(rooms.id, [idSala]));
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

	test('ma non le note che la segreteria scrive su di lui, né da dove è arrivato', async () => {
		await come(tokenAdmin, { method: 'PUT', url: `/api/entities/Member/${idSocio}`, payload: { notes: 'Richiamare dopo le 18' } });
		const staff = await come(tokenAdmin, { method: 'GET', url: `/api/entities/Member/${idSocio}` });
		assert.equal(staff.json().notes, 'Richiamare dopo le 18', 'la segreteria le vede');

		for (const url of [`/api/entities/Member/${idSocio}`, '/api/entities/Member']) {
			const res = await come(tokenSocio, { method: 'GET', url });
			const righe = [res.json()].flat();
			for (const campo of ['notes', 'lead_canale_id', 'lead_data_contatto']) {
				assert.ok(righe.every((r) => !(campo in r)), `${campo} è arrivato al socio da ${url}`);
			}
		}
	});

	test('il catalogo dei corsi resta leggibile per intero', async () => {
		for (const entita of ['Course', 'Session', 'Event', 'Room', 'Instructor', 'Organization']) {
			const res = await come(tokenSocio, { method: 'GET', url: `/api/entities/${entita}` });
			assert.equal(res.statusCode, 200, `${entita} dovrebbe essere leggibile`);
		}
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
	test('il codice di accesso non se lo emette da sé', async () => {
		// Prima poteva, con lo stato che voleva: bastava una richiesta per rifarsi una
		// credenziale «attiva» dopo essere stati revocati, e la revoca durava fino alla
		// visita successiva del socio. Ora il codice lo emette la palestra.
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/QRAccesso',
			payload: { cliente_id: idSocio, codice: `PROVA-${Date.now()}`, stato: 'attivo' },
		});
		assert.equal(res.statusCode, 403);
	});

	test('e nemmeno passando da /bulk', async () => {
		// La creazione singola imponeva l'intestatario, la creazione in blocco no: si
		// aggirava il controllo cambiando indirizzo, non permessi.
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/QRAccesso/bulk',
			payload: [{ cliente_id: idEstraneo, codice: `PROVA-BULK-${Date.now()}`, stato: 'attivo' }],
		});
		assert.equal(res.statusCode, 403);
	});

	test('non crea né modifica nulla che riguardi la gestione', async () => {
		for (const entita of ['Member', 'Subscription', 'StaffAccount', 'Course']) {
			const res = await come(tokenSocio, { method: 'POST', url: `/api/entities/${entita}`, payload: { nome: 'x' } });
			assert.equal(res.statusCode, 403, `creare ${entita} dovrebbe essere vietato`);
		}
	});

	test('prenota un corso, e la prenotazione è sua', async () => {
		// Prenotare era semplicemente impossibile: il portale mostrava il pulsante e il
		// server rispondeva 403. Ora si passa da /api/prenotazioni, che è anche il posto
		// dove si contano i posti — vedi prenotazioni.test.js per quelle regole.
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/prenotazioni',
			// L'intestatario lo impone il server: qui si chiede di prenotare per un altro.
			payload: { session_id: idSessioneCorso, member_id: idEstraneo },
		});
		assert.equal(res.statusCode, 201);
		assert.equal(res.json().booking.member_id, idSocio, 'non si prenota a nome di un altro');
		idPrenotazioni.push(res.json().booking.id);
	});

	test("l'endpoint generico non è più una scorciatoia per prenotare", async () => {
		// Da lì la riga arrivava con lo stato già deciso dal browser, e veniva scritta
		// senza contare i posti: bastava chiedere 'confirmed' su una lezione piena.
		const res = await come(tokenSocio, {
			method: 'POST',
			url: '/api/entities/Booking',
			payload: { session_id: idSessioneCorso, member_id: idSocio, status: 'confirmed' },
		});
		assert.equal(res.statusCode, 403);
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
		for (const entita of ['StaffAccount', 'AuditLog']) {
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

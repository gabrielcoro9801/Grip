// Le sale: chi comanda quando una sala si chiude.
//
// La regola è che comandano gli eventi. Una sala non si sospende sotto le lezioni già fissate,
// perché i soci ci sono già prenotati sopra: prima si tolgono quelle, poi si chiude la stanza.
// E al contrario, dentro il periodo di sospensione non si programma niente di nuovo. Le due
// metà devono valere insieme, altrimenti la seconda si aggira aspettando un minuto.
//
// Girano contro le rotte vere: la regola sta nel server, e nel server va verificata.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { staffAccounts, rooms, courses, events, sessions } from '../src/db/schema/index.js';

const PASSWORD = 'prova-sale-1234';

let app;
let token;
let idSala;
let idCorso;
const daPulire = { eventi: [], lezioni: [], sale: [] };
let emailStaff;

const come = (opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });

const creaSala = (payload) => come({ method: 'POST', url: '/api/entities/Room', payload });
const modificaSala = (id, payload) => come({ method: 'PUT', url: `/api/entities/Room/${id}`, payload });

/** Una lezione il `data` nella sala indicata, con l'evento che la tiene. */
async function fissaLezione(data, idStanza = idSala, stato = 'active') {
	const [evento] = await db
		.insert(events)
		.values({
			courseId: idCorso, roomId: idStanza, capacity: 10, recurrenceType: 'single',
			startDate: data, startTime: '10:00', endTime: '11:00',
		})
		.returning();
	const [lezione] = await db
		.insert(sessions)
		.values({ eventId: evento.id, date: data, startTime: '10:00', endTime: '11:00', roomId: idStanza, capacity: 10, status: stato })
		.returning();
	daPulire.eventi.push(evento.id);
	daPulire.lezioni.push(lezione.id);
	return { evento, lezione };
}

async function svuotaCalendario() {
	if (daPulire.lezioni.length) await db.delete(sessions).where(inArray(sessions.id, daPulire.lezioni));
	if (daPulire.eventi.length) await db.delete(events).where(inArray(events.id, daPulire.eventi));
	daPulire.lezioni = [];
	daPulire.eventi = [];
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	emailStaff = `rec.sale.${suffisso}@test.local`;
	await db.insert(staffAccounts).values({
		nome: 'Reception Sale', email: emailStaff, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception',
	});
	const accesso = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: emailStaff, password: PASSWORD } });
	assert.equal(accesso.statusCode, 200, `login fallito: ${accesso.body}`);
	token = accesso.json().token;

	const [corso] = await db.insert(courses).values({ name: `Corso sale ${suffisso}` }).returning();
	idCorso = corso.id;

	const res = await creaSala({ name: `Sala prova ${suffisso}` });
	assert.equal(res.statusCode, 201, res.body);
	idSala = res.json().id;
	daPulire.sale.push(idSala);
});

after(async () => {
	await svuotaCalendario();
	if (idCorso) await db.delete(courses).where(inArray(courses.id, [idCorso]));
	if (daPulire.sale.length) await db.delete(rooms).where(inArray(rooms.id, daPulire.sale));
	if (emailStaff) await db.delete(staffAccounts).where(inArray(staffAccounts.email, [emailStaff]));
	await app.close();
	await pool.end();
});

describe('una sala nasce attiva e si modifica tutta', () => {
	test('senza capienza e senza stato da scegliere', async () => {
		const sala = (await creaSala({ name: 'Sala senza capienza', capacity: 40 })).json();
		daPulire.sale.push(sala.id);
		assert.equal(sala.stato, 'attivo');
		assert.equal(sala.capacity, undefined, 'la capienza della sala non esiste più');
	});

	test('il nome si corregge: gli eventi seguono l’id, non come si chiama', async () => {
		const res = await modificaSala(idSala, { name: 'Sala Pesi', description: 'Tappetini nell’armadio' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().name, 'Sala Pesi');
		assert.equal(res.json().description, 'Tappetini nell’armadio');
	});

	test('un nome vuoto non passa, e le note stanno in 140 caratteri', async () => {
		assert.equal((await modificaSala(idSala, { name: '   ' })).statusCode, 400);
		const lunghe = await modificaSala(idSala, { description: 'a'.repeat(141) });
		assert.equal(lunghe.statusCode, 400);
		assert.match(lunghe.json().error, /140/);
	});
});

describe('sospendere è sempre un periodo', () => {
	test('sospesa senza date non si salva', async () => {
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: null, sospesa_al: null });
		assert.equal(res.statusCode, 400, res.body);
	});

	test('la fine non può precedere l’inizio', async () => {
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-15', sospesa_al: '2026-10-01' });
		assert.equal(res.statusCode, 400, res.body);
	});

	test('tornare attiva cancella il periodo', async () => {
		assert.equal((await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' })).statusCode, 200);
		const riattivata = (await modificaSala(idSala, { stato: 'attivo' })).json();
		assert.equal(riattivata.stato, 'attivo');
		assert.equal(riattivata.sospesa_dal, null);
		assert.equal(riattivata.sospesa_al, null);
	});
});

describe('comandano gli eventi', () => {
	test('una sala con lezioni in quel periodo non si sospende', async () => {
		await svuotaCalendario();
		await fissaLezione('2026-10-07');
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /non si può sospendere/);
		assert.match(res.json().error, /07\/10\/2026/);
	});

	test('le lezioni fuori dal periodo non bloccano niente', async () => {
		await svuotaCalendario();
		await fissaLezione('2026-09-30');
		await fissaLezione('2026-10-16');
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 200, res.body);
	});

	test('una lezione cancellata non tiene aperta la sala', async () => {
		await svuotaCalendario();
		await modificaSala(idSala, { stato: 'attivo' });
		await fissaLezione('2026-10-07', idSala, 'cancelled');
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 200, res.body);
	});

	test('tolte le lezioni, la sospensione passa', async () => {
		await svuotaCalendario();
		await modificaSala(idSala, { stato: 'attivo' });
		await fissaLezione('2026-10-07');
		assert.equal((await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' })).statusCode, 400);
		await svuotaCalendario();
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 200, res.body);
	});
});

describe('in una sala sospesa non si programma', () => {
	const evento = (extra) => come({
		method: 'POST',
		url: '/api/entities/Event',
		payload: {
			course_id: idCorso, room_id: idSala, capacity: 10, recurrence_type: 'single',
			start_date: '2026-10-07', start_time: '10:00', end_time: '11:00', ...extra,
		},
	});

	test('un evento dentro il periodo viene rifiutato', async () => {
		await svuotaCalendario();
		assert.equal((await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' })).statusCode, 200);
		const res = await evento();
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /è sospesa dal 01\/10\/2026 al 15\/10\/2026/);
	});

	test('un evento fuori dal periodo passa', async () => {
		const res = await evento({ start_date: '2026-10-16' });
		assert.equal(res.statusCode, 201, res.body);
		daPulire.eventi.push(res.json().id);
	});

	test('un settimanale che ci finisce dentro viene rifiutato', async () => {
		const res = await evento({
			recurrence_type: 'weekly', days_of_week: ['Monday'], start_date: '2026-09-01',
			end_condition: 'by_date', end_date: '2026-10-05',
		});
		assert.equal(res.statusCode, 400, res.body);
	});

	test('un settimanale a occorrenze non sa dove finisce, e la sala chiusa se la tiene buona', async () => {
		// Senza data di fine il server non può sapere quali giorni occuperà: meglio un rifiuto
		// da spiegare che una lezione generata dentro una stanza chiusa.
		const res = await evento({
			recurrence_type: 'weekly', days_of_week: ['Monday'], start_date: '2026-09-01',
			end_condition: 'by_count', occurrence_count: 8,
		});
		assert.equal(res.statusCode, 400, res.body);
	});

	test('spostare una singola lezione in una sala sospesa viene rifiutato', async () => {
		await svuotaCalendario();
		const altra = (await creaSala({ name: `Sala vicina ${Date.now()}` })).json();
		daPulire.sale.push(altra.id);
		const { lezione } = await fissaLezione('2026-10-07', altra.id);
		const res = await come({ method: 'PUT', url: `/api/entities/Session/${lezione.id}`, payload: { room_id: idSala } });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /sospesa/);
	});
});

// L'opzione «Istruttore» (azione `suoi`): chi ce l'ha vede e tocca solo ciò che riguarda i corsi che
// tiene. Gli istruttori sono gli account con la spunta: l'elenco li prende da lì.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, courses, events, sessions, rooms } from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { categoriaDiProva, togliCategorieDiProva } from './categoriaDiProva.js';

const PASSWORD = 'prova-istruttore-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const domani = spostaGiorni(oggiIso(), 1);

let app;
const token = {};
const id = { account: [], corsi: [], eventi: [], lezioni: [], soci: [], sala: null };
const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [socio] = await db.insert(members).values({ nome: 'Socio', cognome: `Opzione${lettere}`, codiceSocio: `OP${lettere}` }).returning();
	id.soci.push(socio.id);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Mia', email: `opz.mia.${t}@test.local`, passwordHash, ruolo: 'istruttore', istruttore: true },
		{ nome: 'Altro', email: `opz.altro.${t}@test.local`, passwordHash, ruolo: 'istruttore', istruttore: true },
		{ nome: 'Reception Opzione', email: `opz.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
	]).returning();
	id.account = account.map((a) => a.id);
	for (const [chi, a] of [['mia', account[0]], ['altro', account[1]], ['reception', account[2]]]) {
		token[chi] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: PASSWORD } })).json().token;
	}

	const [sala] = await db.insert(rooms).values({ name: `Sala opzione ${t}` }).returning();
	id.sala = sala.id;
	const corsi = await db.insert(courses).values([
		{ categoryId: await categoriaDiProva(), name: `Pilates ${t}`, instructorId: id.account[0] },
		{ categoryId: await categoriaDiProva(), name: `Boxe ${t}`, instructorId: id.account[1] },
	]).returning();
	id.corsi = corsi.map((c) => c.id);
	for (const corso of corsi) {
		const [evento] = await db.insert(events).values({
			courseId: corso.id, roomId: id.sala, capacity: 10, recurrenceType: 'custom', customDates: [domani],
			startDate: domani, startTime: '10:00', endTime: '11:00',
		}).returning();
		const [lezione] = await db.insert(sessions).values({
			eventId: evento.id, date: domani, startTime: '10:00', endTime: '11:00', roomId: id.sala, capacity: 10,
		}).returning();
		id.eventi.push(evento.id);
		id.lezioni.push(lezione.id);
	}
});

after(async () => {
	await db.delete(sessions).where(inArray(sessions.id, id.lezioni));
	await db.delete(events).where(inArray(events.id, id.eventi));
	await db.delete(courses).where(inArray(courses.id, id.corsi));
	await togliCategorieDiProva();
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, id.soci));
	await db.delete(rooms).where(eq(rooms.id, id.sala));
	await app.close();
	await pool.end();
});

describe("l'opzione «Istruttore»", () => {
	test("l'elenco degli istruttori è quello degli account con la spunta", async () => {
		const res = await come('reception', 'GET', '/api/istruttori');
		assert.equal(res.statusCode, 200);
		const nomi = res.json().elenco.map((i) => i.full_name);
		assert.ok(nomi.includes('Mia') && nomi.includes('Altro'));
		assert.ok(!nomi.includes('Reception Opzione'));
	});

	test("l'istruttore vede solo le lezioni dei suoi corsi", async () => {
		const res = await come('mia', 'GET', `/api/calendario/lezioni?dal=${domani}&al=${domani}`);
		assert.equal(res.statusCode, 200);
		const lezioni = res.json().lezioni;
		assert.ok(lezioni.some((l) => l.id === id.lezioni[0]));
		assert.ok(!lezioni.some((l) => l.id === id.lezioni[1]));
		assert.ok(lezioni.every((l) => l.instructor_id === id.account[0]));
	});

	test("una lezione altrui non si apre", async () => {
		assert.equal((await come('mia', 'GET', `/api/calendario/lezioni/${id.lezioni[1]}`)).statusCode, 404);
		assert.equal((await come('mia', 'GET', `/api/calendario/lezioni/${id.lezioni[0]}`)).statusCode, 200);
	});

	test("non prenota e non disdice alle lezioni altrui", async () => {
		const res = await come('mia', 'POST', '/api/prenotazioni', { session_id: id.lezioni[1], member_id: id.soci[0] });
		assert.equal(res.statusCode, 403);
	});

	test("non intesta un corso a un altro istruttore", async () => {
		const res = await come('mia', 'POST', '/api/entities/Course', { name: `Altrui ${t}`, category_id: await categoriaDiProva(), instructor_id: id.account[1] });
		assert.equal(res.statusCode, 403);
	});

	test("un corso non si assegna a chi non ha la spunta «Istruttore»", async () => {
		const res = await come('reception', 'POST', '/api/entities/Course', { name: `Senza spunta ${t}`, category_id: await categoriaDiProva(), instructor_id: id.account[2] });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /spunta/);
	});
});

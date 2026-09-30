// Vincoli che prima valevano solo perché il codice stava attento (migrazione 0039).
//
// Un account del portale per socio, una prenotazione viva per socio e lezione, un codice
// d'accesso attivo per socio. E quando si elimina qualcosa che altri dati citano ancora, il
// messaggio dice questo — non «riferimento a un record inesistente», che è il caso opposto.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, qrAccessi, bookings, sessions, events, courses, rooms,
} from '../src/db/schema/index.js';

const PASSWORD = 'prova-vincoli-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
let app;
let token;
let idSocio;
const idAccount = [];
const pulizia = { sessione: null, evento: null, corso: null, sala: null };

/** Il codice di Postgres dentro l'errore di Drizzle. */
async function codiceDiErrore(promessa) {
	try {
		await promessa;
		return null;
	} catch (err) {
		for (let e = err; e; e = e.cause) if (e.code) return e.code;
		return 'sconosciuto';
	}
}

const come = (opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const [socio] = await db.insert(members).values({ nome: 'Socio', cognome: 'Vincoli', codiceSocio: `VI${lettere}` }).returning();
	idSocio = socio.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const [admin] = await db.insert(staffAccounts)
		.values({ nome: 'Admin Vincoli', email: `vincoli.admin.${suffisso}@test.local`, passwordHash, ruolo: 'admin' })
		.returning();
	idAccount.push(admin.id);
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: admin.email, password: PASSWORD } });
	token = res.json().token;
});

after(async () => {
	await db.delete(qrAccessi).where(eq(qrAccessi.clienteId, idSocio));
	await db.delete(bookings).where(eq(bookings.memberId, idSocio));
	if (pulizia.sessione) await db.delete(sessions).where(eq(sessions.id, pulizia.sessione));
	if (pulizia.evento) await db.delete(events).where(eq(events.id, pulizia.evento));
	if (pulizia.corso) await db.delete(courses).where(eq(courses.id, pulizia.corso));
	if (pulizia.sala) await db.delete(rooms).where(eq(rooms.id, pulizia.sala));
	await db.delete(staffAccounts).where(eq(staffAccounts.linkedMemberId, idSocio));
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await db.delete(members).where(eq(members.id, idSocio));
	await app.close();
	await pool.end();
});

describe('un account del portale per socio', () => {
	test('il secondo account sullo stesso socio è rifiutato', async () => {
		const passwordHash = await bcrypt.hash(PASSWORD, 4);
		await db.insert(staffAccounts).values({ nome: 'Portale 1', email: `vincoli.p1.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: idSocio });
		const codice = await codiceDiErrore(db.insert(staffAccounts).values({ nome: 'Portale 2', email: `vincoli.p2.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: idSocio }));
		assert.equal(codice, '23505');
	});

	test('un account non si collega a un socio che non esiste', async () => {
		const passwordHash = await bcrypt.hash(PASSWORD, 4);
		const codice = await codiceDiErrore(db.insert(staffAccounts).values({
			nome: 'Portale orfano', email: `vincoli.orfano.${suffisso}@test.local`, passwordHash, ruolo: 'member',
			linkedMemberId: '00000000-0000-4000-8000-000000000000',
		}));
		assert.equal(codice, '23503');
	});
});

describe("un codice d'accesso attivo per socio", () => {
	test('il secondo codice attivo è rifiutato con un messaggio che dice cosa fare', async () => {
		const primo = await come({ method: 'POST', url: '/api/entities/QRAccesso', payload: { cliente_id: idSocio, codice: `GRIP-V1-${suffisso}`, stato: 'attivo' } });
		assert.equal(primo.statusCode, 201, primo.body);

		const secondo = await come({ method: 'POST', url: '/api/entities/QRAccesso', payload: { cliente_id: idSocio, codice: `GRIP-V2-${suffisso}`, stato: 'attivo' } });
		assert.equal(secondo.statusCode, 400, secondo.body);
		assert.match(secondo.json().error, /già un codice d'accesso attivo/);
	});

	test('uno revocato accanto a uno attivo va bene', async () => {
		const res = await come({ method: 'POST', url: '/api/entities/QRAccesso', payload: { cliente_id: idSocio, codice: `GRIP-V3-${suffisso}`, stato: 'revocato' } });
		assert.equal(res.statusCode, 201, res.body);
	});
});

describe('una prenotazione viva per socio e lezione', () => {
	test('la seconda è rifiutata, una annullata accanto no', async () => {
		const [sala] = await db.insert(rooms).values({ name: `Sala vincoli ${suffisso}` }).returning();
		pulizia.sala = sala.id;
		const [corso] = await db.insert(courses).values({ name: `Corso vincoli ${suffisso}` }).returning();
		pulizia.corso = corso.id;
		const [evento] = await db.insert(events).values({
			courseId: corso.id, roomId: sala.id, capacity: 10, recurrenceType: 'single',
			startDate: '2099-01-05', startTime: '10:00', endTime: '11:00',
		}).returning();
		pulizia.evento = evento.id;
		const [lezione] = await db.insert(sessions).values({
			eventId: evento.id, date: '2099-01-05', startTime: '10:00', endTime: '11:00', roomId: sala.id, capacity: 10,
		}).returning();
		pulizia.sessione = lezione.id;

		await db.insert(bookings).values({ sessionId: lezione.id, memberId: idSocio, status: 'cancelled' });
		await db.insert(bookings).values({ sessionId: lezione.id, memberId: idSocio, status: 'confirmed' });
		const codice = await codiceDiErrore(db.insert(bookings).values({ sessionId: lezione.id, memberId: idSocio, status: 'waitlisted' }));
		assert.equal(codice, '23505');
	});
});

describe('eliminare qualcosa che altri dati citano ancora', () => {
	test('il messaggio dice che è collegato, e a cosa', async () => {
		const res = await come({ method: 'DELETE', url: `/api/entities/Member/${idSocio}` });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /ancora collegato ad altri dati/);
		assert.doesNotMatch(res.json().error, /inesistente/);
	});
});

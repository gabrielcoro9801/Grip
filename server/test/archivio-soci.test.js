// Un socio che lascia la palestra si archivia; istruttori e corsi con uno storico si disattivano.
//
// Archiviato non vuol dire cancellato: scheda e storico restano, e lo si riattiva. Ma da
// archiviato non compra abbonamenti, non prenota, portale e QR non lo fanno entrare, e le sue
// prenotazioni future si liberano per chi è in lista d'attesa.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, qrAccessi, bookings, sessions, events, courses, rooms, instructors, subscriptions, plans, auditLogs,
} from '../src/db/schema/index.js';
import { codiceDinamico } from '../src/lib/qrDinamico.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-archivio-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const emailSocio = `archivio.socio.${suffisso}@test.local`;
const SEME = `GRIP-ARCH-${lettere}`;

let app;
let tokenAdmin;
let tokenSocio;
const id = { soci: [], account: [], tipo: null, sala: null, istruttore: null, corso: null, evento: null, lezione: null };

const come = (token, opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });
const admin = (opzioni) => come(tokenAdmin, opzioni);
const login = (email) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const soci = await db.insert(members).values([
		{ nome: 'Chi', cognome: 'Lascia', codiceSocio: `AR${lettere}`, email: emailSocio },
		{ nome: 'Chi', cognome: 'Aspetta', codiceSocio: `AS${lettere}` },
	]).returning();
	id.soci = soci.map((s) => s.id);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Admin Archivio', email: `archivio.admin.${suffisso}@test.local`, passwordHash, ruolo: 'admin' },
		{ nome: 'Portale Archivio', email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: id.soci[0] },
	]).returning();
	id.account = account.map((a) => a.id);
	tokenAdmin = (await login(account[0].email)).json().token;
	tokenSocio = (await login(emailSocio)).json().token;

	await db.insert(qrAccessi).values({ clienteId: id.soci[0], codice: SEME, stato: 'attivo' });
	await db.insert(subscriptions).values(id.soci.map((s) => ({ memberId: s, planName: 'Prova', startDate: '2026-01-01', endDate: '2099-12-31' })));
	const [tipo] = await db.insert(plans).values({ name: `Archivio ${suffisso}`, price: 30, durataValore: 1, durataUnita: 'mesi' }).returning();
	id.tipo = tipo.id;

	const [sala] = await db.insert(rooms).values({ name: `Sala archivio ${suffisso}` }).returning();
	id.sala = sala.id;
	const [istruttore] = await db.insert(instructors).values({ fullName: `Istruttore archivio ${suffisso}` }).returning();
	id.istruttore = istruttore.id;
	const [corso] = await db.insert(courses).values({ name: `Corso archivio ${suffisso}`, instructorId: istruttore.id }).returning();
	id.corso = corso.id;
	const domani = spostaGiorni(oggiIso(), 1);
	const [evento] = await db.insert(events).values({
		courseId: corso.id, roomId: sala.id, capacity: 1, recurrenceType: 'single', startDate: domani, startTime: '10:00', endTime: '11:00',
	}).returning();
	id.evento = evento.id;
	const [lezione] = await db.insert(sessions).values({
		eventId: evento.id, date: domani, startTime: '10:00', endTime: '11:00', roomId: sala.id, capacity: 1,
	}).returning();
	id.lezione = lezione.id;

	// Un posto solo: il socio che se ne andrà lo occupa, l'altro è in lista d'attesa.
	for (const socio of id.soci) {
		const res = await admin({ method: 'POST', url: '/api/prenotazioni', payload: { session_id: lezione.id, member_id: socio } });
		assert.equal(res.statusCode, 201, res.body);
	}
});

after(async () => {
	await db.delete(bookings).where(eq(bookings.sessionId, id.lezione));
	await db.delete(sessions).where(eq(sessions.eventId, id.evento));
	await db.delete(events).where(eq(events.courseId, id.corso));
	await db.delete(courses).where(inArray(courses.instructorId, [id.istruttore]));
	await db.delete(instructors).where(eq(instructors.id, id.istruttore));
	await db.delete(rooms).where(eq(rooms.id, id.sala));
	await db.delete(qrAccessi).where(inArray(qrAccessi.clienteId, id.soci));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
	await db.delete(plans).where(eq(plans.id, id.tipo));
	await db.delete(auditLogs).where(inArray(auditLogs.entitaId, id.soci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, id.soci));
	await app.close();
	await pool.end();
});

describe('archiviare un socio', () => {
	test("l'endpoint generico non archivia: lo fanno le rotte dedicate", async () => {
		const res = await admin({ method: 'PUT', url: `/api/entities/Member/${id.soci[0]}`, payload: { archiviato_il: '2026-01-01' } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().archiviato_il, null);
	});

	test('si archivia, e la sua prenotazione futura passa a chi aspettava', async () => {
		const res = await admin({ method: 'POST', url: `/api/soci/${id.soci[0]}/archivia` });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().socio.archiviato_il, oggiIso());
		assert.equal(res.json().prenotazioni_disdette, 1);

		const righe = await db.select().from(bookings).where(eq(bookings.sessionId, id.lezione));
		assert.equal(righe.find((b) => b.memberId === id.soci[0]).status, 'cancelled');
		assert.equal(righe.find((b) => b.memberId === id.soci[1]).status, 'confirmed', 'chi era in lista è promosso');
	});

	test('portale: la sessione aperta non vale più, e non si rientra', async () => {
		assert.equal((await come(tokenSocio, { method: 'GET', url: '/api/member/v1/profilo' })).statusCode, 401);
		assert.equal((await login(emailSocio)).statusCode, 401);
	});

	test('QR: alla porta non passa, e il codice del minuto non si calcola', async () => {
		const verifica = await admin({ method: 'POST', url: '/api/qr/verifica', payload: { codice: codiceDinamico(SEME) } });
		assert.equal(verifica.json().valido, false);
		const codice = await admin({ method: 'GET', url: `/api/qr/codice?cliente_id=${id.soci[0]}` });
		assert.equal(codice.json().codice, null);
		assert.equal(codice.json().stato, 'archiviato');
	});

	test('non compra abbonamenti e non prenota', async () => {
		const vendita = await admin({ method: 'POST', url: '/api/entities/Subscription', payload: { member_id: id.soci[0], plan_id: id.tipo } });
		assert.equal(vendita.statusCode, 400);
		assert.match(vendita.json().error, /archiviato/);
		const prenotazione = await admin({ method: 'POST', url: '/api/prenotazioni', payload: { session_id: id.lezione, member_id: id.soci[0] } });
		assert.equal(prenotazione.statusCode, 400);
		assert.match(prenotazione.json().error, /archiviato/);
	});

	test('riattivato, rientra nel portale con la sua password', async () => {
		const res = await admin({ method: 'POST', url: `/api/soci/${id.soci[0]}/riattiva` });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().socio.archiviato_il, null);
		assert.equal((await login(emailSocio)).statusCode, 200);
		const verifica = await admin({ method: 'POST', url: '/api/qr/verifica', payload: { codice: codiceDinamico(SEME) } });
		assert.equal(verifica.json().valido, true);
	});

	test('senza il permesso di modificare i soci non si archivia', async () => {
		const res = await come(tokenSocio, { method: 'POST', url: `/api/soci/${id.soci[0]}/archivia` });
		assert.equal(res.statusCode, 403);
	});
});

describe('istruttori e corsi disattivati', () => {
	test('a un istruttore disattivato non si assegna un corso', async () => {
		assert.equal((await admin({ method: 'PUT', url: `/api/entities/Instructor/${id.istruttore}`, payload: { attivo: false } })).statusCode, 200);
		const res = await admin({ method: 'POST', url: '/api/entities/Course', payload: { name: `Nuovo ${suffisso}`, instructor_id: id.istruttore } });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /disattivato/);
		// Il corso che già tiene resta com'è, e si può ancora modificare.
		assert.equal((await admin({ method: 'PUT', url: `/api/entities/Course/${id.corso}`, payload: { description: 'ok' } })).statusCode, 200);
		await admin({ method: 'PUT', url: `/api/entities/Instructor/${id.istruttore}`, payload: { attivo: true } });
	});

	test('un corso disattivato non si programma più', async () => {
		assert.equal((await admin({ method: 'PUT', url: `/api/entities/Course/${id.corso}`, payload: { attivo: false } })).statusCode, 200);
		const res = await admin({
			method: 'POST', url: '/api/entities/Event',
			payload: { course_id: id.corso, room_id: id.sala, capacity: 5, recurrence_type: 'single', start_date: '2099-02-02', start_time: '10:00', end_time: '11:00' },
		});
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /disattivato/);
	});
});

describe('i collaboratori', () => {
	test('nascono con nome, cognome e tipo di rapporto; si eliminano finché nessun account li cita', async () => {
		const senzaTipo = await admin({ method: 'POST', url: '/api/entities/Collaboratore', payload: { nome: 'Anna', cognome: 'Prova' } });
		assert.equal(senzaTipo.statusCode, 400);
		assert.match(senzaTipo.json().error, /tipo di rapporto/);

		const creato = await admin({ method: 'POST', url: '/api/entities/Collaboratore', payload: { nome: ' Anna ', cognome: 'Prova', tipo_rapporto: 'collaboratore_sportivo', email: '' } });
		assert.equal(creato.statusCode, 201, creato.body);
		assert.equal(creato.json().nome, 'Anna');
		assert.equal(creato.json().email, null);
		const idCollaboratore = creato.json().id;

		await db.update(staffAccounts).set({ linkedCollaboratoreId: idCollaboratore }).where(eq(staffAccounts.id, id.account[0]));
		const bloccato = await admin({ method: 'DELETE', url: `/api/entities/Collaboratore/${idCollaboratore}` });
		assert.equal(bloccato.statusCode, 400, bloccato.body);
		assert.match(bloccato.json().error, /ancora collegato ad altri dati \(un account\)/);

		await db.update(staffAccounts).set({ linkedCollaboratoreId: null }).where(eq(staffAccounts.id, id.account[0]));
		assert.equal((await admin({ method: 'DELETE', url: `/api/entities/Collaboratore/${idCollaboratore}` })).statusCode, 200);
	});
});

// La sospensione dell'abbonamento contro le rotte vere: la scadenza slitta senza riscriversi, nei
// giorni fermi non si prenota né si entra, le prenotazioni di quei giorni si liberano, il motore
// dice "sospeso" e non "assente", e la reception può far riprendere prima.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, sospensioni, attivita, rooms, courses, events, sessions, bookings, auditLogs,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-sospensioni-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);

let app;
const token = {};
const id = { socio: null, persona: null, altro: null, account: [], sala: null, corso: null, evento: null, lezioni: [] };
const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const [socio, altro] = await db.insert(members).values([
		{ nome: 'Fermo', cognome: `Sospeso${lettere}`, codiceSocio: `SS${lettere}` },
		{ nome: 'Altro', cognome: `Sospeso${lettere}`, codiceSocio: `ST${lettere}` },
	]).returning();
	id.socio = socio.id; id.persona = socio.personaId; id.altro = altro.id;
	// Trenta giorni da ieri: scade fra 28 giorni.
	await db.insert(subscriptions).values([
		{ memberId: socio.id, planName: 'Mensile', startDate: fra(-1), endDate: fra(28) },
		{ memberId: altro.id, planName: 'Mensile', startDate: fra(-1), endDate: fra(28) },
	]);
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Sosp', email: `sosp.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Istruttore Sosp', email: `sosp.istruttore.${t}@test.local`, passwordHash, ruolo: 'istruttore' },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.istruttore = await login(account[1].email);

	// Una lezione dentro la sospensione che verrà (fra 3 giorni) e una dopo (fra 20), prenotate.
	const [sala] = await db.insert(rooms).values({ name: `Sala sosp ${t}` }).returning();
	const [corso] = await db.insert(courses).values({ name: `Corso sosp ${t}` }).returning();
	const [evento] = await db.insert(events).values({
		courseId: corso.id, roomId: sala.id, capacity: 5, recurrenceType: 'single', startDate: fra(3), startTime: '18:00', endTime: '19:00',
	}).returning();
	const lezioni = await db.insert(sessions).values([fra(3), fra(20), fra(5)].map((date) => ({
		eventId: evento.id, date, startTime: '18:00', endTime: '19:00', roomId: sala.id, capacity: 5,
	}))).returning();
	Object.assign(id, { sala: sala.id, corso: corso.id, evento: evento.id, lezioni: lezioni.map((l) => l.id) });
	for (const l of lezioni.slice(0, 2)) {
		const res = await come('reception', 'POST', '/api/prenotazioni', { session_id: l.id, member_id: socio.id });
		assert.equal(res.statusCode, 201, res.body);
	}
});

after(async () => {
	await db.delete(bookings).where(inArray(bookings.sessionId, id.lezioni));
	await db.delete(sessions).where(eq(sessions.eventId, id.evento));
	await db.delete(events).where(eq(events.id, id.evento));
	await db.delete(courses).where(eq(courses.id, id.corso));
	await db.delete(rooms).where(eq(rooms.id, id.sala));
	await db.delete(attivita).where(eq(attivita.personaId, id.persona));
	await db.delete(sospensioni).where(inArray(sospensioni.memberId, [id.socio, id.altro]));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, [id.socio, id.altro]));
	await db.delete(auditLogs).where(inArray(auditLogs.entitaId, [id.socio, id.altro]));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, [id.socio, id.altro]));
	await app.close();
	await pool.end();
});

describe('sospendere un abbonamento', () => {
	test('non si sospende nel passato, né senza abbonamento, né chi non gestisce i soci', async () => {
		assert.equal((await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: fra(-1), riprende_il: fra(5) })).statusCode, 400);
		assert.equal((await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: fra(40), riprende_il: fra(50) })).statusCode, 400);
		assert.equal((await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: fra(2), riprende_il: fra(2) })).statusCode, 400);
		assert.equal((await come('istruttore', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: fra(2), riprende_il: fra(16) })).statusCode, 403);
	});

	test('14 giorni: la prenotazione di quei giorni si libera, la scadenza slitta di 14', async () => {
		const res = await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: fra(2), riprende_il: fra(16), nota: 'Viaggio' });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().prenotazioni_disdette, 1);
		const [dentro, dopo] = await Promise.all(id.lezioni.slice(0, 2).map((l) => db.select().from(bookings).where(eq(bookings.sessionId, l))));
		assert.equal(dentro[0].status, 'cancelled');
		assert.equal(dopo[0].status, 'confirmed');

		// Nel database la scadenza resta quella venduta; chi la legge riceve quella allungata.
		const [riga] = await db.select().from(subscriptions).where(eq(subscriptions.memberId, id.socio));
		assert.equal(riga.endDate, fra(28));
		const lette = (await come('reception', 'GET', `/api/entities/Subscription?member_id=${id.socio}`)).json();
		assert.equal(lette[0].end_date, fra(42));
		assert.equal(lette[0].giorni_sospesi, 14);

		const diario = await db.select().from(attivita).where(eq(attivita.personaId, id.persona));
		assert.ok(diario.some((a) => a.tipo === 'sospensione' && a.esito === `${fra(2)}/${fra(15)}` && a.nota === 'Viaggio'));
	});

	test('non si accavalla a un\'altra', async () => {
		assert.equal((await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: fra(10), riprende_il: fra(20) })).statusCode, 409);
	});

	test('nei giorni fermi non si prenota; dopo la ripresa sì', async () => {
		const ferma = await come('reception', 'POST', '/api/prenotazioni', { session_id: id.lezioni[2], member_id: id.socio });
		assert.equal(ferma.statusCode, 400);
		assert.match(ferma.json().error, /sospeso/);
	});

	test('il motore lo vede sospeso, con la scadenza allungata; l\'elenco filtra per fase', async () => {
		const [p] = (await come('reception', 'GET', `/api/segnali?persona=${id.persona}`)).json().persone;
		// Oggi non è ancora fermo: lo sarà da dopodomani.
		assert.equal(p.scadenza, fra(42));
		assert.notEqual(p.fase, 'sospeso');
	});

	test('termina prima di cominciare: si cancella, e la scadenza torna quella venduta', async () => {
		const [s] = await db.select().from(sospensioni).where(eq(sospensioni.memberId, id.socio));
		const res = await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni/${s.id}/termina`, {});
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().sospensione, null);
		const lette = (await come('reception', 'GET', `/api/entities/Subscription?member_id=${id.socio}`)).json();
		assert.equal(lette[0].end_date, fra(28));
	});

	test('in corso da oggi: fase sospeso, semaforo rosso "sospeso", non assente; poi riprende prima', async () => {
		const res = await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni`, { dal: oggi, riprende_il: fra(14) });
		assert.equal(res.statusCode, 201, res.body);
		const [p] = (await come('reception', 'GET', `/api/segnali?persona=${id.persona}`)).json().persone;
		assert.equal(p.fase, 'sospeso');
		assert.deepEqual(p.da_fare, []);
		assert.equal(p.scadenza, fra(42));
		assert.deepEqual(p.sospensione, { dal: oggi, al: fra(13) });

		const verifica = (await come('reception', 'POST', '/api/ingressi/verifica', { member_id: id.socio })).json();
		assert.equal(verifica.semaforo, 'rosso');
		assert.equal(verifica.avvisi[0].codice, 'abbonamento_sospeso');

		const [s] = await db.select().from(sospensioni).where(eq(sospensioni.memberId, id.socio));
		const tardi = await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni/${s.id}/termina`, { riprende_il: fra(30) });
		assert.equal(tardi.statusCode, 400, 'si può solo anticipare');
		const prima = await come('reception', 'POST', `/api/soci/${id.socio}/sospensioni/${s.id}/termina`, { riprende_il: fra(4) });
		assert.equal(prima.statusCode, 200, prima.body);
		assert.equal(prima.json().sospensione.al, fra(3));
		const elenco = (await come('reception', 'GET', `/api/soci/${id.socio}/sospensioni`)).json().sospensioni;
		assert.equal(elenco[0].stato, 'in_corso');
		assert.equal(elenco[0].riprende_il, fra(4));
		const lette = (await come('reception', 'GET', `/api/entities/Subscription?member_id=${id.socio}`)).json();
		assert.equal(lette[0].end_date, fra(32));
	});
});

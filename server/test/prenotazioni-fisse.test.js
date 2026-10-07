// Le prenotazioni fisse, contro le rotte vere.
//
// Le regole: si prenota come chiunque (piena → lista d'attesa), solo dove c'è un abbonamento,
// al rinnovo si riparte, una disdetta del socio non si rifà, l'avviso per l'abbonamento arriva
// una volta sola, e terminare la fissa disdice le prenotazioni future.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, plans, rooms, courses, events, sessions, bookings, subscriptions, prenotazioniFisse, notifiche, auditLogs,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { dateGiuste } from '../src/lib/dateSettimanali.js';
import { giornoDellaSettimana } from '../src/lib/calendario.js';

const PASSWORD = 'prova-fisse-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
const GIORNO_A = giornoDellaSettimana(spostaGiorni(oggi, 1));
const GIORNO_B = giornoDellaSettimana(spostaGiorni(oggi, 3));
const FINE_SERIE = spostaGiorni(oggi, 34);

let app;
const token = {};
const id = { soci: [], account: [], sala: null, corso: null, evento: null, piano: null };

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const lezioni = () => db.select().from(sessions).where(eq(sessions.eventId, id.evento)).orderBy(sessions.date);
const diSocio = (i) => db.select().from(bookings)
	.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
	.where(and(eq(bookings.memberId, id.soci[i]), eq(sessions.eventId, id.evento)));

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const soci = await db.insert(members).values(['Uno', 'Due'].map((n, i) => ({ nome: n, cognome: 'Fissa', codiceSocio: `FX${'AB'[i]}${lettere}` }))).returning();
	id.soci = soci.map((s) => s.id);
	// Il primo socio ha l'abbonamento solo per altre due settimane; il secondo per tutta la serie.
	await db.insert(subscriptions).values([
		{ memberId: id.soci[0], planName: 'Breve', startDate: spostaGiorni(oggi, -30), endDate: spostaGiorni(oggi, 14) },
		{ memberId: id.soci[1], planName: 'Lungo', startDate: spostaGiorni(oggi, -30), endDate: spostaGiorni(oggi, 365) },
	]);
	const [piano] = await db.insert(plans).values({ name: `Trimestrale fisse ${t}`, price: '80', durataValore: 3, durataUnita: 'mesi' }).returning();
	id.piano = piano.id;
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Fisse', email: `fisse.rec.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Socio Fisse', email: `fisse.soc.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[0] },
		{ nome: 'Altro Fisse', email: `fisse.soc2.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[1] },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.socio = await login(account[1].email);
	token.altro = await login(account[2].email);

	const [sala] = await db.insert(rooms).values({ name: `Sala fisse ${t}` }).returning();
	id.sala = sala.id;
	const [corso] = await db.insert(courses).values({ name: `Yoga ${t}` }).returning();
	id.corso = corso.id;
	const [evento] = await db.insert(events).values({
		courseId: corso.id, roomId: sala.id, capacity: 1, recurrenceType: 'weekly', daysOfWeek: [GIORNO_A, GIORNO_B],
		startDate: oggi, endCondition: 'by_date', endDate: FINE_SERIE, startTime: '18:00', endTime: '19:00',
	}).returning();
	id.evento = evento.id;
	const date = dateGiuste({ days_of_week: [GIORNO_A, GIORNO_B], start_date: spostaGiorni(oggi, 1), end_condition: 'by_date', end_date: FINE_SERIE });
	await db.insert(sessions).values(date.map((d) => ({ eventId: evento.id, date: d, startTime: '18:00', endTime: '19:00', roomId: sala.id, capacity: 1 })));
});

after(async () => {
	const tutte = await lezioni();
	if (tutte.length) await db.delete(bookings).where(inArray(bookings.sessionId, tutte.map((l) => l.id)));
	await db.delete(prenotazioniFisse).where(eq(prenotazioniFisse.eventId, id.evento));
	await db.delete(sessions).where(eq(sessions.eventId, id.evento));
	await db.delete(events).where(eq(events.id, id.evento));
	await db.delete(courses).where(eq(courses.id, id.corso));
	await db.delete(rooms).where(eq(rooms.id, id.sala));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, id.account));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
	await db.delete(members).where(inArray(members.id, id.soci));
	await db.delete(plans).where(eq(plans.id, id.piano));
	await app.close();
	await pool.end();
});

describe('prenotare fisso', () => {
	test('il secondo socio, dalla reception, solo il primo giorno: tutte le lezioni di quel giorno', async () => {
		const res = await come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[1], event_id: id.evento, giorni: [GIORNO_A] });
		assert.equal(res.statusCode, 201, res.body);
		const attese = (await lezioni()).filter((l) => giornoDellaSettimana(l.date) === GIORNO_A);
		assert.equal(res.json().prenotate, attese.length);
		const sue = await diSocio(1);
		assert.ok(sue.every((r) => giornoDellaSettimana(r.sessions.date) === GIORNO_A));
		assert.equal((await come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[1], event_id: id.evento, giorni: [GIORNO_A] })).statusCode, 409);
	});

	test('il primo socio dal portale: fino alla fine del suo abbonamento, in lista dove è pieno, e un avviso', async () => {
		const res = await come('socio', 'POST', `/api/member/v1/corsi/serie/${id.evento}/fissa`, {});
		assert.equal(res.statusCode, 201, res.body);
		const { prenotate, in_attesa: inAttesa, senza_abbonamento: scoperte } = res.json();
		const tutte = await lezioni();
		const coperte = tutte.filter((l) => l.date <= spostaGiorni(oggi, 14));
		assert.equal(prenotate + inAttesa, coperte.length);
		assert.equal(scoperte, tutte.length - coperte.length);
		// Il giorno A ha già il secondo socio (capienza 1): lì il primo è in lista d'attesa.
		assert.equal(inAttesa, coperte.filter((l) => giornoDellaSettimana(l.date) === GIORNO_A).length);

		// L'avviso arriva una volta: rileggere l'agenda riapplica la fissa, ma non riavvisa.
		await come('socio', 'GET', '/api/member/v1/corsi/agenda');
		const avvisi = await db.select().from(notifiche).where(and(eq(notifiche.memberId, id.soci[0]), eq(notifiche.tipo, 'fissa_senza_abbonamento')));
		assert.equal(avvisi.length, 1);
		assert.match(avvisi[0].testo, /si ferma al/);
	});

	test("nell'agenda la lezione dice che è una serie, e che il socio ce l'ha fissa", async () => {
		const agenda = (await come('socio', 'GET', '/api/member/v1/corsi/agenda')).json();
		const lezione = agenda.giorni.flatMap((g) => g.lezioni).find((l) => l.serie?.id === id.evento);
		assert.deepEqual(lezione.serie, { id: id.evento, mia_fissa: true });
		const elenco = (await come('socio', 'GET', '/api/member/v1/corsi/fisse')).json().fisse;
		assert.equal(elenco.length, 1);
		assert.deepEqual(elenco[0].giorni.sort(), [GIORNO_A, GIORNO_B].sort());
	});

	test('una lezione disdetta dal socio non gli si riprenota', async () => {
		const [una] = (await diSocio(0)).filter((r) => r.bookings.status === 'confirmed');
		assert.equal((await come('socio', 'POST', `/api/member/v1/corsi/prenotazioni/${una.bookings.id}/disdici`)).statusCode, 200);
		await come('socio', 'GET', '/api/member/v1/corsi/agenda');
		const [dopo] = await db.select().from(bookings).where(eq(bookings.id, una.bookings.id));
		assert.equal(dopo.status, 'cancelled');
		const vive = (await diSocio(0)).filter((r) => r.bookings.sessionId === una.bookings.sessionId && r.bookings.status !== 'cancelled');
		assert.equal(vive.length, 0);
	});

	test('al rinnovo la fissa riparte da sola', async () => {
		const prima = (await diSocio(0)).length;
		const rinnovo = await come('reception', 'POST', '/api/entities/Subscription', {
			member_id: id.soci[0], plan_id: id.piano, start_date: spostaGiorni(oggi, 15),
		});
		assert.equal(rinnovo.statusCode, 201, rinnovo.body);
		assert.equal((await diSocio(0)).length, (await lezioni()).length, 'tutte le lezioni ora hanno una prenotazione');
		assert.ok((await diSocio(0)).length > prima);
	});
});

describe('terminare', () => {
	test('il socio non termina la fissa di un altro', async () => {
		const [fissaAltrui] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[1]), eq(prenotazioniFisse.attiva, true)));
		assert.equal((await come('socio', 'DELETE', `/api/member/v1/corsi/fisse/${fissaAltrui.id}`)).statusCode, 404);
		assert.equal((await come('socio', 'GET', '/api/prenotazioni-fisse')).statusCode, 403);
	});

	test('termina: niente più prenotazioni nuove, e le future si disdicono', async () => {
		const [mia] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[0]), eq(prenotazioniFisse.attiva, true)));
		const res = await come('socio', 'DELETE', `/api/member/v1/corsi/fisse/${mia.id}`);
		assert.equal(res.statusCode, 200, res.body);
		assert.ok(res.json().disdette > 0);
		const vive = (await diSocio(0)).filter((r) => r.bookings.status !== 'cancelled');
		assert.equal(vive.length, 0);
		const [dopo] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, mia.id));
		assert.equal(dopo.attiva, false);
		assert.equal((await come('socio', 'GET', '/api/member/v1/corsi/fisse')).json().fisse.length, 0);
	});
});

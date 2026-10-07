// Togliere lezioni dal calendario e cambiare la data fine di una serie, contro le rotte vere.
//
// Le regole da non rompere: il passato non si tocca; una lezione senza prenotazioni si elimina,
// una con prenotazioni si annulla, le prenotazioni vive si cancellano senza promuovere nessuno, e
// chi era prenotato riceve un avviso nel portale; un'anteprima non scrive niente.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, bookings, sessions, events, courses, rooms, notifiche, auditLogs,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { dateGiuste } from '../src/lib/dateSettimanali.js';
import { giornoDellaSettimana } from '../src/lib/calendario.js';

const PASSWORD = 'prova-calendario-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
// Due giorni della settimana che non sono oggi: le lezioni di oggi dipendono dall'ora.
const GIORNO_A = giornoDellaSettimana(spostaGiorni(oggi, 1));
const GIORNO_B = giornoDellaSettimana(spostaGiorni(oggi, 3));

let app;
const token = {};
const id = { soci: [], account: [], sale: [], corso: null, eventi: [] };

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const lezioniDi = (idEvento) => db.select().from(sessions).where(eq(sessions.eventId, idEvento)).orderBy(sessions.date);

/** Una serie settimanale con le sue lezioni, due settimane nel passato e quattro nel futuro. */
async function serie({ giorni = [GIORNO_A, GIORNO_B], dal = spostaGiorni(oggi, -14), al = spostaGiorni(oggi, 27), sala = id.sale[0] } = {}) {
	const [evento] = await db.insert(events).values({
		courseId: id.corso, roomId: sala, capacity: 2, recurrenceType: 'weekly', daysOfWeek: giorni,
		startDate: dal, endCondition: 'by_date', endDate: al, startTime: '18:00', endTime: '19:00',
	}).returning();
	id.eventi.push(evento.id);
	const date = dateGiuste({ days_of_week: giorni, start_date: dal, end_condition: 'by_date', end_date: al });
	await db.insert(sessions).values(date.map((date) => ({
		eventId: evento.id, date, startTime: '18:00', endTime: '19:00', roomId: sala, capacity: 2,
	})));
	return { evento, lezioni: await lezioniDi(evento.id) };
}

const prenota = (lezione, socio, status = 'confirmed', waitlistPosition = null) =>
	db.insert(bookings).values({ sessionId: lezione.id, memberId: socio, status, waitlistPosition }).returning().then(([b]) => b);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const soci = await db.insert(members).values(['Uno', 'Due', 'Tre'].map((n, i) => ({
		nome: n, cognome: 'Calendario', codiceSocio: `CL${'ABC'[i]}${lettere}`,
	}))).returning();
	id.soci = soci.map((s) => s.id);

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Calendario', email: `cal.rec.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Socio Calendario', email: `cal.soc.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[0] },
		{ nome: 'Altro Socio Calendario', email: `cal.soc2.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[1] },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.socio = await login(account[1].email);
	token.altro = await login(account[2].email);

	const sale = await db.insert(rooms).values([{ name: `Sala cal ${suffisso}` }, { name: `Sala cal2 ${suffisso}` }]).returning();
	id.sale = sale.map((s) => s.id);
	const [corso] = await db.insert(courses).values({ name: `Pilates ${suffisso}` }).returning();
	id.corso = corso.id;
});

after(async () => {
	const tutte = id.eventi.length ? await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.eventId, id.eventi)) : [];
	if (tutte.length) {
		await db.delete(bookings).where(inArray(bookings.sessionId, tutte.map((l) => l.id)));
		await db.delete(sessions).where(inArray(sessions.id, tutte.map((l) => l.id)));
	}
	if (id.eventi.length) await db.delete(events).where(inArray(events.id, id.eventi));
	await db.delete(courses).where(eq(courses.id, id.corso));
	await db.delete(rooms).where(inArray(rooms.id, id.sale));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, id.account));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	// Le notifiche vanno via col socio (ON DELETE CASCADE).
	await db.delete(members).where(inArray(members.id, id.soci));
	await app.close();
	await pool.end();
});

describe('eliminare una lezione', () => {
	test("un evento singolo senza prenotazioni sparisce, lezione ed evento", async () => {
		const giorno = spostaGiorni(oggi, 2);
		const [evento] = await db.insert(events).values({
			courseId: id.corso, roomId: id.sale[0], capacity: 5, recurrenceType: 'single', startDate: giorno, startTime: '10:00', endTime: '11:00',
		}).returning();
		id.eventi.push(evento.id);
		const [lezione] = await db.insert(sessions).values({
			eventId: evento.id, date: giorno, startTime: '10:00', endTime: '11:00', roomId: id.sale[0], capacity: 5,
		}).returning();

		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezione.id, ambito: 'lezione' });
		assert.equal(res.statusCode, 200, res.body);
		assert.deepEqual(res.json(), { eliminate: 1, annullate: 0, soci_avvisati: 0, evento_eliminato: true });
		assert.equal((await lezioniDi(evento.id)).length, 0);
		assert.equal((await db.select().from(events).where(eq(events.id, evento.id))).length, 0);
	});

	test('con prenotati si annulla: prenotazioni cancellate, nessuna promozione, un avviso a chi c\'era', async () => {
		const { evento, lezioni } = await serie();
		const lezione = lezioni.find((l) => l.date > oggi);
		await prenota(lezione, id.soci[0]);
		await prenota(lezione, id.soci[1], 'waitlisted', 1);
		await prenota(lezione, id.soci[2], 'cancelled'); // aveva già disdetto: nessun avviso

		// L'anteprima conta e non scrive.
		const prima = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezione.id, ambito: 'lezione', anteprima: true });
		assert.equal(prima.statusCode, 200, prima.body);
		assert.deepEqual(prima.json(), { eliminate: 0, annullate: 1, soci_avvisati: 2, evento_eliminato: false });
		const [intatta] = await db.select().from(sessions).where(eq(sessions.id, lezione.id));
		assert.equal(intatta.status, 'active');

		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezione.id, ambito: 'lezione' });
		assert.equal(res.statusCode, 200, res.body);
		const [annullata] = await db.select().from(sessions).where(eq(sessions.id, lezione.id));
		assert.equal(annullata.status, 'cancelled');
		const prenotazioni = await db.select().from(bookings).where(eq(bookings.sessionId, lezione.id));
		assert.ok(prenotazioni.every((b) => b.status === 'cancelled'), 'nessuno resta confermato o promosso');

		const avvisi = await db.select().from(notifiche).where(inArray(notifiche.memberId, id.soci));
		const destinatari = avvisi.filter((n) => n.testo.includes(lezione.date.slice(8, 10).replace(/^0/, ''))).map((n) => n.memberId);
		assert.deepEqual(new Set(destinatari), new Set([id.soci[0], id.soci[1]]));
		assert.match(avvisi[0].titolo, /Lezione annullata: Pilates/);

		// Il resto della serie è com'era.
		const resto = (await lezioniDi(evento.id)).filter((l) => l.id !== lezione.id);
		assert.ok(resto.every((l) => l.status === 'active'));
	});

	test('una lezione già finita non si tocca', async () => {
		const { lezioni } = await serie();
		const passata = lezioni.find((l) => l.date < oggi);
		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: passata.id, ambito: 'lezione' });
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /già finita/);
	});
});

describe('eliminare una serie', () => {
	test('solo nei giorni scelti, da oggi in poi', async () => {
		const { evento, lezioni } = await serie();
		const res = await come('reception', 'POST', '/api/calendario/elimina', {
			lezione_id: lezioni.at(-1).id, ambito: 'serie', giorni: [GIORNO_A],
		});
		assert.equal(res.statusCode, 200, res.body);

		const dopo = await lezioniDi(evento.id);
		const futureA = lezioni.filter((l) => l.date >= oggi && giornoDellaSettimana(l.date) === GIORNO_A);
		assert.equal(res.json().eliminate, futureA.length);
		assert.ok(dopo.every((l) => !(l.date >= oggi && giornoDellaSettimana(l.date) === GIORNO_A)), 'le future del giorno scelto sono sparite');
		assert.equal(dopo.filter((l) => l.date < oggi).length, lezioni.filter((l) => l.date < oggi).length, 'il passato resta');
		assert.ok(dopo.some((l) => l.date >= oggi && giornoDellaSettimana(l.date) === GIORNO_B), "l'altro giorno resta");
		const [ev] = await db.select().from(events).where(eq(events.id, evento.id));
		assert.equal(ev.endDate, evento.endDate, 'togliendo un giorno solo la fine della serie non cambia');
	});

	test('in tutti i giorni: resta il passato, e la serie finisce con l\'ultima lezione rimasta', async () => {
		const { evento, lezioni } = await serie();
		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezioni.at(-1).id, ambito: 'serie' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().evento_eliminato, false);

		const dopo = await lezioniDi(evento.id);
		assert.ok(dopo.every((l) => l.date < oggi));
		const [ev] = await db.select().from(events).where(eq(events.id, evento.id));
		assert.equal(ev.endDate, dopo.at(-1).date);
	});

	test('una serie tutta nel futuro sparisce con le sue lezioni', async () => {
		const { evento, lezioni } = await serie({ dal: spostaGiorni(oggi, 1) });
		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezioni[0].id, ambito: 'serie' });
		assert.equal(res.json().evento_eliminato, true);
		assert.equal((await db.select().from(events).where(eq(events.id, evento.id))).length, 0);
	});
});

describe('la data fine di una serie', () => {
	test('accorciata: le lezioni oltre si tolgono con le regole di sempre', async () => {
		const { evento, lezioni } = await serie();
		const nuovaFine = spostaGiorni(oggi, 6);
		const oltre = lezioni.filter((l) => l.date > nuovaFine);
		await prenota(oltre[0], id.soci[0]);

		const anteprima = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: nuovaFine, anteprima: true });
		assert.equal(anteprima.statusCode, 200, anteprima.body);
		assert.equal(anteprima.json().aggiunte, 0);
		assert.equal(anteprima.json().eliminate, oltre.length - 1);
		assert.equal(anteprima.json().annullate, 1);

		const res = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: nuovaFine });
		assert.equal(res.statusCode, 200, res.body);
		const dopo = await lezioniDi(evento.id);
		assert.ok(dopo.filter((l) => l.date > nuovaFine).every((l) => l.status === 'cancelled'));
		const [ev] = await db.select().from(events).where(eq(events.id, evento.id));
		assert.equal(ev.endDate, nuovaFine);
	});

	test('allungata: nascono le lezioni mancanti col modello, saltando quelle scelte', async () => {
		const { evento, lezioni } = await serie({ al: spostaGiorni(oggi, 6) });
		const nuovaFine = spostaGiorni(oggi, 20);
		const anteprima = (await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: nuovaFine, anteprima: true })).json();
		const attese = dateGiuste({ days_of_week: [GIORNO_A, GIORNO_B], start_date: evento.startDate, end_condition: 'by_date', end_date: nuovaFine })
			.filter((d) => d > lezioni.at(-1).date);
		assert.deepEqual(anteprima.nuove, attese);
		assert.deepEqual(anteprima.modello, { room_id: id.sale[0], start_time: '18:00', end_time: '19:00', capacity: 2 });

		const res = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: nuovaFine, salta: [attese[0]] });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().aggiunte, attese.length - 1);
		const dopo = await lezioniDi(evento.id);
		assert.ok(!dopo.some((l) => l.date === attese[0]), 'la data saltata non è stata creata');
		assert.ok(dopo.filter((l) => l.date > lezioni.at(-1).date).every((l) => l.roomId === id.sale[0] && l.capacity === 2 && l.startTime === '18:00:00'));
	});

	test('dentro una sospensione della sala le date si saltano da sole', async () => {
		const sala = id.sale[1];
		const { evento } = await serie({ al: spostaGiorni(oggi, 6), sala });
		await db.update(rooms).set({ stato: 'sospeso', sospesaDal: spostaGiorni(oggi, 7), sospesaAl: spostaGiorni(oggi, 13) }).where(eq(rooms.id, sala));
		try {
			const anteprima = (await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, 20), anteprima: true })).json();
			assert.ok(anteprima.saltate_sala.length > 0);
			assert.ok(anteprima.nuove.every((d) => d < spostaGiorni(oggi, 7) || d > spostaGiorni(oggi, 13)));
		} finally {
			await db.update(rooms).set({ stato: 'attivo', sospesaDal: null, sospesaAl: null }).where(eq(rooms.id, sala));
		}
	});

	test('non nel passato, non prima dell\'inizio, e solo per le serie settimanali', async () => {
		const { evento } = await serie();
		const passata = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, -1) });
		assert.equal(passata.statusCode, 400);
		assert.match(passata.json().error, /passato/);
		const prima = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, -30) });
		assert.equal(prima.statusCode, 400);
	});
});

describe('chi può', () => {
	test('il socio non tocca il calendario', async () => {
		const { evento, lezioni } = await serie();
		assert.equal((await come('socio', 'POST', '/api/calendario/elimina', { lezione_id: lezioni.at(-1).id, ambito: 'lezione' })).statusCode, 403);
		assert.equal((await come('socio', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, 40) })).statusCode, 403);
	});
});

describe('le notifiche nel portale', () => {
	test('il socio vede le sue, quante da leggere, e aprendole le segna lette', async () => {
		const elenco = await come('socio', 'GET', '/api/member/v1/notifiche');
		assert.equal(elenco.statusCode, 200, elenco.body);
		const { notifiche: mie, non_lette: nonLette } = elenco.json();
		assert.ok(mie.length > 0 && nonLette > 0);
		assert.deepEqual(Object.keys(mie[0]).sort(), ['creata_il', 'id', 'letta', 'testo', 'tipo', 'titolo']);
		assert.equal((await come('socio', 'GET', '/api/member/v1/notifiche?solo_conteggio=1')).json().non_lette, nonLette);

		const lette = await come('socio', 'POST', '/api/member/v1/notifiche/lette');
		assert.equal(lette.json().lette, nonLette);
		assert.equal((await come('socio', 'GET', '/api/member/v1/notifiche?solo_conteggio=1')).json().non_lette, 0);
	});

	test('quelle di un altro socio restano sue', async () => {
		const prima = (await come('altro', 'GET', '/api/member/v1/notifiche?solo_conteggio=1')).json().non_lette;
		assert.ok(prima > 0, "l'altro socio era in lista d'attesa: ha il suo avviso");
		await come('socio', 'POST', '/api/member/v1/notifiche/lette');
		assert.equal((await come('altro', 'GET', '/api/member/v1/notifiche?solo_conteggio=1')).json().non_lette, prima);
		const sue = (await come('altro', 'GET', '/api/member/v1/notifiche')).json().notifiche;
		const mie = (await come('socio', 'GET', '/api/member/v1/notifiche')).json().notifiche;
		assert.ok(!sue.some((n) => mie.some((m) => m.id === n.id)));
	});
});

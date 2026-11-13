// Il calendario contro le rotte vere: leggere lezioni e sessioni, controllare le sovrapposizioni,
// togliere lezioni e cambiare la data fine di una sessione.
//
// Le regole da non rompere: il passato non si tocca; una lezione senza prenotazioni si elimina,
// una con prenotazioni si annulla, le prenotazioni vive si cancellano senza promuovere nessuno, e
// chi era prenotato riceve un avviso nel portale; un'anteprima non scrive niente; una sessione
// rimasta senza lezioni chiude le sue fisse; chi ha il calendario solo in visione lo legge.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, bookings, sessions, events, courses, rooms, notifiche, auditLogs, instructors, subscriptions, prenotazioniFisse,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';
import { dateGiuste } from '../src/lib/dateSettimanali.js';
import { giornoDellaSettimana } from '../src/lib/calendario.js';

const PASSWORD = 'prova-calendario-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
// Un giorno della settimana che non è oggi: le lezioni di oggi dipendono dall'ora.
const GIORNO_A = giornoDellaSettimana(spostaGiorni(oggi, 1));

let app;
const token = {};
const id = { soci: [], account: [], sale: [], corso: null, altroCorso: null, istruttore: null, eventi: [] };

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const lezioniDi = (idEvento) => db.select().from(sessions).where(eq(sessions.eventId, idEvento)).orderBy(sessions.date);

/** Una sessione settimanale con le sue lezioni, due settimane nel passato e quattro nel futuro. */
async function serie({ giorno = GIORNO_A, dal = spostaGiorni(oggi, -14), al = spostaGiorni(oggi, 27), sala = id.sale[0], corso = id.corso, inizio = '18:00', fine = '19:00' } = {}) {
	const [evento] = await db.insert(events).values({
		courseId: corso, roomId: sala, capacity: 2, recurrenceType: 'weekly', giorno,
		startDate: dal, endCondition: 'by_date', endDate: al, startTime: inizio, endTime: fine,
	}).returning();
	id.eventi.push(evento.id);
	const date = dateGiuste({ giorno, start_date: dal, end_condition: 'by_date', end_date: al });
	await db.insert(sessions).values(date.map((date) => ({
		eventId: evento.id, date, startTime: inizio, endTime: fine, roomId: sala, capacity: 2,
	})));
	return { evento, lezioni: await lezioniDi(evento.id) };
}

const prenota = (lezione, socio, status = 'confirmed', waitlistPosition = null, prenotazioneFissaId = null) =>
	db.insert(bookings).values({ sessionId: lezione.id, memberId: socio, status, waitlistPosition, prenotazioneFissaId }).returning().then(([b]) => b);
const fissa = (evento, socio, al = null) =>
	db.insert(prenotazioniFisse).values({ memberId: socio, eventId: evento.id, dal: oggi, al }).returning().then(([f]) => f);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const soci = await db.insert(members).values(['Uno', 'Due', 'Tre'].map((n, i) => ({
		nome: n, cognome: 'Calendario', codiceSocio: `CL${'ABC'[i]}${lettere}`,
	}))).returning();
	id.soci = soci.map((s) => s.id);
	await db.insert(subscriptions).values(id.soci.map((memberId) => ({
		memberId, planName: 'Annuale', startDate: spostaGiorni(oggi, -30), endDate: spostaGiorni(oggi, 365),
	})));

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Calendario', email: `cal.rec.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Socio Calendario', email: `cal.soc.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[0] },
		{ nome: 'Altro Socio Calendario', email: `cal.soc2.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: id.soci[1] },
		{ nome: 'Istruttore Calendario', email: `cal.ist.${suffisso}@test.local`, passwordHash, ruolo: 'istruttore' },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.socio = await login(account[1].email);
	token.altro = await login(account[2].email);
	token.istruttore = await login(account[3].email);

	const sale = await db.insert(rooms).values([{ name: `Sala cal ${suffisso}` }, { name: `Sala cal2 ${suffisso}` }]).returning();
	id.sale = sale.map((s) => s.id);
	const [istruttore] = await db.insert(instructors).values({ nome: 'Ida', cognome: `Calendario ${suffisso}` }).returning();
	id.istruttore = istruttore.id;
	const [corso] = await db.insert(courses).values({ name: `Pilates ${suffisso}`, instructorId: istruttore.id }).returning();
	const [altro] = await db.insert(courses).values({ name: `Yoga ${suffisso}`, instructorId: istruttore.id }).returning();
	id.corso = corso.id;
	id.altroCorso = altro.id;
});

after(async () => {
	ripristinaMatricePredefinita();
	const tutte = id.eventi.length ? await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.eventId, id.eventi)) : [];
	if (tutte.length) {
		await db.delete(bookings).where(inArray(bookings.sessionId, tutte.map((l) => l.id)));
		await db.delete(sessions).where(inArray(sessions.id, tutte.map((l) => l.id)));
	}
	if (id.eventi.length) await db.delete(events).where(inArray(events.id, id.eventi));
	await db.delete(courses).where(inArray(courses.id, [id.corso, id.altroCorso]));
	await db.delete(instructors).where(eq(instructors.id, id.istruttore));
	await db.delete(rooms).where(inArray(rooms.id, id.sale));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, id.account));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
	// Notifiche e fisse vanno via col socio (ON DELETE CASCADE).
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

		// Il resto della sessione è com'era.
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

describe('eliminare una sessione', () => {
	test("da oggi in poi, indicata con la sessione: resta il passato, e finisce con l'ultima lezione rimasta", async () => {
		const { evento, lezioni } = await serie();
		const res = await come('reception', 'POST', '/api/calendario/elimina', { evento_id: evento.id, ambito: 'serie' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().evento_eliminato, false);
		assert.equal(res.json().eliminate, lezioni.filter((l) => l.date >= oggi).length);

		const dopo = await lezioniDi(evento.id);
		assert.ok(dopo.length > 0 && dopo.every((l) => l.date < oggi));
		const [ev] = await db.select().from(events).where(eq(events.id, evento.id));
		assert.equal(ev.endDate, dopo.at(-1).date);
	});

	test('anche indicata con una sua lezione', async () => {
		const { evento, lezioni } = await serie();
		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezioni.at(-1).id, ambito: 'serie' });
		assert.equal(res.statusCode, 200, res.body);
		assert.ok((await lezioniDi(evento.id)).every((l) => l.date < oggi));
	});

	test('una sessione tutta nel futuro sparisce con le sue lezioni', async () => {
		const { evento, lezioni } = await serie({ dal: spostaGiorni(oggi, 1) });
		const res = await come('reception', 'POST', '/api/calendario/elimina', { lezione_id: lezioni[0].id, ambito: 'serie' });
		assert.equal(res.json().evento_eliminato, true);
		assert.equal((await db.select().from(events).where(eq(events.id, evento.id))).length, 0);
	});

	test('rimasta senza lezioni da tenere, chiude le sue fisse', async () => {
		const { evento } = await serie();
		const sua = await fissa(evento, id.soci[2]);
		const res = await come('reception', 'POST', '/api/calendario/elimina', { evento_id: evento.id, ambito: 'serie' });
		assert.equal(res.statusCode, 200, res.body);
		const [dopo] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, sua.id));
		assert.equal(dopo.attiva, false);
		assert.equal(dopo.terminataIl, oggi);
	});

	test('senza lezione né sessione non si elimina niente', async () => {
		const res = await come('reception', 'POST', '/api/calendario/elimina', { ambito: 'serie' });
		assert.equal(res.statusCode, 400);
	});
});

describe('la data fine di una sessione', () => {
	test('accorciata: le lezioni oltre si tolgono con le regole di sempre', async () => {
		const { evento, lezioni } = await serie();
		const nuovaFine = spostaGiorni(oggi, 13);
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

	test('accorciata a oggi: senza lezioni da tenere, le fisse si chiudono', async () => {
		const { evento } = await serie();
		const sua = await fissa(evento, id.soci[2]);
		const res = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: oggi });
		assert.equal(res.statusCode, 200, res.body);
		const [dopo] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, sua.id));
		assert.equal(dopo.attiva, false);
	});

	test('allungata: nascono le lezioni mancanti col modello, saltando quelle scelte', async () => {
		const { evento, lezioni } = await serie({ al: spostaGiorni(oggi, 6) });
		const nuovaFine = spostaGiorni(oggi, 27);
		const anteprima = (await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: nuovaFine, anteprima: true })).json();
		const attese = dateGiuste({ giorno: GIORNO_A, start_date: evento.startDate, end_condition: 'by_date', end_date: nuovaFine })
			.filter((d) => d > lezioni.at(-1).date);
		assert.deepEqual(anteprima.nuove, attese);
		assert.deepEqual(anteprima.modello, { room_id: id.sale[0], start_time: '18:00', end_time: '19:00', capacity: 2 });

		const res = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: nuovaFine, salta: [attese[0]] });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().aggiunte, attese.length - 1);
		const dopo = await lezioniDi(evento.id);
		assert.ok(!dopo.some((l) => l.date === attese[0]), 'la data saltata non è stata creata');
		assert.ok(dopo.filter((l) => l.date > lezioni.at(-1).date).every((l) => l.roomId === id.sale[0] && l.capacity === 2 && l.startTime === '18:00:00'));
		assert.ok(dopo.every((l) => giornoDellaSettimana(l.date) === GIORNO_A), 'tutte nel giorno della sessione');
	});

	test('allungata: le fisse senza fine prenotano le lezioni nuove, quelle con una data no', async () => {
		const { evento, lezioni } = await serie({ al: spostaGiorni(oggi, 6) });
		await fissa(evento, id.soci[0]);
		await fissa(evento, id.soci[1], lezioni.at(-1).date);
		const res = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, 20) });
		assert.equal(res.statusCode, 200, res.body);
		const nuove = (await lezioniDi(evento.id)).filter((l) => l.date > lezioni.at(-1).date);
		assert.ok(nuove.length > 0);
		const suNuove = await db.select().from(bookings).where(inArray(bookings.sessionId, nuove.map((l) => l.id)));
		assert.equal(suNuove.filter((b) => b.memberId === id.soci[0] && b.prenotazioneFissaId).length, nuove.length);
		assert.equal(suNuove.filter((b) => b.memberId === id.soci[1]).length, 0);
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

	test("non nel passato, non prima dell'inizio, e solo per le sessioni settimanali", async () => {
		const { evento } = await serie();
		const passata = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, -1) });
		assert.equal(passata.statusCode, 400);
		assert.match(passata.json().error, /passato/);
		const prima = await come('reception', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, -30) });
		assert.equal(prima.statusCode, 400);
	});
});

describe('leggere il calendario', () => {
	test('le lezioni di un intervallo, con corso, sessione e posti contati', async () => {
		const { evento, lezioni } = await serie();
		const futura = lezioni.find((l) => l.date > oggi);
		await prenota(futura, id.soci[0]);
		await prenota(futura, id.soci[1], 'waitlisted', 1);
		const res = await come('reception', 'GET', `/api/calendario/lezioni?dal=${oggi}&al=${spostaGiorni(oggi, 41)}`);
		assert.equal(res.statusCode, 200, res.body);
		const mie = res.json().lezioni.filter((l) => l.event_id === evento.id);
		assert.deepEqual(mie.map((l) => l.id), lezioni.filter((l) => l.date >= oggi).map((l) => l.id));
		const quella = mie.find((l) => l.id === futura.id);
		assert.equal(quella.confermati, 1);
		assert.equal(quella.in_attesa, 1);
		assert.equal(quella.corso, `Pilates ${suffisso}`);
		assert.equal(quella.start_time, '18:00');
		assert.equal(quella.sessione.giorno, GIORNO_A);
		assert.equal(quella.sessione.recurrence_type, 'weekly');
	});

	test('le lezioni di una sessione da un giorno, e gli intervalli sbagliati', async () => {
		const { evento, lezioni } = await serie();
		const res = (await come('reception', 'GET', `/api/calendario/lezioni?evento_id=${evento.id}&dal=${oggi}`)).json();
		assert.deepEqual(res.lezioni.map((l) => l.id), lezioni.filter((l) => l.date >= oggi).map((l) => l.id));
		assert.equal((await come('reception', 'GET', '/api/calendario/lezioni')).statusCode, 400);
		assert.equal((await come('reception', 'GET', `/api/calendario/lezioni?dal=${oggi}&al=${spostaGiorni(oggi, 200)}`)).statusCode, 400);
		assert.equal((await come('reception', 'GET', `/api/calendario/lezioni?dal=${oggi}&al=${spostaGiorni(oggi, -1)}`)).statusCode, 400);
	});

	test('una lezione: dati e prenotazioni, con la fissa che le ha fatte', async () => {
		const { evento, lezioni } = await serie();
		const futura = lezioni.find((l) => l.date > oggi);
		const sua = await fissa(evento, id.soci[0]);
		await prenota(futura, id.soci[0], 'confirmed', null, sua.id);
		await prenota(futura, id.soci[1]);
		const res = await come('reception', 'GET', `/api/calendario/lezioni/${futura.id}`);
		assert.equal(res.statusCode, 200, res.body);
		const { lezione, prenotazioni } = res.json();
		assert.equal(lezione.id, futura.id);
		assert.equal(lezione.confermati, 2);
		assert.equal(prenotazioni.length, 2);
		const perSocio = Object.fromEntries(prenotazioni.map((p) => [p.member_id, p]));
		assert.equal(perSocio[id.soci[0]].prenotazione_fissa_id, sua.id);
		assert.equal(perSocio[id.soci[1]].prenotazione_fissa_id, null);
		assert.equal(perSocio[id.soci[0]].codice_socio, `CLA${lettere}`);
		assert.equal((await come('reception', 'GET', '/api/calendario/lezioni/00000000-0000-0000-0000-000000000000')).statusCode, 404);
	});

	test('le sessioni in corso, con le loro fisse, e il numero delle finite', async () => {
		const { evento: inCorso } = await serie();
		await fissa(inCorso, id.soci[0]);
		const { evento: finita } = await serie({ dal: spostaGiorni(oggi, -30), al: spostaGiorni(oggi, -2) });
		const res = await come('reception', 'GET', `/api/calendario/sessioni?corso_id=${id.corso}`);
		assert.equal(res.statusCode, 200, res.body);
		const { sessioni, finite } = res.json();
		const questa = sessioni.find((s) => s.id === inCorso.id);
		assert.ok(questa, "la sessione in corso c'è");
		assert.equal(questa.fisse, 1);
		assert.equal(questa.giorno, GIORNO_A);
		assert.ok(questa.prima_lezione < oggi && questa.ultima_lezione > oggi);
		assert.ok(!sessioni.some((s) => s.id === finita.id));
		assert.ok(finite >= 1);
		const soloFinite = (await come('reception', 'GET', `/api/calendario/sessioni?stato=finite&corso_id=${id.corso}`)).json().sessioni;
		assert.ok(soloFinite.some((s) => s.id === finita.id));
		assert.ok(!soloFinite.some((s) => s.id === inCorso.id));
	});
});

describe('le sovrapposizioni', () => {
	test('la stessa sala, lo stesso istruttore, e fine uguale a inizio', async () => {
		const { evento, lezioni } = await serie({ inizio: '07:00', fine: '08:00' });
		const giorno = lezioni.find((l) => l.date > oggi).date;
		const chiedi = (corpo) => come('reception', 'POST', '/api/calendario/conflitti', { date: [giorno], ...corpo });

		const sala = (await chiedi({ start_time: '07:30', end_time: '08:30', room_id: id.sale[0] })).json();
		assert.equal(sala.conflitti[0].tipo, 'sala');
		assert.match(sala.conflitti[0].messaggio, /sala occupata da «Pilates/);
		assert.deepEqual(sala.libere, []);

		const istruttore = (await chiedi({ start_time: '07:30', end_time: '08:30', room_id: id.sale[1], course_id: id.altroCorso })).json();
		assert.equal(istruttore.conflitti[0].tipo, 'istruttore');

		const attaccate = (await chiedi({ start_time: '08:00', end_time: '09:00', room_id: id.sale[0] })).json();
		assert.deepEqual(attaccate, { conflitti: [], libere: [giorno] });

		const stessa = (await chiedi({ start_time: '07:30', end_time: '08:30', room_id: id.sale[0], escludi_evento_id: evento.id })).json();
		assert.deepEqual(stessa.conflitti, [], 'la sessione che si modifica non è in conflitto con sé stessa');

		assert.equal((await chiedi({ start_time: '09:00', end_time: '08:00', room_id: id.sale[0] })).statusCode, 400);
	});
});

describe('chi può', () => {
	test('il socio non tocca né legge il calendario', async () => {
		const { evento, lezioni } = await serie();
		assert.equal((await come('socio', 'POST', '/api/calendario/elimina', { lezione_id: lezioni.at(-1).id, ambito: 'lezione' })).statusCode, 403);
		assert.equal((await come('socio', 'POST', `/api/calendario/eventi/${evento.id}/data-fine`, { end_date: spostaGiorni(oggi, 40) })).statusCode, 403);
		assert.equal((await come('socio', 'GET', `/api/calendario/lezioni?dal=${oggi}&al=${oggi}`)).statusCode, 403);
	});

	test('chi ha il calendario solo in visione lo legge, e non lo cambia', async () => {
		const { evento, lezioni } = await serie();
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { calendar: ['view'] } }, capacita: {} });
		try {
			assert.equal((await come('istruttore', 'GET', `/api/calendario/lezioni?dal=${oggi}&al=${spostaGiorni(oggi, 7)}`)).statusCode, 200);
			assert.equal((await come('istruttore', 'GET', `/api/calendario/lezioni/${lezioni[0].id}`)).statusCode, 200);
			assert.equal((await come('istruttore', 'GET', '/api/calendario/sessioni')).statusCode, 200);
			assert.equal((await come('istruttore', 'POST', '/api/calendario/elimina', { evento_id: evento.id, ambito: 'serie' })).statusCode, 403);
			assert.equal((await come('istruttore', 'POST', '/api/calendario/conflitti', {
				date: [oggi], start_time: '10:00', end_time: '11:00', room_id: id.sale[0],
			})).statusCode, 403);
		} finally {
			ripristinaMatricePredefinita();
		}
		assert.equal((await lezioniDi(evento.id)).length, lezioni.length, 'niente è cambiato');
	});
});

describe('una sessione, un giorno', () => {
	const nuova = (corpo) => come('reception', 'POST', '/api/entities/Event', {
		course_id: id.corso, room_id: id.sale[0], capacity: 5, start_date: spostaGiorni(oggi, 1),
		end_condition: 'by_date', end_date: spostaGiorni(oggi, 30), start_time: '12:00', end_time: '13:00', ...corpo,
	});

	test("un elenco di giorni si rifiuta, e una settimanale vuole un giorno valido", async () => {
		const elenco = await nuova({ recurrence_type: 'weekly', days_of_week: ['Monday', 'Thursday'] });
		assert.equal(elenco.statusCode, 400);
		assert.match(elenco.json().error, /giorno solo/);
		assert.equal((await nuova({ recurrence_type: 'weekly' })).statusCode, 400);
		assert.equal((await nuova({ recurrence_type: 'weekly', giorno: 'Lunedì' })).statusCode, 400);
	});

	test('con il suo giorno nasce; una singola non ne ha; cambiandola il giorno resta obbligatorio', async () => {
		const settimanale = await nuova({ recurrence_type: 'weekly', giorno: 'Monday' });
		assert.equal(settimanale.statusCode, 201, settimanale.body);
		id.eventi.push(settimanale.json().id);
		assert.equal(settimanale.json().giorno, 'Monday');
		assert.ok(!('days_of_week' in settimanale.json()));

		const singola = await nuova({ recurrence_type: 'single', giorno: 'Monday' });
		assert.equal(singola.statusCode, 201, singola.body);
		id.eventi.push(singola.json().id);
		assert.equal(singola.json().giorno, null);

		const url = `/api/entities/Event/${settimanale.json().id}`;
		assert.equal((await come('reception', 'PUT', url, { giorno: null })).statusCode, 400);
		assert.equal((await come('reception', 'PUT', url, { days_of_week: ['Monday'] })).statusCode, 400);
		const capienza = await come('reception', 'PUT', url, { capacity: 8 });
		assert.equal(capienza.statusCode, 200, capienza.body);
		assert.equal(capienza.json().giorno, 'Monday');
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

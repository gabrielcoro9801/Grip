// Le prenotazioni fisse, contro le rotte vere.
//
// Le regole: si prenota come chiunque (piena → lista d'attesa), solo dove c'è un abbonamento; lo
// staff dà sempre una fine (una data o un numero di lezioni), entro l'abbonamento e la sessione;
// il portale crea senza fine, e solo quelle ripartono al rinnovo; una disdetta del socio non si
// rifà; l'avviso per l'abbonamento arriva una volta sola; cambiare il periodo lavora sulla
// differenza; cancellare disdice solo le prenotazioni della fissa, dalla data scelta.
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
import { terminaFissa } from '../src/lib/prenotazioniFisse.js';

const PASSWORD = 'prova-fisse-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
const GIORNO = giornoDellaSettimana(spostaGiorni(oggi, 1));
const FINE_SERIE = spostaGiorni(oggi, 34);

let app;
const token = {};
// `evento`: la sessione del portale, capienza 1. `altro`: la sessione della reception, capienza 5.
const id = { soci: [], account: [], sala: null, corso: null, evento: null, altro: null, piano: null };

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const lezioni = (evento = id.evento) => db.select().from(sessions).where(eq(sessions.eventId, evento)).orderBy(sessions.date);
const diSocio = (i, evento = id.evento) => db.select().from(bookings)
	.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
	.where(and(eq(bookings.memberId, id.soci[i]), eq(sessions.eventId, evento)))
	.orderBy(sessions.date);
const vive = async (i, evento) => (await diSocio(i, evento)).filter((r) => r.bookings.status !== 'cancelled');

async function sessione(capacity) {
	const [evento] = await db.insert(events).values({
		courseId: id.corso, roomId: id.sala, capacity, recurrenceType: 'weekly', giorno: GIORNO,
		startDate: oggi, endCondition: 'by_date', endDate: FINE_SERIE, startTime: '18:00', endTime: '19:00',
	}).returning();
	const date = dateGiuste({ giorno: GIORNO, start_date: spostaGiorni(oggi, 1), end_condition: 'by_date', end_date: FINE_SERIE });
	await db.insert(sessions).values(date.map((d) => ({ eventId: evento.id, date: d, startTime: '18:00', endTime: '19:00', roomId: id.sala, capacity })));
	return evento.id;
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const soci = await db.insert(members).values(['Uno', 'Due', 'Tre'].map((n, i) => ({ nome: n, cognome: 'Fissa', codiceSocio: `FX${'ABC'[i]}${lettere}` }))).returning();
	id.soci = soci.map((s) => s.id);
	// Il primo socio ha l'abbonamento solo per altre due settimane, il secondo per un anno, il terzo
	// per venti giorni.
	await db.insert(subscriptions).values([
		{ memberId: id.soci[0], planName: 'Breve', startDate: spostaGiorni(oggi, -30), endDate: spostaGiorni(oggi, 14) },
		{ memberId: id.soci[1], planName: 'Lungo', startDate: spostaGiorni(oggi, -30), endDate: spostaGiorni(oggi, 365) },
		{ memberId: id.soci[2], planName: 'Medio', startDate: spostaGiorni(oggi, -30), endDate: spostaGiorni(oggi, 20) },
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
	id.evento = await sessione(1);
	id.altro = await sessione(5);
});

after(async () => {
	const tutte = [...await lezioni(id.evento), ...await lezioni(id.altro)];
	if (tutte.length) await db.delete(bookings).where(inArray(bookings.sessionId, tutte.map((l) => l.id)));
	await db.delete(prenotazioniFisse).where(inArray(prenotazioniFisse.eventId, [id.evento, id.altro]));
	await db.delete(sessions).where(inArray(sessions.eventId, [id.evento, id.altro]));
	await db.delete(events).where(inArray(events.id, [id.evento, id.altro]));
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
	test('la reception, per N lezioni: la fine diventa la data della N-esima, e le lezioni si prenotano', async () => {
		const tutte = await lezioni();
		const res = await come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[1], event_id: id.evento, numero: tutte.length });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().fissa.dal, oggi);
		assert.equal(res.json().fissa.al, tutte.at(-1).date);
		assert.equal(res.json().prenotate, tutte.length);
		const sue = await diSocio(1);
		assert.ok(sue.every((r) => r.bookings.prenotazioneFissaId === res.json().fissa.id), 'ogni prenotazione ricorda la sua fissa');
		assert.equal((await come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[1], event_id: id.evento, numero: 1 })).statusCode, 409);
	});

	test('il primo socio dal portale: senza fine, fino alla fine del suo abbonamento, in lista dove è pieno, e un avviso', async () => {
		const res = await come('socio', 'POST', `/api/member/v1/corsi/serie/${id.evento}/fissa`, {});
		assert.equal(res.statusCode, 201, res.body);
		const { prenotate, in_attesa: inAttesa, senza_abbonamento: scoperte } = res.json();
		const tutte = await lezioni();
		const coperte = tutte.filter((l) => l.date <= spostaGiorni(oggi, 14));
		assert.equal(prenotate, 0, 'il secondo socio ha già il posto');
		assert.equal(inAttesa, coperte.length);
		assert.equal(scoperte, tutte.length - coperte.length);
		const [sua] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[0]), eq(prenotazioniFisse.eventId, id.evento)));
		assert.equal(sua.al, null);
		assert.equal(sua.dal, oggi);

		// L'avviso arriva una volta: rileggere l'agenda riapplica la fissa, ma non riavvisa.
		await come('socio', 'GET', '/api/member/v1/corsi/agenda');
		const avvisi = await db.select().from(notifiche).where(and(eq(notifiche.memberId, id.soci[0]), eq(notifiche.tipo, 'fissa_senza_abbonamento')));
		assert.equal(avvisi.length, 1);
		assert.match(avvisi[0].testo, /si ferma al/);
	});

	test("nell'agenda la lezione dice che è una sessione fissa del socio, e l'elenco dà il suo giorno", async () => {
		const agenda = (await come('socio', 'GET', '/api/member/v1/corsi/agenda')).json();
		const lezione = agenda.giorni.flatMap((g) => g.lezioni).find((l) => l.serie?.id === id.evento);
		assert.deepEqual(lezione.serie, { id: id.evento, mia_fissa: true });
		const elenco = (await come('socio', 'GET', '/api/member/v1/corsi/fisse')).json().fisse;
		assert.equal(elenco.length, 1);
		assert.deepEqual(elenco[0].giorni, [GIORNO]);
	});

	test('una lezione disdetta dal socio non gli si riprenota', async () => {
		const [una] = await vive(0);
		assert.equal((await come('socio', 'POST', `/api/member/v1/corsi/prenotazioni/${una.bookings.id}/disdici`)).statusCode, 200);
		await come('socio', 'GET', '/api/member/v1/corsi/agenda');
		const [dopo] = await db.select().from(bookings).where(eq(bookings.id, una.bookings.id));
		assert.equal(dopo.status, 'cancelled');
		assert.equal((await vive(0)).filter((r) => r.bookings.sessionId === una.bookings.sessionId).length, 0);
	});

	test('al rinnovo la fissa senza fine riparte da sola', async () => {
		const prima = (await diSocio(0)).length;
		const rinnovo = await come('reception', 'POST', '/api/entities/Subscription', {
			member_id: id.soci[0], plan_id: id.piano, start_date: spostaGiorni(oggi, 15),
		});
		assert.equal(rinnovo.statusCode, 201, rinnovo.body);
		assert.equal((await diSocio(0)).length, (await lezioni()).length, 'tutte le lezioni ora hanno una prenotazione');
		assert.ok((await diSocio(0)).length > prima);
	});
});

describe('i limiti della reception', () => {
	test('niente inizio passato, niente senza fine, non oltre la sessione, non oltre l\'abbonamento', async () => {
		const crea = (corpo) => come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[2], event_id: id.altro, ...corpo });
		const tutte = await lezioni(id.altro);
		const passato = await crea({ dal: spostaGiorni(oggi, -1), al: tutte[0].date });
		assert.equal(passato.statusCode, 400);
		const senzaFine = await crea({});
		assert.equal(senzaFine.statusCode, 400);
		assert.match(senzaFine.json().error, /fino a quando/);
		const oltreSessione = await crea({ al: spostaGiorni(oggi, 60) });
		assert.equal(oltreSessione.statusCode, 400);
		assert.match(oltreSessione.json().error, /sessione finisce/);
		const oltreAbbonamento = await crea({ al: tutte.at(-1).date });
		assert.equal(oltreAbbonamento.statusCode, 400);
		assert.match(oltreAbbonamento.json().error, /abbonamento del socio finisce/);
		const troppe = await crea({ numero: tutte.length + 1 });
		assert.equal(troppe.statusCode, 400);
		assert.equal((await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.memberId, id.soci[2]))).length, 0, 'nessuna fissa nata');
	});
});

describe('cambiare il periodo', () => {
	test('con una data: si prenota solo dentro il periodo', async () => {
		const tutte = await lezioni(id.altro);
		const res = await come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[2], event_id: id.altro, al: tutte[1].date });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().prenotate, 2);
		assert.deepEqual((await vive(2, id.altro)).map((r) => r.sessions.date), [tutte[0].date, tutte[1].date]);
	});

	test('allungata prenota i giorni aggiunti, accorciata disdice quelli tolti', async () => {
		const tutte = await lezioni(id.altro);
		const [fissa] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[2]), eq(prenotazioniFisse.eventId, id.altro)));
		const piu = await come('reception', 'PUT', `/api/prenotazioni-fisse/${fissa.id}`, { al: tutte[2].date });
		assert.equal(piu.statusCode, 200, piu.body);
		assert.equal(piu.json().prenotate, 1);
		assert.equal(piu.json().disdette, 0);
		const primaDiAccorciare = await vive(2, id.altro);
		assert.equal(primaDiAccorciare.length, 3);

		const meno = await come('reception', 'PUT', `/api/prenotazioni-fisse/${fissa.id}`, { numero: 1 });
		assert.equal(meno.statusCode, 200, meno.body);
		assert.equal(meno.json().fissa.al, tutte[0].date);
		assert.equal(meno.json().disdette, 2);
		const rimaste = await vive(2, id.altro);
		assert.deepEqual(rimaste.map((r) => r.bookings.id), [primaDiAccorciare[0].bookings.id], 'quella in mezzo non si tocca');

		const oltre = await come('reception', 'PUT', `/api/prenotazioni-fisse/${fissa.id}`, { al: tutte.at(-1).date });
		assert.equal(oltre.statusCode, 400, 'oltre l\'abbonamento no');
	});

	test('al rinnovo una fissa con una data non cresce', async () => {
		const prima = (await diSocio(2, id.altro)).length;
		const rinnovo = await come('reception', 'POST', '/api/entities/Subscription', {
			member_id: id.soci[2], plan_id: id.piano, start_date: spostaGiorni(oggi, 21),
		});
		assert.equal(rinnovo.statusCode, 201, rinnovo.body);
		assert.equal((await diSocio(2, id.altro)).length, prima);
	});

	test('senza data si cancella da oggi (K10): la fissa si chiude', async () => {
		const [fissa] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[2]), eq(prenotazioniFisse.eventId, id.altro)));
		const esito = await terminaFissa({ fissaId: fissa.id });
		assert.equal(esito.disdette, 1);
		const [dopo] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, fissa.id));
		assert.equal(dopo.attiva, false);
		assert.equal(dopo.terminataIl, oggi);
		assert.equal((await vive(2, id.altro)).length, 0);
	});
});

describe('terminare', () => {
	test('da un giorno: disdice le sue da lì, e lascia quelle fatte a mano', async () => {
		const tutte = await lezioni(id.altro);
		const [aMano] = await db.insert(bookings).values({ sessionId: tutte[2].id, memberId: id.soci[1], status: 'confirmed' }).returning();
		const res = await come('reception', 'POST', '/api/prenotazioni-fisse', { member_id: id.soci[1], event_id: id.altro, al: tutte.at(-1).date });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.json().prenotate, tutte.length - 1, 'la lezione già prenotata a mano non si rifà');

		const elenco = (await come('reception', 'GET', `/api/prenotazioni-fisse?event_id=${id.altro}`)).json().fisse;
		const riga = elenco.find((f) => f.id === res.json().fissa.id);
		assert.equal(riga.codice_socio, `FXB${lettere}`);
		assert.equal(riga.socio, 'Due Fissa');
		assert.equal(riga.giorno, GIORNO);
		assert.equal(riga.al, tutte.at(-1).date);
		assert.ok(!('giorni' in riga) && !('giorni_serie' in riga));

		const fine = await come('reception', 'POST', `/api/prenotazioni-fisse/${res.json().fissa.id}/termina`, { dal: tutte[1].date });
		assert.equal(fine.statusCode, 200, fine.body);
		assert.equal(fine.json().disdette, tutte.length - 2);
		const restano = await vive(1, id.altro);
		assert.deepEqual(restano.map((r) => r.sessions.date).sort(), [tutte[0].date, tutte[2].date]);
		assert.ok(restano.some((r) => r.bookings.id === aMano.id), 'quella fatta a mano resta');
		const [dopo] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, res.json().fissa.id));
		assert.equal(dopo.al, spostaGiorni(tutte[1].date, -1));
		assert.equal((await come('reception', 'POST', `/api/prenotazioni-fisse/${dopo.id}/termina`, { dal: spostaGiorni(oggi, -1) })).statusCode, 400);
	});

	test('il socio non termina la fissa di un altro', async () => {
		const [fissaAltrui] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[1]), eq(prenotazioniFisse.eventId, id.evento)));
		assert.equal((await come('socio', 'DELETE', `/api/member/v1/corsi/fisse/${fissaAltrui.id}`)).statusCode, 404);
		assert.equal((await come('socio', 'GET', '/api/prenotazioni-fisse')).statusCode, 403);
	});

	test('dal portale, senza data: da oggi, e le future si disdicono', async () => {
		const [mia] = await db.select().from(prenotazioniFisse).where(and(eq(prenotazioniFisse.memberId, id.soci[0]), eq(prenotazioniFisse.attiva, true)));
		const res = await come('socio', 'DELETE', `/api/member/v1/corsi/fisse/${mia.id}`);
		assert.equal(res.statusCode, 200, res.body);
		assert.ok(res.json().disdette > 0);
		assert.equal((await vive(0)).length, 0);
		const [dopo] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, mia.id));
		assert.equal(dopo.attiva, false);
		assert.equal((await come('socio', 'GET', '/api/member/v1/corsi/fisse')).json().fisse.length, 0);
	});
});

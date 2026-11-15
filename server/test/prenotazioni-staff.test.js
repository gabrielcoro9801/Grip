// Il lavoro della reception sulle prenotazioni, dal gestionale.
//
// Il socio prenota e disdice. Lo staff crea prenotazioni per conto dei soci, conferma chi era in
// lista d'attesa (oltre la capienza solo se lo dice), rimette in lista, riattiva una disdetta,
// riordina la lista e cancella gli errori. Tutto finisce nelle stesse righe che legge il portale.
// Un posto che si libera non va più al primo in lista: gli si offre, per 12 ore (D-3 del portale).
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, bookings, sessions, events, courses, rooms, subscriptions, auditLogs, notifiche,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { categoriaDiProva, togliCategorieDiProva } from './categoriaDiProva.js';

const PASSWORD = 'prova-prenotazioni-staff-1234';
const suffisso = Date.now();
const lettere = String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const emailSocio = `pstaff.socio.${suffisso}@test.local`;

let app;
let tokenReception;
let tokenSocio;
const id = { soci: [], account: [], sala: null, corso: null, evento: null, lezione: null };
const prenotazioneDi = {};

const come = (token, opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });
const reception = (opzioni) => come(tokenReception, opzioni);
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const righe = async () => db.select().from(bookings).where(eq(bookings.sessionId, id.lezione));
const statoDi = async (socio) => (await righe()).find((b) => b.id === prenotazioneDi[socio]);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const soci = await db.insert(members).values(['Uno', 'Due', 'Tre', 'Quattro'].map((n, i) => ({
		nome: n, cognome: 'Prenotazioni', codiceSocio: `PS${'ABCD'[i]}${lettere}`, ...(i === 0 ? { email: emailSocio } : {}),
	}))).returning();
	id.soci = soci.map((s) => s.id);
	await db.insert(subscriptions).values(id.soci.map((s) => ({ memberId: s, planName: 'Prova', startDate: '2026-01-01', endDate: '2099-12-31' })));

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Prenotazioni', email: `pstaff.rec.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Socio Prenotazioni', email: emailSocio, passwordHash, ruolo: 'member', linkedMemberId: id.soci[0] },
	]).returning();
	id.account = account.map((a) => a.id);
	tokenReception = await login(account[0].email);
	tokenSocio = await login(emailSocio);

	const [sala] = await db.insert(rooms).values({ name: `Sala pstaff ${suffisso}` }).returning();
	id.sala = sala.id;
	const [corso] = await db.insert(courses).values({ categoryId: await categoriaDiProva(), name: `Corso pstaff ${suffisso}` }).returning();
	id.corso = corso.id;
	const giorno = spostaGiorni(oggiIso(), 3);
	const [evento] = await db.insert(events).values({
		courseId: corso.id, roomId: sala.id, capacity: 2, recurrenceType: 'single', startDate: giorno, startTime: '18:00', endTime: '19:00',
	}).returning();
	id.evento = evento.id;
	const [lezione] = await db.insert(sessions).values({
		eventId: evento.id, date: giorno, startTime: '18:00', endTime: '19:00', roomId: sala.id, capacity: 2,
	}).returning();
	id.lezione = lezione.id;
});

after(async () => {
	await db.delete(bookings).where(eq(bookings.sessionId, id.lezione));
	await db.delete(sessions).where(eq(sessions.id, id.lezione));
	await db.delete(events).where(eq(events.id, id.evento));
	await db.delete(courses).where(eq(courses.id, id.corso));
	await togliCategorieDiProva();
	await db.delete(rooms).where(eq(rooms.id, id.sala));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, id.soci));
	await db.delete(auditLogs).where(inArray(auditLogs.attoreId, id.account));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, id.soci));
	await app.close();
	await pool.end();
});

describe('la reception prenota per i soci', () => {
	test('due posti: i primi due confermati, gli altri in lista in ordine di arrivo', async () => {
		for (const [i, socio] of id.soci.entries()) {
			const res = await reception({ method: 'POST', url: '/api/prenotazioni', payload: { session_id: id.lezione, member_id: socio } });
			assert.equal(res.statusCode, 201, res.body);
			prenotazioneDi[i] = res.json().booking.id;
		}
		assert.equal((await statoDi(0)).status, 'confirmed');
		assert.equal((await statoDi(1)).status, 'confirmed');
		assert.deepEqual([(await statoDi(2)).waitlistPosition, (await statoDi(3)).waitlistPosition], [1, 2]);
	});

	test('il socio la vede nel suo portale', async () => {
		const giorno = spostaGiorni(oggiIso(), 3);
		const agenda = (await come(tokenSocio, { method: 'GET', url: `/api/member/v1/corsi/agenda?dal=${giorno}&al=${giorno}` })).json();
		const lezione = agenda.giorni.flatMap((g) => g.lezioni).find((l) => l.id === id.lezione);
		assert.equal(lezione.mia_prenotazione.stato, 'confirmed');
	});
});

describe('gli stati', () => {
	test('confermare chi è in lista su una lezione piena si rifiuta, a meno di andare oltre la capienza', async () => {
		const rifiuto = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[3]}/stato`, payload: { stato: 'confirmed' } });
		assert.equal(rifiuto.statusCode, 409);
		assert.equal(rifiuto.json().code, 'lezione_piena');

		const forzata = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[3]}/stato`, payload: { stato: 'confirmed', oltre_capienza: true } });
		assert.equal(forzata.statusCode, 200, forzata.body);
		assert.equal((await statoDi(3)).status, 'confirmed');
		assert.equal((await statoDi(2)).waitlistPosition, 1, 'la lista si rinumera');
		const avvisi = await db.select().from(notifiche).where(and(eq(notifiche.memberId, id.soci[3]), eq(notifiche.tipo, 'promosso_lista_attesa')));
		assert.equal(avvisi.length, 1, 'chi la reception conferma dalla lista lo sa');
		assert.equal(avvisi[0].lezioneId, id.lezione);
	});

	test('rimettere in lista va in coda', async () => {
		const res = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[3]}/stato`, payload: { stato: 'waitlisted' } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal((await statoDi(3)).status, 'waitlisted');
		assert.equal((await statoDi(3)).waitlistPosition, 2);
	});

	test('annullare una confermata libera il posto: si offre al primo in lista', async () => {
		const res = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[1]}/stato`, payload: { stato: 'cancelled' } });
		assert.equal(res.statusCode, 200, res.body);
		assert.deepEqual(res.json().offerti.map((o) => o.id), [prenotazioneDi[2]]);
		assert.equal((await statoDi(1)).status, 'cancelled');
		assert.equal((await statoDi(2)).status, 'waitlisted', 'in lista, con il posto offerto');
		assert.ok((await statoDi(2)).postoOffertoFinoA > new Date());
		assert.equal((await statoDi(3)).waitlistPosition, 2);

		const pagina = (await reception({ method: 'GET', url: `/api/calendario/lezioni/${id.lezione}` })).json();
		assert.ok(pagina.prenotazioni.find((p) => p.id === prenotazioneDi[2]).posto_offerto_fino_a, 'la pagina della lezione lo dice');
	});

	test("riattivare una disdetta la rimette in lista se non c'è posto: il posto offerto conta", async () => {
		const forzare = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[1]}/stato`, payload: { stato: 'confirmed' } });
		assert.equal(forzare.statusCode, 409, 'il posto offerto è occupato');
		const res = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[1]}/stato`, payload: { stato: 'waitlisted' } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal((await statoDi(1)).status, 'waitlisted');
		assert.equal((await statoDi(1)).waitlistPosition, 3);
	});
});

describe("la lista d'attesa", () => {
	test('si riordina', async () => {
		const res = await reception({ method: 'POST', url: `/api/prenotazioni/${prenotazioneDi[1]}/posizione`, payload: { posizione: 1 } });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal((await statoDi(1)).waitlistPosition, 1);
		assert.equal((await statoDi(3)).waitlistPosition, 3);
	});
});

describe('eliminare un errore', () => {
	test('la riga sparisce, e il posto liberato si offre al primo in lista senza offerta', async () => {
		const res = await reception({ method: 'DELETE', url: `/api/prenotazioni/${prenotazioneDi[0]}` });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(await statoDi(0), undefined);
		assert.deepEqual(res.json().offerti.map((o) => o.id), [prenotazioneDi[1]]);
		assert.ok((await statoDi(1)).postoOffertoFinoA, 'il primo della lista');
		assert.ok((await statoDi(2)).postoOffertoFinoA, "e l'offerta di prima resta");
		assert.equal((await statoDi(3)).waitlistPosition, 3);
	});

	test('il socio non può usare le rotte della reception: prenota dal portale', async () => {
		for (const [metodo, url, payload] of [
			['POST', '/api/prenotazioni', { session_id: id.lezione }],
			['POST', `/api/prenotazioni/${prenotazioneDi[3]}/disdici`, undefined],
			['POST', `/api/prenotazioni/${prenotazioneDi[3]}/stato`, { stato: 'confirmed', oltre_capienza: true }],
			['POST', `/api/prenotazioni/${prenotazioneDi[3]}/posizione`, { posizione: 1 }],
			['DELETE', `/api/prenotazioni/${prenotazioneDi[3]}`, undefined],
		]) {
			const res = await come(tokenSocio, { method: metodo, url, payload });
			assert.equal(res.statusCode, 403, `${metodo} ${url}`);
		}
	});
});

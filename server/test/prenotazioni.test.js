// Prenotare e disdire, con le regole applicate dove nessuno può saltarle: la capienza, la lista
// d'attesa con l'offerta di 12 ore e la sua chiusura, il termine di disdetta e i 10 minuti per
// ripensarci (docs/piani/portale.md, D-3).
//
// Prima capienza e lista d'attesa vivevano solo nel browser: contava lui i posti e mandava
// al server una riga con lo stato già dentro, che veniva scritta senza guardare. Bastava
// una richiesta fatta a mano per confermarsi su una lezione piena. Questi controlli girano
// contro le rotte vere.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, rooms, courses, events, sessions, bookings, subscriptions, notifiche } from '../src/db/schema/index.js';
import { prenota as prenotaLib, disdici as disdiciLib, regolaOfferte } from '../src/lib/prenotazioni.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';
import { categoriaDiProva, togliCategorieDiProva } from './categoriaDiProva.js';

const PASSWORD = 'prova-prenotazioni-1234';
const CAPIENZA = 2;

let app;
let tokenStaff;
const tokenSocio = [];
const idSoci = [];
let idSala;
let idCorso;
let idEvento;
let idLezione;

function come(token, opzioni) {
	return app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}`, ...opzioni.headers } });
}

async function pulisciPrenotazioni() {
	if (idLezione) await db.delete(bookings).where(eq(bookings.sessionId, idLezione));
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	// Quattro soci e due posti: serve a vedere cosa succede al terzo e al quarto.
	const soci = await db
		.insert(members)
		.values([1, 2, 3, 4].map((n) => ({ nome: 'Socio', cognome: `${n}`, codiceSocio: `P${'ABCD'[n - 1]}${String(suffisso).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c])}`, email: `socio${n}.pren.${suffisso}@test.local` })))
		.returning();
	idSoci.push(...soci.map((s) => s.id));
	// Si prenota solo con un abbonamento che copre il giorno della lezione (FUN-09): i soci
	// della prova ne hanno uno, tranne dove la prova è proprio quella.
	await db.insert(subscriptions).values(soci.map((s) => ({ memberId: s.id, planName: 'Prova', startDate: '2026-01-01', endDate: '2027-12-31' })));

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Reception Pren', email: `rec.pren.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			...soci.map((s, i) => ({
				nome: `Socio ${i + 1}`,
				email: `socio${i + 1}.pren.${suffisso}@test.local`,
				passwordHash,
				ruolo: 'member',
				linkedMemberId: s.id,
			})),
		])
		.returning();

	const accedi = async (email) => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
		assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
		return res.json().token;
	};
	tokenStaff = await accedi(account[0].email);
	for (const a of account.slice(1)) tokenSocio.push(await accedi(a.email));

	const [sala] = await db.insert(rooms).values({ name: `Sala pren ${suffisso}` }).returning();
	idSala = sala.id;
	const [corso] = await db.insert(courses).values({ categoryId: await categoriaDiProva(), name: `Corso pren ${suffisso}` }).returning();
	idCorso = corso.id;
	const [evento] = await db
		.insert(events)
		.values({
			courseId: corso.id, roomId: sala.id, capacity: CAPIENZA, recurrenceType: 'single',
			startDate: '2026-12-01', startTime: '10:00', endTime: '11:00',
		})
		.returning();
	idEvento = evento.id;
	const [lezione] = await db
		.insert(sessions)
		.values({
			eventId: evento.id, date: '2026-12-01', startTime: '10:00', endTime: '11:00',
			roomId: sala.id, capacity: CAPIENZA,
		})
		.returning();
	idLezione = lezione.id;
});

after(async () => {
	await pulisciPrenotazioni();
	if (idLezione) await db.delete(sessions).where(inArray(sessions.id, [idLezione]));
	if (idEvento) await db.delete(events).where(inArray(events.id, [idEvento]));
	if (idCorso) await db.delete(courses).where(inArray(courses.id, [idCorso]));
	await togliCategorieDiProva();
	if (idSala) await db.delete(rooms).where(inArray(rooms.id, [idSala]));
	if (idSoci.length) await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, idSoci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.nome, ['Reception Pren']));
	if (idSoci.length) await db.delete(subscriptions).where(inArray(subscriptions.memberId, idSoci));
	if (idSoci.length) await db.delete(members).where(inArray(members.id, idSoci));
	await app.close();
	await pool.end();
});

// Il socio prenota e disdice dal portale; la reception dalle sue rotte, per conto di un socio.
const dalPortale = (i, url) => come(tokenSocio[i], { method: 'POST', url: `/api/member/v1${url}` });
async function prenotaSocio(i, lezione = idLezione) {
	const res = await dalPortale(i, `/corsi/lezioni/${lezione}/prenota`);
	const p = res.statusCode < 300 ? res.json().prenotazione : null;
	return { statusCode: res.statusCode, body: res.body, json: () => res.json(), p: p && { id: p.id, status: p.stato, waitlist_position: p.posizione_attesa } };
}
const disdiciSocio = (i, idPrenotazione) => dalPortale(i, `/corsi/prenotazioni/${idPrenotazione}/disdici`);
const prenotaStaff = (memberId, corpo = {}) =>
	come(tokenStaff, { method: 'POST', url: '/api/prenotazioni', payload: { session_id: idLezione, member_id: memberId, ...corpo } });
const righe = () => db.select().from(bookings).where(eq(bookings.sessionId, idLezione));
const perId = async () => new Map((await righe()).map((b) => [b.id, b]));
const ORA = 3_600_000;

describe('la capienza la decide il server', () => {
	test('i primi due entrano, il terzo va in lista', async () => {
		await pulisciPrenotazioni();
		const primo = await prenotaSocio(0);
		const secondo = await prenotaSocio(1);
		const terzo = await prenotaSocio(2);

		assert.equal(primo.p.status, 'confirmed');
		assert.equal(secondo.p.status, 'confirmed');
		assert.equal(terzo.p.status, 'waitlisted');
		assert.equal(terzo.p.waitlist_position, 1);

		const quarto = await prenotaSocio(3);
		assert.equal(quarto.p.waitlist_position, 2, 'la coda si numera in ordine');
	});

	test("chiedere 'confirmed' su una lezione piena non serve a niente", async () => {
		// È l'attacco che il vecchio codice non poteva vedere: la riga arrivava già decisa
		// dal browser, e il server la scriveva così com'era.
		await pulisciPrenotazioni();
		await prenotaSocio(0);
		await prenotaSocio(1);

		const furbo = await prenotaStaff(idSoci[2], { status: 'confirmed', waitlist_position: null });
		assert.equal(furbo.json().booking.status, 'waitlisted', 'lo stato lo decide il conto dei posti');
		assert.equal((await righe()).filter((b) => b.status === 'confirmed').length, CAPIENZA, 'la lezione non supera mai la capienza');
	});

	test("due richieste sull'ultimo posto danno un esito coerente", async () => {
		// ⚠️ Questo test **non dimostra** che il `FOR UPDATE` funzioni: passa anche
		// togliendolo. Due `app.inject` lanciati insieme, contro un database locale veloce,
		// finiscono per serializzarsi da soli, e la corsa non si riproduce. La garanzia sta nel
		// codice, non in questa prova.
		await pulisciPrenotazioni();
		await prenotaSocio(0); // riempie il primo dei due posti

		const [a, b] = await Promise.all([prenotaSocio(1), prenotaSocio(2)]);
		assert.deepEqual([a.p.status, b.p.status].sort(), ['confirmed', 'waitlisted']);
	});

	test('due prenotazioni sulla stessa lezione non si possono avere', async () => {
		await pulisciPrenotazioni();
		await prenotaSocio(0);
		assert.equal((await prenotaSocio(0)).statusCode, 409);
	});

	test('una lezione già passata non si prenota', async () => {
		await pulisciPrenotazioni();
		const [passata] = await db
			.insert(sessions)
			.values({ eventId: idEvento, date: '2020-01-01', startTime: '10:00', endTime: '11:00', roomId: idSala, capacity: 10 })
			.returning();
		assert.equal((await prenotaSocio(0, passata.id)).statusCode, 400);
		await db.delete(sessions).where(eq(sessions.id, passata.id));
	});

	test('il socio prenota solo dal portale: le rotte della reception e il vecchio endpoint gli dicono 403', async () => {
		await pulisciPrenotazioni();
		const sua = (await prenotaSocio(0)).p;
		for (const [method, url, payload] of [
			['POST', '/api/prenotazioni', { session_id: idLezione }],
			['POST', `/api/prenotazioni/${sua.id}/disdici`],
			['POST', '/api/entities/Booking', { session_id: idLezione, member_id: idSoci[0], status: 'confirmed' }],
		]) {
			assert.equal((await come(tokenSocio[0], { method, url, payload })).statusCode, 403, `${method} ${url}`);
		}
	});
});

describe("disdire offre il posto al primo in lista, per 12 ore", () => {
	test('chi disdice un posto confermato lo offre al primo in attesa, che riceve una notifica', async () => {
		await pulisciPrenotazioni();
		await db.delete(notifiche).where(inArray(notifiche.memberId, idSoci));
		const primo = (await prenotaSocio(0)).p;
		await prenotaSocio(1);
		const terzo = (await prenotaSocio(2)).p;
		const quarto = (await prenotaSocio(3)).p;

		const prima = Date.now();
		const res = await disdiciSocio(0, primo.id);
		assert.equal(res.statusCode, 200, res.body);

		const dopo = await perId();
		assert.equal(dopo.get(terzo.id).status, 'waitlisted', 'resta in lista, ma il posto è suo');
		const fino = dopo.get(terzo.id).postoOffertoFinoA.getTime();
		assert.ok(Math.abs(fino - (prima + 12 * ORA)) < 60_000, 'per 12 ore');
		assert.equal(dopo.get(quarto.id).postoOffertoFinoA, null);
		assert.equal(dopo.get(quarto.id).waitlistPosition, 2);

		const [avviso] = await db.select().from(notifiche).where(and(eq(notifiche.memberId, idSoci[2]), eq(notifiche.tipo, 'posto_offerto')));
		assert.ok(avviso, 'la notifica posto_offerto');
		assert.equal(avviso.lezioneId, idLezione);

		// Nel portale: il posto offerto conta come occupato, e per lui c'è la scadenza.
		const agenda = (await come(tokenSocio[2], { method: 'GET', url: '/api/member/v1/corsi/agenda?dal=2026-12-01&al=2026-12-01' })).json();
		const lezione = agenda.giorni[0].lezioni.find((l) => l.id === idLezione);
		assert.equal(lezione.posti.liberi, 0);
		assert.ok(lezione.mia_prenotazione.posto_offerto_fino_a);
	});

	test('confermando, con «prenota», il posto diventa suo', async () => {
		const res = await prenotaSocio(2);
		assert.equal(res.statusCode, 201, res.body);
		assert.equal(res.p.status, 'confirmed');
		const coda = (await righe()).filter((b) => b.status === 'waitlisted');
		assert.deepEqual(coda.map((b) => [b.memberId, b.waitlistPosition]), [[idSoci[3], 1]], 'e la coda scala');
	});

	test('chi rinuncia dalla lista non offre niente a nessuno: nessun posto si libera', async () => {
		await pulisciPrenotazioni();
		await prenotaSocio(0);
		await prenotaSocio(1);
		const terzo = (await prenotaSocio(2)).p;
		const quarto = (await prenotaSocio(3)).p;
		assert.equal((await disdiciSocio(2, terzo.id)).statusCode, 200);
		const dopo = (await perId()).get(quarto.id);
		assert.equal(dopo.postoOffertoFinoA, null);
		assert.equal(dopo.waitlistPosition, 1, 'ma la coda scala');
	});

	test("un'offerta scaduta manda in fondo, e il posto passa al successivo dalla scadenza", async () => {
		await pulisciPrenotazioni();
		const primo = (await prenotaSocio(0)).p;
		await prenotaSocio(1);
		const terzo = (await prenotaSocio(2)).p;
		const quarto = (await prenotaSocio(3)).p;
		await disdiciSocio(0, primo.id);
		// L'offerta al terzo è scaduta un'ora fa: nessuno l'ha confermata.
		const scaduta = new Date(Date.now() - ORA);
		await db.update(bookings).set({ postoOffertoFinoA: scaduta }).where(eq(bookings.id, terzo.id));

		// Leggere l'agenda mette in regola la lista: non serve un processo che guardi.
		await come(tokenSocio[1], { method: 'GET', url: '/api/member/v1/corsi/agenda?dal=2026-12-01&al=2026-12-01' });
		const dopo = await perId();
		assert.equal(dopo.get(terzo.id).postoOffertoFinoA, null);
		assert.equal(dopo.get(terzo.id).waitlistPosition, 2, 'in fondo alla lista');
		assert.equal(dopo.get(quarto.id).waitlistPosition, 1);
		assert.equal(dopo.get(quarto.id).postoOffertoFinoA.getTime(), scaduta.getTime() + 12 * ORA, '12 ore dalla scadenza di prima');
	});

	test('il socio non disdice la prenotazione di un altro', async () => {
		await pulisciPrenotazioni();
		const altrui = (await prenotaSocio(0)).p;
		assert.equal((await disdiciSocio(1, altrui.id)).statusCode, 404);
		assert.equal((await perId()).get(altrui.id).status, 'confirmed', 'resta come stava');
	});

	test('la reception può disdire per conto di un socio', async () => {
		await pulisciPrenotazioni();
		const sua = (await prenotaSocio(0)).p;
		const res = await come(tokenStaff, { method: 'POST', url: `/api/prenotazioni/${sua.id}/disdici` });
		assert.equal(res.statusCode, 200, res.body);
	});
});

// La lezione è l'1 dicembre alle 10, il corso non ha un termine: la lista chiude alle 10 (le 9 UTC).
describe("la chiusura della lista d'attesa", () => {
	const CHIUSURA = new Date('2026-12-01T09:00:00Z');

	test("un'offerta non va oltre la chiusura, e dopo non se ne fanno di nuove", async () => {
		await pulisciPrenotazioni();
		const primo = (await prenotaSocio(0)).p;
		await prenotaSocio(1);
		const terzo = (await prenotaSocio(2)).p;
		const quarto = (await prenotaSocio(3)).p;
		// Due ore prima della chiusura: l'offerta dura due ore, non dodici.
		const esito = await disdiciLib({ bookingId: primo.id, adesso: new Date(CHIUSURA.getTime() - 2 * ORA) });
		assert.equal(esito.offerta?.id, terzo.id);
		assert.equal((await perId()).get(terzo.id).postoOffertoFinoA.getTime(), CHIUSURA.getTime());

		// Dopo la chiusura l'offerta è scaduta: il terzo va in fondo e nessuno riceve il posto.
		await db.transaction((tx) => regolaOfferte(tx, idLezione, new Date(CHIUSURA.getTime() + 60_000)));
		const dopo = await perId();
		assert.equal(dopo.get(terzo.id).postoOffertoFinoA, null);
		assert.equal(dopo.get(quarto.id).postoOffertoFinoA, null, 'la lista è chiusa');
		assert.equal(dopo.get(terzo.id).waitlistPosition, 2);
	});

	test('dopo la chiusura il posto libero è di chi lo prende, anche di chi era in lista; un nuovo non entra in lista', async () => {
		const dopoChiusura = new Date(CHIUSURA.getTime() + 60_000);
		const quarto = (await righe()).find((b) => b.memberId === idSoci[3]);
		const preso = await prenotaLib({ sessionId: idLezione, memberId: idSoci[3], adesso: dopoChiusura });
		assert.equal(preso.creata?.status, 'confirmed', JSON.stringify(preso));
		assert.equal(preso.creata.id, quarto.id, 'la stessa prenotazione, da attesa a confermata');

		// Ora è piena: chi non c'era non entra nemmeno in lista.
		await db.delete(bookings).where(and(eq(bookings.sessionId, idLezione), eq(bookings.memberId, idSoci[0])));
		const fuori = await prenotaLib({ sessionId: idLezione, memberId: idSoci[0], adesso: dopoChiusura });
		assert.equal(fuori.errore, 409);
		assert.equal(fuori.codice, 'lista_chiusa');
	});
});

// Si prenotava anche senza abbonamento. La regola è sul giorno della lezione, non su oggi.
describe('senza un abbonamento quel giorno non si prenota', () => {
	after(async () => {
		await db.update(subscriptions).set({ startDate: '2026-01-01', endDate: '2027-12-31' }).where(eq(subscriptions.memberId, idSoci[0]));
	});

	test('scaduto prima della lezione: rifiutato, dal portale come dalla reception', async () => {
		await pulisciPrenotazioni();
		await db.update(subscriptions).set({ endDate: '2026-11-30' }).where(eq(subscriptions.memberId, idSoci[0]));
		const dalSocio = await prenotaSocio(0);
		assert.equal(dalSocio.statusCode, 400);
		assert.match(dalSocio.json().error, /abbonamento valido/);
		assert.equal((await prenotaStaff(idSoci[0])).statusCode, 400);
	});

	test('che comincia proprio il giorno della lezione: si prenota', async () => {
		await pulisciPrenotazioni();
		await db.update(subscriptions).set({ startDate: '2026-12-01', endDate: '2026-12-31' }).where(eq(subscriptions.memberId, idSoci[0]));
		assert.equal((await prenotaSocio(0)).statusCode, 201);
	});
});

// La promozione esisteva solo nella disdetta: portando una lezione da 2 a 4 posti, chi era in
// lista d'attesa restava lì con due posti vuoti davanti. Ora il posto nuovo si offre.
describe("una capienza che cresce offre i posti alla lista d'attesa", () => {
	after(async () => {
		await db.update(sessions).set({ capacity: CAPIENZA }).where(eq(sessions.id, idLezione));
	});

	test('si offrono in ordine quanti ce ne stanno', async () => {
		await pulisciPrenotazioni();
		for (const i of [0, 1, 2, 3]) assert.equal((await prenotaSocio(i)).statusCode, 201);
		// Due confermati, due in attesa (posizioni 1 e 2).
		const res = await come(tokenStaff, { method: 'PUT', url: `/api/entities/Session/${idLezione}`, payload: { capacity: CAPIENZA + 1, modified_manually: true } });
		assert.equal(res.statusCode, 200, res.body);

		const perSocio = Object.fromEntries((await righe()).map((r) => [r.memberId, r]));
		assert.ok(perSocio[idSoci[2]].postoOffertoFinoA, 'il primo in attesa riceve il posto');
		assert.equal(perSocio[idSoci[3]].postoOffertoFinoA, null);
		assert.equal(perSocio[idSoci[3]].waitlistPosition, 2);
	});
});

// Il calendario del gestionale caricava "le 500 lezioni con la data più alta" e "le 500
// prenotazioni create per ultime": con un anno di corsi settimanali il mese corrente usciva
// dalla lista. Ora chiede un intervallo.
describe('il calendario chiede un intervallo, non un numero fisso', () => {
	test('le lezioni si filtrano da una data in avanti', async () => {
		const dopo = (await come(tokenStaff, { method: 'GET', url: `/api/entities/Session?event_id=${idEvento}&date__gte=2026-11-30` })).json();
		assert.deepEqual(dopo.map((l) => l.id), [idLezione]);
		const prima = (await come(tokenStaff, { method: 'GET', url: `/api/entities/Session?event_id=${idEvento}&date__lte=2026-11-30` })).json();
		assert.deepEqual(prima, []);
	});

	// Le prenotazioni non si scaricano più tutte: il calendario riceve le lezioni con i posti già
	// contati (GET /api/calendario/lezioni), e la vecchia rotta non c'è più.
	test('le lezioni di un intervallo arrivano con i posti contati', async () => {
		await pulisciPrenotazioni();
		assert.equal((await prenotaSocio(0)).statusCode, 201);
		const dentro = (await come(tokenStaff, { method: 'GET', url: '/api/calendario/lezioni?dal=2026-11-30&al=2026-12-02' })).json().lezioni;
		assert.equal(dentro.find((l) => l.id === idLezione)?.confermati, 1);
		const fuori = (await come(tokenStaff, { method: 'GET', url: '/api/calendario/lezioni?dal=2026-12-02&al=2026-12-10' })).json().lezioni;
		assert.ok(!fuori.some((l) => l.id === idLezione));
	});

	test("senza intervallo, o da un socio, non si leggono; la rotta delle prenotazioni per data non c'è più", async () => {
		assert.equal((await come(tokenStaff, { method: 'GET', url: '/api/calendario/lezioni' })).statusCode, 400);
		assert.equal((await come(tokenSocio[0], { method: 'GET', url: '/api/calendario/lezioni?dal=2026-01-01&al=2026-01-02' })).statusCode, 403);
		assert.equal((await come(tokenStaff, { method: 'GET', url: '/api/prenotazioni?dal=2026-11-30' })).statusCode, 404);
	});
});

// Il termine di disdetta sta sul corso e vale per il socio che disdice da sé: oltre, la
// prenotazione resta, e la reception può ancora disdirla. Tranne nei primi 10 minuti dopo
// averla fatta: è l'«Annulla» del tocco sbagliato.
describe('il termine di disdetta del corso', () => {
	test('oltre il termine il socio non disdice (tranne nei primi 10 minuti), la reception sì; senza termine si disdice', async () => {
		const tra2Giorni = spostaGiorni(oggiIso(), 2);
		const [corso] = await db.insert(courses).values({ categoryId: await categoriaDiProva(), name: `Corso termine ${Date.now()}`, disdettaEntroOre: 72 }).returning();
		const [evento] = await db.insert(events).values({
			courseId: corso.id, roomId: idSala, capacity: 5, recurrenceType: 'single', startDate: tra2Giorni, startTime: '18:00', endTime: '19:00',
		}).returning();
		const [lezione] = await db.insert(sessions).values({
			eventId: evento.id, date: tra2Giorni, startTime: '18:00', endTime: '19:00', roomId: idSala, capacity: 5,
		}).returning();
		try {
			// Appena fatta: si annulla anche oltre il termine.
			const appena = await prenotaSocio(0, lezione.id);
			assert.equal(appena.statusCode, 201, appena.body);
			assert.equal((await disdiciSocio(0, appena.p.id)).statusCode, 200, 'nei primi 10 minuti sì');

			const pren = await prenotaStaff(idSoci[0], { session_id: lezione.id });
			assert.equal(pren.statusCode, 201, pren.body);
			const idPren = pren.json().booking.id;
			await db.update(bookings).set({ createdDate: new Date(Date.now() - 11 * 60_000) }).where(eq(bookings.id, idPren));

			const rifiutata = await disdiciSocio(0, idPren);
			assert.equal(rifiutata.statusCode, 400);
			assert.match(rifiutata.json().error, /72 ore prima.*reception/);
			assert.equal((await come(tokenStaff, { method: 'POST', url: `/api/prenotazioni/${idPren}/disdici` })).statusCode, 200);

			// Tolto il termine, il socio torna a disdire fino alla fine.
			await db.update(courses).set({ disdettaEntroOre: null }).where(eq(courses.id, corso.id));
			const di_nuovo = await prenotaSocio(1, lezione.id);
			await db.update(bookings).set({ createdDate: new Date(Date.now() - 11 * 60_000) }).where(eq(bookings.id, di_nuovo.p.id));
			assert.equal((await disdiciSocio(1, di_nuovo.p.id)).statusCode, 200);
		} finally {
			await db.delete(bookings).where(eq(bookings.sessionId, lezione.id));
			await db.delete(sessions).where(eq(sessions.id, lezione.id));
			await db.delete(events).where(eq(events.id, evento.id));
			await db.delete(courses).where(eq(courses.id, corso.id));
		}
	});

	test('il termine si imposta sul corso fra 0 e 168 ore', async () => {
		const ok = await come(tokenStaff, { method: 'PUT', url: `/api/entities/Course/${idCorso}`, payload: { disdetta_entro_ore: 12 } });
		assert.equal(ok.statusCode, 200, ok.body);
		assert.equal(ok.json().disdetta_entro_ore, 12);
		assert.equal((await come(tokenStaff, { method: 'PUT', url: `/api/entities/Course/${idCorso}`, payload: { disdetta_entro_ore: 200 } })).statusCode, 400);
		const vuoto = await come(tokenStaff, { method: 'PUT', url: `/api/entities/Course/${idCorso}`, payload: { disdetta_entro_ore: '' } });
		assert.equal(vuoto.json().disdetta_entro_ore, null);
	});
});

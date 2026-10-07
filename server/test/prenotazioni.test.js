// Prenotare e disdire, con le regole applicate dove nessuno può saltarle.
//
// Prima capienza e lista d'attesa vivevano solo nel browser: contava lui i posti e mandava
// al server una riga con lo stato già dentro, che veniva scritta senza guardare. Bastava
// una richiesta fatta a mano per confermarsi su una lezione piena. Questi controlli girano
// contro le rotte vere.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { members, staffAccounts, rooms, courses, events, sessions, bookings, subscriptions } from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

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
	const [corso] = await db.insert(courses).values({ name: `Corso pren ${suffisso}` }).returning();
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
	if (idSala) await db.delete(rooms).where(inArray(rooms.id, [idSala]));
	if (idSoci.length) await db.delete(staffAccounts).where(inArray(staffAccounts.linkedMemberId, idSoci));
	await db.delete(staffAccounts).where(inArray(staffAccounts.nome, ['Reception Pren']));
	if (idSoci.length) await db.delete(subscriptions).where(inArray(subscriptions.memberId, idSoci));
	if (idSoci.length) await db.delete(members).where(inArray(members.id, idSoci));
	await app.close();
	await pool.end();
});

const prenota = (token, corpo = {}) =>
	come(token, { method: 'POST', url: '/api/prenotazioni', payload: { session_id: idLezione, ...corpo } });

describe('la capienza la decide il server', () => {
	test('i primi due entrano, il terzo va in lista', async () => {
		await pulisciPrenotazioni();
		const primo = await prenota(tokenSocio[0]);
		const secondo = await prenota(tokenSocio[1]);
		const terzo = await prenota(tokenSocio[2]);

		assert.equal(primo.json().booking.status, 'confirmed');
		assert.equal(secondo.json().booking.status, 'confirmed');
		assert.equal(terzo.json().booking.status, 'waitlisted');
		assert.equal(terzo.json().booking.waitlist_position, 1);

		const quarto = await prenota(tokenSocio[3]);
		assert.equal(quarto.json().booking.waitlist_position, 2, 'la coda si numera in ordine');
	});

	test("chiedere 'confirmed' su una lezione piena non serve a niente", async () => {
		// È l'attacco che il vecchio codice non poteva vedere: la riga arrivava già decisa
		// dal browser, e il server la scriveva così com'era.
		await pulisciPrenotazioni();
		await prenota(tokenSocio[0]);
		await prenota(tokenSocio[1]);

		const furbo = await come(tokenSocio[2], {
			method: 'POST',
			url: '/api/prenotazioni',
			payload: { session_id: idLezione, status: 'confirmed', waitlist_position: null },
		});
		assert.equal(furbo.json().booking.status, 'waitlisted', 'lo stato lo decide il conto dei posti');

		const confermate = await db
			.select()
			.from(bookings)
			.where(eq(bookings.sessionId, idLezione));
		assert.equal(
			confermate.filter((b) => b.status === 'confirmed').length,
			CAPIENZA,
			'la lezione non supera mai la capienza',
		);
	});

	test("due richieste sull'ultimo posto danno un esito coerente", async () => {
		// ⚠️ Questo test **non dimostra** che il `FOR UPDATE` funzioni: passa anche
		// togliendolo. Due `app.inject` lanciati insieme, contro un database locale veloce,
		// finiscono per serializzarsi da soli, e la corsa non si riproduce.
		//
		// Il blocco resta perché la corsa è reale altrove — più richieste in volo su un
		// database più lento, o due repliche del server che non si parlano — e lì
		// l'alternativa è una lezione con un iscritto di troppo. Ma la garanzia sta nel
		// codice, non in questa prova: se un giorno qualcuno toglie il `.for('update')`,
		// non sarà questo test a fermarlo.
		await pulisciPrenotazioni();
		await prenota(tokenSocio[0]); // riempie il primo dei due posti

		const [a, b] = await Promise.all([prenota(tokenSocio[1]), prenota(tokenSocio[2])]);
		const stati = [a.json().booking.status, b.json().booking.status].sort();
		assert.deepEqual(stati, ['confirmed', 'waitlisted']);
	});

	test('due prenotazioni sulla stessa lezione non si possono avere', async () => {
		await pulisciPrenotazioni();
		await prenota(tokenSocio[0]);
		const doppia = await prenota(tokenSocio[0]);
		assert.equal(doppia.statusCode, 409);
	});

	test('un socio non prenota a nome di un altro', async () => {
		await pulisciPrenotazioni();
		const res = await prenota(tokenSocio[0], { member_id: idSoci[1] });
		assert.equal(res.statusCode, 201);
		assert.equal(res.json().booking.member_id, idSoci[0], "l'intestatario lo impone il server");
	});

	test('una lezione già passata non si prenota', async () => {
		await pulisciPrenotazioni();
		const [passata] = await db
			.insert(sessions)
			.values({
				eventId: idEvento, date: '2020-01-01', startTime: '10:00', endTime: '11:00',
				roomId: idSala, capacity: 10,
			})
			.returning();
		const res = await come(tokenSocio[0], {
			method: 'POST',
			url: '/api/prenotazioni',
			payload: { session_id: passata.id },
		});
		assert.equal(res.statusCode, 400);
		await db.delete(sessions).where(eq(sessions.id, passata.id));
	});

	test('dal vecchio endpoint generico un socio non ci arriva più', async () => {
		const res = await come(tokenSocio[0], {
			method: 'POST',
			url: '/api/entities/Booking',
			payload: { session_id: idLezione, member_id: idSoci[0], status: 'confirmed' },
		});
		assert.equal(res.statusCode, 403, 'la scorciatoia che saltava il conto dei posti è chiusa');
	});
});

describe('disdire sistema la lista', () => {
	test('chi disdice un posto confermato promuove il primo in attesa', async () => {
		await pulisciPrenotazioni();
		const primo = (await prenota(tokenSocio[0])).json().booking;
		await prenota(tokenSocio[1]);
		const terzo = (await prenota(tokenSocio[2])).json().booking;
		const quarto = (await prenota(tokenSocio[3])).json().booking;

		const res = await come(tokenSocio[0], { method: 'POST', url: `/api/prenotazioni/${primo.id}/disdici` });
		assert.equal(res.statusCode, 200);
		assert.equal(res.json().promoted, true);

		const dopo = await db.select().from(bookings).where(eq(bookings.sessionId, idLezione));
		const perId = new Map(dopo.map((b) => [b.id, b]));
		assert.equal(perId.get(terzo.id).status, 'confirmed', 'il primo della coda entra');
		assert.equal(perId.get(quarto.id).status, 'waitlisted');
		assert.equal(perId.get(quarto.id).waitlistPosition, 1, 'e la coda si rinumera');
	});

	test('chi rinuncia dalla lista non promuove nessuno: nessun posto si libera', async () => {
		await pulisciPrenotazioni();
		await prenota(tokenSocio[0]);
		await prenota(tokenSocio[1]);
		const terzo = (await prenota(tokenSocio[2])).json().booking;
		const quarto = (await prenota(tokenSocio[3])).json().booking;

		const res = await come(tokenSocio[2], { method: 'POST', url: `/api/prenotazioni/${terzo.id}/disdici` });
		assert.equal(res.json().promoted, false);

		const dopo = await db.select().from(bookings).where(eq(bookings.id, quarto.id));
		assert.equal(dopo[0].status, 'waitlisted');
		assert.equal(dopo[0].waitlistPosition, 1, 'ma la coda scala');
	});

	test('un socio non disdice la prenotazione di un altro', async () => {
		await pulisciPrenotazioni();
		const altrui = (await prenota(tokenSocio[0])).json().booking;
		const res = await come(tokenSocio[1], { method: 'POST', url: `/api/prenotazioni/${altrui.id}/disdici` });
		assert.equal(res.statusCode, 404);

		const dopo = await db.select().from(bookings).where(eq(bookings.id, altrui.id));
		assert.equal(dopo[0].status, 'confirmed', 'resta come stava');
	});

	test('la reception può disdire per conto di un socio', async () => {
		await pulisciPrenotazioni();
		const sua = (await prenota(tokenSocio[0])).json().booking;
		const res = await come(tokenStaff, { method: 'POST', url: `/api/prenotazioni/${sua.id}/disdici` });
		assert.equal(res.statusCode, 200);
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
		const dalSocio = await prenota(tokenSocio[0]);
		assert.equal(dalSocio.statusCode, 400);
		assert.match(dalSocio.json().error, /abbonamento valido/);
		assert.equal((await prenota(tokenStaff, { member_id: idSoci[0] })).statusCode, 400);
	});

	test('che comincia proprio il giorno della lezione: si prenota', async () => {
		await pulisciPrenotazioni();
		await db.update(subscriptions).set({ startDate: '2026-12-01', endDate: '2026-12-31' }).where(eq(subscriptions.memberId, idSoci[0]));
		assert.equal((await prenota(tokenSocio[0])).statusCode, 201);
	});
});

// La promozione esisteva solo nella disdetta: portando una lezione da 2 a 4 posti, chi era in
// lista d'attesa restava lì con due posti vuoti davanti.
describe('una capienza che cresce promuove la lista d’attesa', () => {
	after(async () => {
		await db.update(sessions).set({ capacity: CAPIENZA }).where(eq(sessions.id, idLezione));
	});

	test('entrano in ordine quanti ci stanno, e la coda si rinumera', async () => {
		await pulisciPrenotazioni();
		for (const token of tokenSocio) assert.equal((await prenota(token)).statusCode, 201);
		// Due confermati, due in attesa (posizioni 1 e 2).
		const res = await come(tokenStaff, { method: 'PUT', url: `/api/entities/Session/${idLezione}`, payload: { capacity: CAPIENZA + 1, modified_manually: true } });
		assert.equal(res.statusCode, 200, res.body);

		const righe = await db.select().from(bookings).where(eq(bookings.sessionId, idLezione));
		const perSocio = Object.fromEntries(righe.map((r) => [r.memberId, r]));
		assert.equal(perSocio[idSoci[2]].status, 'confirmed', 'il primo in attesa entra');
		assert.equal(perSocio[idSoci[3]].status, 'waitlisted');
		assert.equal(perSocio[idSoci[3]].waitlistPosition, 1, 'e chi resta sale al primo posto della coda');
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

	test('le prenotazioni si chiedono per data della lezione', async () => {
		await pulisciPrenotazioni();
		assert.equal((await prenota(tokenSocio[0])).statusCode, 201);
		const dal = (await come(tokenStaff, { method: 'GET', url: '/api/prenotazioni?dal=2026-11-30' })).json();
		assert.ok(dal.some((p) => p.session_id === idLezione));
		const dopo = (await come(tokenStaff, { method: 'GET', url: '/api/prenotazioni?dal=2026-12-02' })).json();
		assert.ok(!dopo.some((p) => p.session_id === idLezione));
	});

	test('senza data, o da un socio, non si leggono', async () => {
		assert.equal((await come(tokenStaff, { method: 'GET', url: '/api/prenotazioni' })).statusCode, 400);
		assert.equal((await come(tokenSocio[0], { method: 'GET', url: '/api/prenotazioni?dal=2026-01-01' })).statusCode, 403);
	});
});

// Il termine di disdetta sta sul corso e vale per il socio che disdice da sé: oltre, la
// prenotazione resta, e la reception può ancora disdirla.
describe('il termine di disdetta del corso', () => {
	test('oltre il termine il socio non disdice, la reception sì; senza termine si disdice', async () => {
		const tra2Giorni = spostaGiorni(oggiIso(), 2);
		const [corso] = await db.insert(courses).values({ name: `Corso termine ${Date.now()}`, disdettaEntroOre: 72 }).returning();
		const [evento] = await db.insert(events).values({
			courseId: corso.id, roomId: idSala, capacity: 5, recurrenceType: 'single', startDate: tra2Giorni, startTime: '18:00', endTime: '19:00',
		}).returning();
		const [lezione] = await db.insert(sessions).values({
			eventId: evento.id, date: tra2Giorni, startTime: '18:00', endTime: '19:00', roomId: idSala, capacity: 5,
		}).returning();
		try {
			const pren = await come(tokenSocio[0], { method: 'POST', url: '/api/prenotazioni', payload: { session_id: lezione.id } });
			assert.equal(pren.statusCode, 201, pren.body);
			const idPren = pren.json().booking.id;

			const rifiutata = await come(tokenSocio[0], { method: 'POST', url: `/api/prenotazioni/${idPren}/disdici` });
			assert.equal(rifiutata.statusCode, 400);
			assert.match(rifiutata.json().error, /72 ore prima.*reception/);
			// Lo stesso dal portale.
			const portale = await come(tokenSocio[0], { method: 'POST', url: `/api/member/v1/corsi/prenotazioni/${idPren}/disdici` });
			assert.equal(portale.statusCode, 400);

			assert.equal((await come(tokenStaff, { method: 'POST', url: `/api/prenotazioni/${idPren}/disdici` })).statusCode, 200);

			// Tolto il termine, il socio torna a disdire fino alla fine.
			await db.update(courses).set({ disdettaEntroOre: null }).where(eq(courses.id, corso.id));
			const di_nuovo = await come(tokenSocio[1], { method: 'POST', url: '/api/prenotazioni', payload: { session_id: lezione.id } });
			assert.equal((await come(tokenSocio[1], { method: 'POST', url: `/api/prenotazioni/${di_nuovo.json().booking.id}/disdici` })).statusCode, 200);
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

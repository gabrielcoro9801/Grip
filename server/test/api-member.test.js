// L'API del portale soci: /api/member/v1/*
//
// È la superficie che un giorno reggerà un'app installata sul telefono di qualcuno — cioè un
// client che non si aggiorna a comando e che nessuno può correggere da qui. Due cose vanno
// quindi provate contro le rotte vere, non ragionate a mente:
//
//   1. il confine — un token dello staff non entra, un socio vede solo le proprie cose;
//   2. la forma della risposta — perché è il contratto, e un campo che sparisce rompe le
//      installazioni che non hanno aggiornato.
//
// Il test si costruisce i propri soci e i propri account e li cancella alla fine: non dipende
// da com'è popolato il database in cui gira.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, subscriptions, memberDocuments, qrAccessi,
	rooms, courses, events, sessions, bookings, workoutSessions, workoutLogs,
} from '../src/db/schema/index.js';

const PASSWORD = 'prova-api-member-1234';

let app;
let tokenSocio;
let tokenAdmin;
let idSocio;
let idEstraneo;
const idAccount = [];
const idAbbonamenti = [];
const idDocumenti = [];
const idQr = [];
const idPrenotazioni = [];
let idSala;
let idCorso;
let idEvento;
let idLezione;

const oggi = new Date().toISOString().split('T')[0];
const fraUnaSettimana = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

async function login(email) {
	const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
	assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
	return res.json().token;
}

function come(token, url) {
	return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();

	const suffisso = Date.now();
	const [socio, estraneo] = await db
		.insert(members)
		.values([
			{ fullName: 'Socio API', email: `socio.api.${suffisso}@test.local`, codiceSocio: '009901', phone: '333' },
			{ fullName: 'Estraneo API', email: `estraneo.api.${suffisso}@test.local` },
		])
		.returning();
	idSocio = socio.id;
	idEstraneo = estraneo.id;

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Socio API', email: `socio.api.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: socio.id },
			{ nome: 'Admin API', email: `admin.api.${suffisso}@test.local`, passwordHash, ruolo: 'admin' },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	// Un abbonamento a testa: senza quello dell'estraneo un filtro rotto sembrerebbe
	// funzionare, perché non ci sarebbe niente da nascondere.
	const abbonamenti = await db
		.insert(subscriptions)
		.values([
			{ memberId: socio.id, planName: 'Open 12 mesi', startDate: oggi, endDate: fraUnaSettimana, status: 'active' },
			{ memberId: estraneo.id, planName: "Abbonamento dell'estraneo", startDate: oggi, status: 'active' },
		])
		.returning();
	idAbbonamenti.push(...abbonamenti.map((a) => a.id));

	const documenti = await db
		.insert(memberDocuments)
		.values([
			{ memberId: socio.id, documentType: 'Certificato medico', fileName: 'certificato.pdf', expiryDate: fraUnaSettimana },
			{ memberId: estraneo.id, documentType: "Documento dell'estraneo", fileName: 'altro.pdf' },
		])
		.returning();
	idDocumenti.push(...documenti.map((d) => d.id));

	const qr = await db
		.insert(qrAccessi)
		.values([
			{ clienteId: socio.id, clienteName: 'Socio API', codice: `GRIP-TEST-APIM-${suffisso}`.slice(0, 60), stato: 'attivo' },
		])
		.returning();
	idQr.push(...qr.map((q) => q.id));

	// Una lezione con due prenotazioni: la mia e quella di un altro. Serve a verificare che
	// dei posti escano numeri e non le righe altrui.
	const [sala] = await db.insert(rooms).values({ name: 'Sala API', capacity: 10 }).returning();
	idSala = sala.id;
	const [corso] = await db.insert(courses).values({ name: 'Corso API' }).returning();
	idCorso = corso.id;
	const [evento] = await db
		.insert(events)
		.values({ courseId: corso.id, roomId: sala.id, capacity: 2, recurrenceType: 'single', startDate: fraUnaSettimana, startTime: '18:30', endTime: '19:30' })
		.returning();
	idEvento = evento.id;
	const [lezione] = await db
		.insert(sessions)
		.values({ eventId: evento.id, date: fraUnaSettimana, startTime: '18:30', endTime: '19:30', roomId: sala.id, capacity: 2, status: 'active' })
		.returning();
	idLezione = lezione.id;

	const prenotate = await db
		.insert(bookings)
		.values([
			{ sessionId: lezione.id, memberId: socio.id, memberName: 'Socio API', status: 'confirmed' },
			{ sessionId: lezione.id, memberId: estraneo.id, memberName: 'Estraneo API', status: 'confirmed' },
		])
		.returning();
	idPrenotazioni.push(...prenotate.map((p) => p.id));

	tokenSocio = await login(`socio.api.${suffisso}@test.local`);
	tokenAdmin = await login(`admin.api.${suffisso}@test.local`);
});

after(async () => {
	if (idPrenotazioni.length) await db.delete(bookings).where(inArray(bookings.id, idPrenotazioni));
	if (idLezione) await db.delete(sessions).where(inArray(sessions.id, [idLezione]));
	if (idEvento) await db.delete(events).where(inArray(events.id, [idEvento]));
	if (idCorso) await db.delete(courses).where(inArray(courses.id, [idCorso]));
	if (idSala) await db.delete(rooms).where(inArray(rooms.id, [idSala]));
	if (idQr.length) await db.delete(qrAccessi).where(inArray(qrAccessi.id, idQr));
	if (idDocumenti.length) await db.delete(memberDocuments).where(inArray(memberDocuments.id, idDocumenti));
	if (idAbbonamenti.length) await db.delete(subscriptions).where(inArray(subscriptions.id, idAbbonamenti));
	if (idAccount.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await db.delete(members).where(inArray(members.id, [idSocio, idEstraneo]));
	await app.close();
	await pool.end();
});

const ROTTE = ['/api/member/v1/profilo', '/api/member/v1/abbonamenti', '/api/member/v1/documenti', '/api/member/v1/accesso', '/api/member/v1/corsi/agenda'];

describe('chi può entrare', () => {
	for (const rotta of ROTTE) {
		test(`senza token: 401 su ${rotta}`, async () => {
			assert.equal((await app.inject({ method: 'GET', url: rotta })).statusCode, 401);
		});

		// Non è una restrizione per pignoleria: due contratti per le stesse cose sono due
		// contratti da mantenere, e questa superficie deve poter cambiare al ritmo dell'app.
		test(`con un token dello staff: 403 su ${rotta}`, async () => {
			const res = await come(tokenAdmin, rotta);
			assert.equal(res.statusCode, 403, res.body);
		});

		test(`con un token di socio: 200 su ${rotta}`, async () => {
			assert.equal((await come(tokenSocio, rotta)).statusCode, 200);
		});
	}
});

describe('il socio vede le proprie cose, e solo quelle', () => {
	test('il profilo è il suo', async () => {
		const dati = (await come(tokenSocio, '/api/member/v1/profilo')).json();

		assert.equal(dati.socio.id, idSocio);
		assert.equal(dati.socio.nome, 'Socio API');
		assert.equal(dati.abbonamento.piano, 'Open 12 mesi');
	});

	test("i giorni alla scadenza li conta il server, non il browser", async () => {
		const dati = (await come(tokenSocio, '/api/member/v1/profilo')).json();

		assert.equal(dati.abbonamento.giorni_alla_scadenza, 7);
		assert.equal(dati.abbonamento.in_scadenza, true, 'a sette giorni deve risultare in scadenza');
		assert.equal(dati.documenti.in_scadenza, 1);
		assert.equal(dati.documenti.scaduti, 0);
	});

	test("gli abbonamenti dell'estraneo non compaiono", async () => {
		const { abbonamenti } = (await come(tokenSocio, '/api/member/v1/abbonamenti')).json();

		assert.equal(abbonamenti.length, 1);
		assert.equal(abbonamenti[0].piano, 'Open 12 mesi');
	});

	test("i documenti dell'estraneo non compaiono", async () => {
		const { documenti } = (await come(tokenSocio, '/api/member/v1/documenti')).json();

		assert.equal(documenti.length, 1);
		assert.equal(documenti[0].tipo, 'Certificato medico');
		assert.equal(documenti[0].scaduto, false);
		assert.equal(documenti[0].in_scadenza, true);
	});

	test('il codice di accesso arriva firmato dal server', async () => {
		const dati = (await come(tokenSocio, '/api/member/v1/accesso')).json();

		assert.equal(dati.attivo, true);
		assert.ok(dati.codice, 'doveva arrivare un codice');

		// Il seme **compare** nel codice, ed è voluto: è un identificativo, come un nome
		// utente. Quello che non si può indovinare è la firma che gli viene aggiunta, che
		// dipende da una chiave che dal server non esce e cambia ogni minuto. Quindi il
		// controllo giusto non è "il seme non c'è", ma "al seme è stato aggiunto qualcosa".
		const [seme] = await db.select({ codice: qrAccessi.codice }).from(qrAccessi).where(inArray(qrAccessi.id, idQr));
		assert.ok(String(dati.codice).startsWith(seme.codice), 'il codice deve partire dal seme');
		assert.ok(dati.codice.length > seme.codice.length + 1, 'al seme deve essere aggiunta una firma');
		assert.notEqual(dati.codice, seme.codice, 'è uscito il seme nudo, senza firma');

		assert.ok(dati.valido_per_ms > 0 && dati.valido_per_ms <= 60_000);
	});
});

describe("l'agenda dei corsi", () => {
	test('la lezione compare, con i posti contati dal server', async () => {
		const dati = (await come(tokenSocio, `/api/member/v1/corsi/agenda?dal=${oggi}&al=${fraUnaSettimana}`)).json();

		const lezioni = dati.giorni.flatMap((g) => g.lezioni);
		const mia = lezioni.find((l) => l.id === idLezione);
		assert.ok(mia, 'la lezione creata dal test doveva esserci');

		assert.equal(mia.posti.capienza, 2);
		assert.equal(mia.posti.confermati, 2);
		assert.equal(mia.posti.liberi, 0);
		assert.equal(mia.posti.al_completo, true);
		assert.equal(mia.corso.nome, 'Corso API');
		assert.equal(mia.sala.nome, 'Sala API');
	});

	test('la mia prenotazione c\'è, quella degli altri no', async () => {
		const dati = (await come(tokenSocio, `/api/member/v1/corsi/agenda?dal=${oggi}&al=${fraUnaSettimana}`)).json();
		const mia = dati.giorni.flatMap((g) => g.lezioni).find((l) => l.id === idLezione);

		assert.equal(mia.mia_prenotazione.stato, 'confirmed');

		// Il punto della rotta: prima il portale si scaricava fino a cinquecento prenotazioni
		// di tutti i soci per contare i posti. Chi frequenta cosa non deve uscire da qui.
		const testo = JSON.stringify(dati);
		assert.ok(!testo.includes(idEstraneo), "l'identificativo di un altro socio è finito nella risposta");
		assert.ok(!testo.includes('Estraneo API'), 'il nome di un altro socio è finito nella risposta');
	});

	test('fuori dall\'intervallo richiesto non arriva niente', async () => {
		const ieri = new Date(Date.now() - 86400000).toISOString().split('T')[0];
		const dati = (await come(tokenSocio, `/api/member/v1/corsi/agenda?dal=${ieri}&al=${ieri}`)).json();

		assert.equal(dati.giorni.flatMap((g) => g.lezioni).find((l) => l.id === idLezione), undefined);
	});
});

describe('prenotare e disdire dal portale', () => {
	const posta = (token, url, payload) =>
		app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } });

	test('un token dello staff non entra nemmeno in scrittura', async () => {
		const res = await posta(tokenAdmin, `/api/member/v1/corsi/lezioni/${idLezione}/prenota`, {});
		assert.equal(res.statusCode, 403, res.body);
	});

	test('su una lezione al completo si finisce in lista d\'attesa, non in errore', async () => {
		// La lezione del test ha due posti e due confermati: è piena.
		const res = await posta(tokenSocio, `/api/member/v1/corsi/lezioni/${idLezione}/prenota`, {});

		// Il socio ha già una prenotazione su questa lezione: la regola condivisa con il
		// gestionale risponde 409, ed è giusto così.
		assert.equal(res.statusCode, 409, res.body);
	});

	test('non si disdice la prenotazione di un altro, e si risponde "non trovata"', async () => {
		const dellEstraneo = idPrenotazioni[1];
		const res = await posta(tokenSocio, `/api/member/v1/corsi/prenotazioni/${dellEstraneo}/disdici`, {});

		assert.equal(res.statusCode, 404, res.body);

		// E deve essere ancora lì: un 404 che nasconde una cancellazione sarebbe peggio del problema.
		const [ancora] = await db.select().from(bookings).where(inArray(bookings.id, [dellEstraneo]));
		assert.equal(ancora.status, 'confirmed');
	});
});

describe("l'allenamento", () => {
	let idSessione;
	let idSerie;

	test('lo storico arriva con i conti già fatti', async () => {
		const [sessione] = await db
			.insert(workoutSessions)
			.values({
				memberId: idSocio, planName: 'Forza A', routineIndex: 0, routineName: 'Giorno 1',
				iniziataAlle: new Date(Date.now() - 3600000), terminataAlle: new Date(),
			})
			.returning();
		idSessione = sessione.id;

		const [serie] = await db
			.insert(workoutLogs)
			.values({
				memberId: idSocio, sessionId: sessione.id, exerciseIndex: 0, setIndex: 0,
				exerciseName: 'Panca piana', tipoSerie: 'normale', pesoUsato: '80', repsFatte: 8, data: oggi,
			})
			.returning();
		idSerie = serie.id;

		const dati = (await come(tokenSocio, '/api/member/v1/allenamento')).json();

		assert.ok(Array.isArray(dati.storico));
		assert.ok(dati.storico.some((s) => s.id === idSessione));
		assert.equal(dati.sessione_in_corso, null);

		// I conti li fa il server con le stesse funzioni delle pagine: qui si verifica che
		// arrivino fatti, non che il client debba rifarli.
		assert.equal(typeof dati.settimana?.questaSettimana, 'number');

		// I record vanno controllati per **contenuto**, non per presenza. La funzione di
		// dominio restituisce una Map, e una Map che finisce in JSON diventa `{}`: un
		// controllo di verità la lascerebbe passare, perché anche `{}` è vero. È successo.
		assert.ok(Array.isArray(dati.record), 'i record devono essere una lista, non una Map svuotata dal JSON');
		const panca = dati.record.find((r) => r.nome === 'Panca piana');
		assert.ok(panca, 'il record della panca doveva esserci');
		assert.equal(panca.migliore.peso, 80);
		assert.equal(panca.migliore.reps, 8);
	});

	test("l'allenamento di un altro socio non si apre", async () => {
		const [altrui] = await db
			.insert(workoutSessions)
			.values({ memberId: idEstraneo, planName: "Scheda dell'estraneo", iniziataAlle: new Date() })
			.returning();

		const res = await come(tokenSocio, `/api/member/v1/allenamento/sessioni/${altrui.id}`);
		assert.equal(res.statusCode, 404, res.body);

		await db.delete(workoutSessions).where(inArray(workoutSessions.id, [altrui.id]));
	});

	test('una sessione si apre con le serie già spuntate', async () => {
		const dati = (await come(tokenSocio, `/api/member/v1/allenamento/sessioni/${idSessione}`)).json();

		assert.equal(dati.sessione.id, idSessione);
		assert.equal(dati.registrate.length, 1);
		assert.equal(dati.registrate[0].exercise_name, 'Panca piana');
	});

	test("la schermata dell'allenamento arriva in una richiesta sola", async () => {
		const dati = (await come(tokenSocio, `/api/member/v1/allenamento/sessioni/${idSessione}`)).json();

		// Erano cinque richieste, due delle quali si portavano via mille righe di storico e
		// duecento sessioni — in palestra, mentre uno si allena.
		assert.ok(Array.isArray(dati.catalogo), 'serve il catalogo, per sostituire un esercizio in sala');
		assert.ok(Array.isArray(dati.record), 'i record di partenza li calcola il server');
		assert.ok(Array.isArray(dati.precedente), 'come era andata la volta prima');
		assert.equal(dati.sessione.id, idSessione);
	});

	describe('registrare e correggere una serie', () => {
		let idNuovaSerie;
		let idAperta;

		// Serve un allenamento **aperto**: su uno chiuso il server rifiuta, ed è giusto così.
		before(async () => {
			const [aperta] = await db
				.insert(workoutSessions)
				.values({ memberId: idSocio, planName: 'In corso', routineIndex: 0, iniziataAlle: new Date() })
				.returning();
			idAperta = aperta.id;
		});

		after(async () => {
			if (idAperta) {
				await db.delete(workoutLogs).where(inArray(workoutLogs.sessionId, [idAperta]));
				await db.delete(workoutSessions).where(inArray(workoutSessions.id, [idAperta]));
			}
		});

		test('una serie si registra senza dire a chi appartiene', async () => {
			// Il client manda solo quello che ha osservato. Socio, scheda e allenamento li
			// mette il server leggendo la sessione: un identificativo che arriva da fuori è
			// un identificativo che si può cambiare.
			const res = await app.inject({
				method: 'POST',
				url: `/api/member/v1/allenamento/sessioni/${idAperta}/serie`,
				headers: { authorization: `Bearer ${tokenSocio}` },
				payload: { esercizio_index: 1, serie_index: 0, exercise_name: 'Stacco', peso_usato: 100, reps_fatte: 5 },
			});

			assert.equal(res.statusCode, 201, res.body);
			const { serie } = res.json();
			idNuovaSerie = serie.id;
			assert.equal(serie.exercise_name, 'Stacco');

			// E il socio è quello giusto, anche se nessuno l'ha detto.
			const [riga] = await db.select().from(workoutLogs).where(inArray(workoutLogs.id, [idNuovaSerie]));
			assert.equal(riga.memberId, idSocio);
			assert.equal(riga.sessionId, idAperta);
		});

		test('si corregge quello che si è digitato male', async () => {
			const res = await app.inject({
				method: 'PATCH',
				url: `/api/member/v1/allenamento/serie/${idNuovaSerie}`,
				headers: { authorization: `Bearer ${tokenSocio}` },
				payload: { peso_usato: 110, tipo_serie: 'cedimento' },
			});

			assert.equal(res.statusCode, 200, res.body);
			const { serie } = res.json();
			assert.equal(Number(serie.peso_usato), 110);
			assert.equal(serie.tipo_serie, 'cedimento');
			// Quello che non si tocca resta com'era.
			assert.equal(serie.reps_fatte, 5);
		});

		test('la spunta si può togliere', async () => {
			const res = await app.inject({
				method: 'DELETE',
				url: `/api/member/v1/allenamento/serie/${idNuovaSerie}`,
				headers: { authorization: `Bearer ${tokenSocio}` },
			});

			assert.equal(res.statusCode, 200, res.body);
			const rimaste = await db.select().from(workoutLogs).where(inArray(workoutLogs.id, [idNuovaSerie]));
			assert.equal(rimaste.length, 0);
		});

		test("su un allenamento di un altro non si scrive, e si risponde 'non trovato'", async () => {
			const [altrui] = await db
				.insert(workoutSessions)
				.values({ memberId: idEstraneo, planName: "Scheda dell'estraneo", iniziataAlle: new Date() })
				.returning();

			const res = await app.inject({
				method: 'POST',
				url: `/api/member/v1/allenamento/sessioni/${altrui.id}/serie`,
				headers: { authorization: `Bearer ${tokenSocio}` },
				payload: { exercise_name: 'Intrusione', peso_usato: 1, reps_fatte: 1 },
			});
			assert.equal(res.statusCode, 404, res.body);

			const scritte = await db.select().from(workoutLogs).where(inArray(workoutLogs.sessionId, [altrui.id]));
			assert.equal(scritte.length, 0, 'la serie è stata scritta lo stesso');

			await db.delete(workoutSessions).where(inArray(workoutSessions.id, [altrui.id]));
		});
	});

	test("chiudere l'allenamento non accetta l'ora dal telefono", async () => {
		const [aperta] = await db
			.insert(workoutSessions)
			.values({ memberId: idSocio, planName: 'Da chiudere', iniziataAlle: new Date(Date.now() - 600000) })
			.returning();

		const prima = Date.now();
		const res = await app.inject({
			method: 'POST',
			url: `/api/member/v1/allenamento/sessioni/${aperta.id}/termina`,
			headers: { authorization: `Bearer ${tokenSocio}` },
			// Un telefono con l'orologio sbagliato: l'ora che manda va ignorata.
			payload: { terminata_alle: '1999-01-01T00:00:00Z' },
		});
		assert.equal(res.statusCode, 200, res.body);

		const chiusa = res.json().sessione;
		const quando = new Date(chiusa.terminata_alle).getTime();
		assert.ok(quando >= prima - 5000, `l'ora di fine viene dal client: ${chiusa.terminata_alle}`);

		// Chiuderlo due volte è il secondo tocco su un pulsante che aveva già funzionato: non
		// deve spostare l'ora di fine né dare errore.
		const ancora = await app.inject({
			method: 'POST',
			url: `/api/member/v1/allenamento/sessioni/${aperta.id}/termina`,
			headers: { authorization: `Bearer ${tokenSocio}` },
		});
		assert.equal(ancora.statusCode, 200);
		assert.equal(ancora.json().sessione.terminata_alle, chiusa.terminata_alle);

		// E su un allenamento chiuso non si registra più.
		const tardi = await app.inject({
			method: 'POST',
			url: `/api/member/v1/allenamento/sessioni/${aperta.id}/serie`,
			headers: { authorization: `Bearer ${tokenSocio}` },
			payload: { exercise_name: 'Fuori tempo', peso_usato: 1, reps_fatte: 1 },
		});
		assert.equal(tardi.statusCode, 409, tardi.body);

		await db.delete(workoutSessions).where(inArray(workoutSessions.id, [aperta.id]));
	});

	test('annullare cancella sessione e serie insieme', async () => {
		const res = await app.inject({
			method: 'DELETE',
			url: `/api/member/v1/allenamento/sessioni/${idSessione}`,
			headers: { authorization: `Bearer ${tokenSocio}` },
		});
		assert.equal(res.statusCode, 200, res.body);

		// Il punto della transazione: prima erano N+1 richieste dal browser, e una rete che
		// cadeva a metà lasciava serie orfane che nessuna schermata avrebbe più mostrato.
		const serieRimaste = await db.select().from(workoutLogs).where(inArray(workoutLogs.id, [idSerie]));
		const sessioniRimaste = await db.select().from(workoutSessions).where(inArray(workoutSessions.id, [idSessione]));
		assert.equal(serieRimaste.length, 0, 'sono rimaste serie orfane');
		assert.equal(sessioniRimaste.length, 0);
		idSessione = null;
		idSerie = null;
	});
});

describe('il contratto resta quello promesso', () => {
	// Un campo che sparisce o cambia nome rompe le app installate che non hanno aggiornato.
	// Questo test non giudica se i campi siano quelli giusti: fissa quelli pubblicati.
	test('il profilo ha i campi dichiarati', async () => {
		const dati = (await come(tokenSocio, '/api/member/v1/profilo')).json();

		assert.deepEqual(Object.keys(dati).sort(), ['abbonamento', 'documenti', 'socio']);
		assert.deepEqual(
			Object.keys(dati.socio).sort(),
			['codice_socio', 'contatto_emergenza', 'data_nascita', 'email', 'id', 'indirizzo', 'nome', 'note', 'telefono']
		);
		assert.deepEqual(
			Object.keys(dati.abbonamento).sort(),
			['fine', 'giorni_alla_scadenza', 'id', 'in_scadenza', 'ingressi_residui', 'inizio', 'piano', 'stato']
		);
	});

	test('una lezione ha i campi dichiarati', async () => {
		const dati = (await come(tokenSocio, `/api/member/v1/corsi/agenda?dal=${oggi}&al=${fraUnaSettimana}`)).json();
		const mia = dati.giorni.flatMap((g) => g.lezioni).find((l) => l.id === idLezione);

		assert.deepEqual(
			Object.keys(mia).sort(),
			['categoria', 'corso', 'data', 'fine', 'id', 'inizio', 'istruttore', 'mia_prenotazione', 'posti', 'sala']
		);
		assert.deepEqual(
			Object.keys(mia.posti).sort(),
			['al_completo', 'capienza', 'confermati', 'in_attesa', 'liberi']
		);
	});
});

// Le sale: chi comanda quando una sala si chiude.
//
// La regola è che comandano gli eventi. Una sala non si sospende sotto le lezioni già fissate,
// perché i soci ci sono già prenotati sopra: prima si tolgono quelle, poi si chiude la stanza.
// E al contrario, dentro il periodo di sospensione non si programma niente di nuovo. Le due
// metà devono valere insieme, altrimenti la seconda si aggira aspettando un minuto.
//
// Girano contro le rotte vere: la regola sta nel server, e nel server va verificata.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { staffAccounts, rooms, courses, events, sessions } from '../src/db/schema/index.js';
import { SALA_PRENOTATA } from '../../shared/sale.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-sale-1234';

let app;
let token;
let idSala;
let idCorso;
const daPulire = { eventi: [], lezioni: [], sale: [] };
let emailStaff;

const come = (opzioni) => app.inject({ ...opzioni, headers: { authorization: `Bearer ${token}` } });

const creaSala = (payload) => come({ method: 'POST', url: '/api/entities/Room', payload });
const modificaSala = (id, payload) => come({ method: 'PUT', url: `/api/entities/Room/${id}`, payload });

/** Una lezione il `data` nella sala indicata, con l'evento che la tiene. */
async function fissaLezione(data, idStanza = idSala, stato = 'active') {
	const [evento] = await db
		.insert(events)
		.values({
			courseId: idCorso, roomId: idStanza, capacity: 10, recurrenceType: 'single',
			startDate: data, startTime: '10:00', endTime: '11:00',
		})
		.returning();
	const [lezione] = await db
		.insert(sessions)
		.values({ eventId: evento.id, date: data, startTime: '10:00', endTime: '11:00', roomId: idStanza, capacity: 10, status: stato })
		.returning();
	daPulire.eventi.push(evento.id);
	daPulire.lezioni.push(lezione.id);
	return { evento, lezione };
}

/**
 * Un giorno prima o dopo oggi, in ISO.
 *
 * Le date vanno calcolate da oggi e non scritte a mano: "2026-11-03" è nel futuro mentre scrivo e
 * nel passato fra due mesi, e un test che cambia risposta da solo col passare del tempo è peggio
 * di un test che non c'è — fallisce quando nessuno ha toccato niente.
 */
const giornoRelativo = (delta) => spostaGiorni(oggiIso(), delta);
const IERI = giornoRelativo(-1);
const UN_ANNO_FA = giornoRelativo(-365);
const DOMANI = giornoRelativo(1);

async function svuotaCalendario() {
	if (daPulire.lezioni.length) await db.delete(sessions).where(inArray(sessions.id, daPulire.lezioni));
	if (daPulire.eventi.length) await db.delete(events).where(inArray(events.id, daPulire.eventi));
	daPulire.lezioni = [];
	daPulire.eventi = [];
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	emailStaff = `rec.sale.${suffisso}@test.local`;
	await db.insert(staffAccounts).values({
		nome: 'Reception Sale', email: emailStaff, passwordHash: await bcrypt.hash(PASSWORD, 4), ruolo: 'reception',
	});
	const accesso = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: emailStaff, password: PASSWORD } });
	assert.equal(accesso.statusCode, 200, `login fallito: ${accesso.body}`);
	token = accesso.json().token;

	const [corso] = await db.insert(courses).values({ name: `Corso sale ${suffisso}` }).returning();
	idCorso = corso.id;

	const res = await creaSala({ name: `Sala prova ${suffisso}` });
	assert.equal(res.statusCode, 201, res.body);
	idSala = res.json().id;
	daPulire.sale.push(idSala);
});

after(async () => {
	await svuotaCalendario();
	if (idCorso) await db.delete(courses).where(inArray(courses.id, [idCorso]));
	if (daPulire.sale.length) await db.delete(rooms).where(inArray(rooms.id, daPulire.sale));
	if (emailStaff) await db.delete(staffAccounts).where(inArray(staffAccounts.email, [emailStaff]));
	await app.close();
	await pool.end();
});

describe('una sala nasce attiva e si modifica tutta', () => {
	test('senza capienza e senza stato da scegliere', async () => {
		const sala = (await creaSala({ name: 'Sala senza capienza', capacity: 40 })).json();
		daPulire.sale.push(sala.id);
		assert.equal(sala.stato, 'attivo');
		assert.equal(sala.capacity, undefined, 'la capienza della sala non esiste più');
	});

	test('il nome si corregge: gli eventi seguono l’id, non come si chiama', async () => {
		const res = await modificaSala(idSala, { name: 'Sala Pesi', description: 'Tappetini nell’armadio' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().name, 'Sala Pesi');
		assert.equal(res.json().description, 'Tappetini nell’armadio');
	});

	test('un nome vuoto non passa, e le note stanno in 140 caratteri', async () => {
		assert.equal((await modificaSala(idSala, { name: '   ' })).statusCode, 400);
		const lunghe = await modificaSala(idSala, { description: 'a'.repeat(141) });
		assert.equal(lunghe.statusCode, 400);
		assert.match(lunghe.json().error, /140/);
	});

	test('il nome sta in 50 caratteri, con un rifiuto leggibile', async () => {
		// La colonna è varchar(50) e rifiuterebbe comunque, ma con "value too long for type
		// character varying(50)": vero, e illeggibile per chi ha compilato il modulo.
		const lungo = await creaSala({ name: 'a'.repeat(51) });
		assert.equal(lungo.statusCode, 400, lungo.body);
		assert.match(lungo.json().error, /50 caratteri/);

		const giusto = await creaSala({ name: 'a'.repeat(50) });
		assert.equal(giusto.statusCode, 201, giusto.body);
		daPulire.sale.push(giusto.json().id);
	});
});

// Tre casi, e il criterio è cosa si perderebbe: una sala mai collegata a un evento si elimina,
// una che ha ospitato lezioni passate si annulla, una con lezioni da qui in avanti non si tocca.
describe('eliminare, annullare, o niente', () => {
	const elimina = (id) => come({ method: 'DELETE', url: `/api/entities/Room/${id}` });
	const annulla = (id) => modificaSala(id, { stato: 'annullato', sospesa_dal: null, sospesa_al: null });

	test('una sala mai usata si elimina davvero', async () => {
		const sala = (await creaSala({ name: `Sala usa e getta ${Date.now()}` })).json();
		const res = await elimina(sala.id);
		assert.equal(res.statusCode, 200, res.body);
		assert.equal((await come({ method: 'GET', url: `/api/entities/Room/${sala.id}` })).statusCode, 404);
	});

	test('una sala con solo eventi passati non si elimina: si annulla', async () => {
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala con passato ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		await fissaLezione(UN_ANNO_FA, sala.id);

		const res = await elimina(sala.id);
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /non si elimina/);
		assert.match(res.json().error, /Si annulla/);

		// E l'annullamento passa: è la strada che il rifiuto ha indicato.
		const annullata = await annulla(sala.id);
		assert.equal(annullata.statusCode, 200, annullata.body);
		assert.equal(annullata.json().stato, 'annullato');
	});

	test('una sala con lezioni da qui in avanti non si tocca, né in un modo né nell’altro', async () => {
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala occupata ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		await fissaLezione(DOMANI, sala.id);

		const cancellata = await elimina(sala.id);
		assert.equal(cancellata.statusCode, 400, cancellata.body);
		assert.equal(cancellata.json().error, SALA_PRENOTATA);
		// Il codice, perché la pagina decide su quello e non sul testo.
		assert.equal(cancellata.json().code, 'sala_prenotata');

		// Dal menu a tendina dell'anagrafica si arriva allo stesso muro, con le stesse parole.
		const annullata = await annulla(sala.id);
		assert.equal(annullata.statusCode, 400, annullata.body);
		assert.equal(annullata.json().error, SALA_PRENOTATA);
	});

	test('una lezione di oggi conta come futura', async () => {
		// Oggi non è passato: la lezione deve ancora tenersi, e i soci sono già dentro.
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala di oggi ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		await fissaLezione(oggiIso(), sala.id);
		assert.equal((await annulla(sala.id)).json().error, SALA_PRENOTATA);
	});

	test('un evento che deve ancora cominciare tiene la sala, anche a lezioni disdette', async () => {
		// È la differenza fra una lezione e un evento. Una lezione disdetta è un appuntamento che
		// non c'è più. Un evento che non è ancora cominciato è una cosa viva in calendario: le sue
		// lezioni possono essere rigenerate, e annullare la stanza sotto di lui lo lascerebbe a
		// puntare a un posto dove non si può più entrare.
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala disdetta ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		await fissaLezione(DOMANI, sala.id, 'cancelled');
		assert.equal((await elimina(sala.id)).json().error, SALA_PRENOTATA);
		assert.equal((await annulla(sala.id)).json().error, SALA_PRENOTATA);
	});

	test('una lezione passata e disdetta non tiene in piedi niente', async () => {
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala finita male ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		await fissaLezione(UN_ANNO_FA, sala.id, 'cancelled');
		// Resta un evento nel passato: non si elimina, si annulla.
		assert.match((await elimina(sala.id)).json().error, /Si annulla/);
		assert.equal((await annulla(sala.id)).statusCode, 200);
	});

	test('nemmeno una sala con le sole lezioni spostate dentro si elimina', async () => {
		// L'evento sta in un'altra sala: qui dentro ci sono solo le sue lezioni, spostate una
		// alla volta. La chiave esterna le difenderebbe comunque, ma senza spiegare niente.
		await svuotaCalendario();
		const altra = (await creaSala({ name: `Sala d'arrivo ${Date.now()}` })).json();
		daPulire.sale.push(altra.id);
		const { lezione } = await fissaLezione(IERI);
		await db.update(sessions).set({ roomId: altra.id }).where(inArray(sessions.id, [lezione.id]));

		const res = await elimina(altra.id);
		assert.equal(res.statusCode, 400, res.body);
		// Qui non c'è nessun evento, c'è una lezione: il messaggio diceva "1 evento" per tutte e
		// due, e con tre eventi scriveva "c'è 3 eventi".
		assert.match(res.json().error, /c'è 1 lezione che si è tenuta/);
	});

	test('un evento cominciato ieri e non ancora finito tiene la sala', async () => {
		// Si guardava solo l'inizio dell'evento: uno cominciato ieri che finisce fra un mese, con
		// le lezioni tutte disdette, lasciava annullare la sala sotto di sé.
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala in corso ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		const [evento] = await db.insert(events).values({
			courseId: idCorso, roomId: sala.id, capacity: 10, recurrenceType: 'weekly', daysOfWeek: ['Monday'],
			startDate: IERI, endCondition: 'by_date', endDate: giornoRelativo(30), startTime: '10:00', endTime: '11:00',
		}).returning();
		daPulire.eventi.push(evento.id);
		assert.equal((await annulla(sala.id)).json().error, SALA_PRENOTATA);
	});

	test('una sala già annullata con un passato non si annulla di nuovo, e il cestino lo dice', async () => {
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala già chiusa ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		await fissaLezione(UN_ANNO_FA, sala.id);
		assert.equal((await annulla(sala.id)).statusCode, 200);
		const res = await elimina(sala.id);
		assert.equal(res.statusCode, 400);
		assert.match(res.json().error, /già annullata/);
	});

	test('una sala annullata si rinomina anche se nel frattempo è comparsa una lezione futura', async () => {
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala da rinominare ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		assert.equal((await annulla(sala.id)).statusCode, 200);
		await fissaLezione(DOMANI, sala.id);
		// Il modulo manda sempre anche lo stato: non è un nuovo annullamento.
		const res = await modificaSala(sala.id, { name: 'Sala rinominata', stato: 'annullato' });
		assert.equal(res.statusCode, 200, res.body);
	});

	test('tolto il calendario, la sala se ne va', async () => {
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala da svuotare ${Date.now()}` })).json();
		await fissaLezione(DOMANI, sala.id);
		assert.equal((await elimina(sala.id)).statusCode, 400);
		await svuotaCalendario();
		const res = await elimina(sala.id);
		assert.equal(res.statusCode, 200, res.body);
	});

	test('annullare è definitivo: non si riattiva', async () => {
		const sala = (await creaSala({ name: `Sala finita ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		assert.equal((await annulla(sala.id)).statusCode, 200);
		const riattiva = await modificaSala(sala.id, { stato: 'attivo' });
		assert.equal(riattiva.statusCode, 400, riattiva.body);
		assert.match(riattiva.json().error, /non si riattiva/);
		// Nemmeno sospenderla: da annullata non si esce.
		assert.equal((await modificaSala(sala.id, { stato: 'sospeso', sospesa_dal: DOMANI, sospesa_al: DOMANI })).statusCode, 400);
	});

	test('una sala mai usata si può annullare invece di eliminarla', async () => {
		const sala = (await creaSala({ name: `Sala archiviata ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		assert.equal((await annulla(sala.id)).statusCode, 200);
	});
});

describe('in una sala annullata non si programma niente, mai', () => {
	let idAnnullata;

	test('nemmeno in una data lontanissima', async () => {
		const sala = (await creaSala({ name: `Sala chiusa ${Date.now()}` })).json();
		idAnnullata = sala.id;
		daPulire.sale.push(sala.id);
		assert.equal((await modificaSala(sala.id, { stato: 'annullato' })).statusCode, 200);

		const res = await come({
			method: 'POST',
			url: '/api/entities/Event',
			payload: {
				course_id: idCorso, room_id: sala.id, capacity: 10, recurrence_type: 'single',
				start_date: '2031-01-15', start_time: '10:00', end_time: '11:00',
			},
		});
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /è annullata/);
	});

	test('e non ci si sposta dentro una lezione', async () => {
		await svuotaCalendario();
		const { lezione } = await fissaLezione(DOMANI);
		const res = await come({ method: 'PUT', url: `/api/entities/Session/${lezione.id}`, payload: { room_id: idAnnullata } });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /è annullata/);
	});

	// Le lezioni create direttamente, una o in blocco, passavano senza guardare la sala.
	test('né ci si crea una lezione, da sola o in blocco', async () => {
		await svuotaCalendario();
		const { evento } = await fissaLezione(DOMANI);
		const lezione = { event_id: evento.id, date: DOMANI, start_time: '12:00', end_time: '13:00', room_id: idAnnullata, capacity: 5 };
		assert.equal((await come({ method: 'POST', url: '/api/entities/Session', payload: lezione })).statusCode, 400);
		assert.equal((await come({ method: 'POST', url: '/api/entities/Session/bulk', payload: [lezione] })).statusCode, 400);
	});

	test('e un evento allungato dentro una sospensione viene rifiutato', async () => {
		// Si ricontrollava solo se cambiavano sala o data d'inizio: allungare la fine passava.
		await svuotaCalendario();
		const sala = (await creaSala({ name: `Sala chiusa più avanti ${Date.now()}` })).json();
		daPulire.sale.push(sala.id);
		assert.equal((await modificaSala(sala.id, { stato: 'sospeso', sospesa_dal: giornoRelativo(40), sospesa_al: giornoRelativo(50) })).statusCode, 200);
		const [evento] = await db.insert(events).values({
			courseId: idCorso, roomId: sala.id, capacity: 10, recurrenceType: 'weekly', daysOfWeek: ['Monday'],
			startDate: DOMANI, endCondition: 'by_date', endDate: giornoRelativo(20), startTime: '10:00', endTime: '11:00',
		}).returning();
		daPulire.eventi.push(evento.id);
		const res = await come({ method: 'PUT', url: `/api/entities/Event/${evento.id}`, payload: { end_date: giornoRelativo(45) } });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /sospesa/);
	});

	test('né ci si riattiva una lezione annullata', async () => {
		await svuotaCalendario();
		const { lezione } = await fissaLezione(DOMANI, idSala, 'cancelled');
		await db.update(sessions).set({ roomId: idAnnullata }).where(inArray(sessions.id, [lezione.id]));
		const res = await come({ method: 'PUT', url: `/api/entities/Session/${lezione.id}`, payload: { status: 'active' } });
		assert.equal(res.statusCode, 400, res.body);
	});
});

describe('sospendere è sempre un periodo', () => {
	test('sospesa senza date non si salva', async () => {
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: null, sospesa_al: null });
		assert.equal(res.statusCode, 400, res.body);
	});

	test('la fine non può precedere l’inizio', async () => {
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-15', sospesa_al: '2026-10-01' });
		assert.equal(res.statusCode, 400, res.body);
	});

	test('tornare attiva cancella il periodo', async () => {
		// Calendario vuoto e date calcolate da oggi. Con le date scritte a mano, la lezione di
		// *domani* lasciata nella sala dal blocco precedente finiva dentro il periodo a partire
		// dal 30 settembre, la sospensione veniva rifiutata e il test cadeva senza che nessuno
		// avesse toccato niente.
		await svuotaCalendario();
		const dal = giornoRelativo(30);
		const al = giornoRelativo(45);
		const sospesa = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: dal, sospesa_al: al });
		assert.equal(sospesa.statusCode, 200, sospesa.body);
		const riattivata = (await modificaSala(idSala, { stato: 'attivo' })).json();
		assert.equal(riattivata.stato, 'attivo');
		assert.equal(riattivata.sospesa_dal, null);
		assert.equal(riattivata.sospesa_al, null);
	});
});

describe('comandano gli eventi', () => {
	test('una sala con lezioni in quel periodo non si sospende', async () => {
		await svuotaCalendario();
		await fissaLezione('2026-10-07');
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /non si può sospendere/);
		assert.match(res.json().error, /07\/10\/2026/);
	});

	test('le lezioni fuori dal periodo non bloccano niente', async () => {
		await svuotaCalendario();
		await fissaLezione('2026-09-30');
		await fissaLezione('2026-10-16');
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 200, res.body);
	});

	test('una lezione cancellata non tiene aperta la sala', async () => {
		await svuotaCalendario();
		await modificaSala(idSala, { stato: 'attivo' });
		await fissaLezione('2026-10-07', idSala, 'cancelled');
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 200, res.body);
	});

	test('tolte le lezioni, la sospensione passa', async () => {
		await svuotaCalendario();
		await modificaSala(idSala, { stato: 'attivo' });
		await fissaLezione('2026-10-07');
		assert.equal((await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' })).statusCode, 400);
		await svuotaCalendario();
		const res = await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' });
		assert.equal(res.statusCode, 200, res.body);
	});
});

describe('in una sala sospesa non si programma', () => {
	const evento = (extra) => come({
		method: 'POST',
		url: '/api/entities/Event',
		payload: {
			course_id: idCorso, room_id: idSala, capacity: 10, recurrence_type: 'single',
			start_date: '2026-10-07', start_time: '10:00', end_time: '11:00', ...extra,
		},
	});

	test('un evento dentro il periodo viene rifiutato', async () => {
		await svuotaCalendario();
		assert.equal((await modificaSala(idSala, { stato: 'sospeso', sospesa_dal: '2026-10-01', sospesa_al: '2026-10-15' })).statusCode, 200);
		const res = await evento();
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /è sospesa dal 01\/10\/2026 al 15\/10\/2026/);
	});

	test('un evento fuori dal periodo passa', async () => {
		const res = await evento({ start_date: '2026-10-16' });
		assert.equal(res.statusCode, 201, res.body);
		daPulire.eventi.push(res.json().id);
	});

	test('un settimanale che ci finisce dentro viene rifiutato', async () => {
		const res = await evento({
			recurrence_type: 'weekly', days_of_week: ['Monday'], start_date: '2026-09-01',
			end_condition: 'by_date', end_date: '2026-10-05',
		});
		assert.equal(res.statusCode, 400, res.body);
	});

	test('un settimanale a occorrenze non sa dove finisce, e la sala chiusa se la tiene buona', async () => {
		// Senza data di fine il server non può sapere quali giorni occuperà: meglio un rifiuto
		// da spiegare che una lezione generata dentro una stanza chiusa.
		const res = await evento({
			recurrence_type: 'weekly', days_of_week: ['Monday'], start_date: '2026-09-01',
			end_condition: 'by_count', occurrence_count: 8,
		});
		assert.equal(res.statusCode, 400, res.body);
	});

	test('spostare una singola lezione in una sala sospesa viene rifiutato', async () => {
		await svuotaCalendario();
		const altra = (await creaSala({ name: `Sala vicina ${Date.now()}` })).json();
		daPulire.sale.push(altra.id);
		const { lezione } = await fissaLezione('2026-10-07', altra.id);
		const res = await come({ method: 'PUT', url: `/api/entities/Session/${lezione.id}`, payload: { room_id: idSala } });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /sospesa/);
	});
});

// Annullare una sala e programmarci un evento erano "controllo, poi scrittura" senza blocco:
// arrivando insieme, passavano tutte e due, e la sala annullata si ritrovava un evento.
describe('due richieste insieme sulla stessa sala', () => {
	test('annullarla e programmarci un evento: al massimo una delle due passa', async () => {
		for (let giro = 0; giro < 5; giro++) {
			const sala = (await creaSala({ name: `Sala contesa ${Date.now()}-${giro}` })).json();
			daPulire.sale.push(sala.id);
			const [annullata, evento] = await Promise.all([
				modificaSala(sala.id, { stato: 'annullato' }),
				come({
					method: 'POST', url: '/api/entities/Event',
					payload: {
						course_id: idCorso, room_id: sala.id, capacity: 10, recurrence_type: 'single',
						start_date: DOMANI, start_time: '10:00', end_time: '11:00',
					},
				}),
			]);
			if (evento.statusCode === 201) daPulire.eventi.push(evento.json().id);
			assert.ok(
				!(annullata.statusCode === 200 && evento.statusCode === 201),
				`giro ${giro}: sala annullata e evento creato insieme`,
			);
		}
	});
});

describe('un evento nuovo, e le note di un corso', () => {
	const creaEvento = (payload) => come({ method: 'POST', url: '/api/entities/Event', payload });
	// Una sala tutta sua: quella comune a questo file, a questo punto, l'hanno sospesa i test sopra.
	let idSalaLibera;
	before(async () => {
		const sala = (await creaSala({ name: 'Sala eventi nuovi' })).json();
		daPulire.sale.push(sala.id);
		idSalaLibera = sala.id;
	});
	const base = () => ({
		course_id: idCorso, room_id: idSalaLibera, capacity: 10, start_date: DOMANI, start_time: '10:00', end_time: '11:00',
	});

	test('a date personalizzate non si crea più', async () => {
		const res = await creaEvento({ ...base(), recurrence_type: 'custom', custom_dates: [DOMANI] });
		assert.equal(res.statusCode, 400, res.body);
		assert.match(res.json().error, /data singola o ogni settimana/);
	});

	test('una data singola si crea come prima', async () => {
		const res = await creaEvento({ ...base(), recurrence_type: 'single' });
		assert.equal(res.statusCode, 201, res.body);
		daPulire.eventi.push(res.json().id);
	});

	test('le note di un corso stanno in 140 caratteri', async () => {
		const troppo = await come({ method: 'PUT', url: `/api/entities/Course/${idCorso}`, payload: { description: 'x'.repeat(141) } });
		assert.equal(troppo.statusCode, 400, troppo.body);
		const giusto = await come({ method: 'PUT', url: `/api/entities/Course/${idCorso}`, payload: { description: 'x'.repeat(140) } });
		assert.equal(giusto.statusCode, 200, giusto.body);
		const vuoto = await come({ method: 'PUT', url: `/api/entities/Course/${idCorso}`, payload: { description: '  ' } });
		assert.equal(vuoto.json().description, null);
	});
});

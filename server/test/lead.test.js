// I lead e le loro prove, controllati contro le rotte vere.
//
// Le regole che contano qui sono tre, e nessuna si vede da un'interfaccia: una prova occupa
// un posto vero in sala, lo stato di un lead cambia solo quando succede qualcosa, e
// l'iscrizione crea un socio senza lasciare niente a metà.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, and, inArray, or } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, rooms, courses, events, sessions, bookings,
	leads, leadAttivita, organizations, numberingCounters,
} from '../src/db/schema/index.js';

const PASSWORD = 'prova-lead-1234';
const CAPIENZA = 2;
const FUTURA = '2027-03-01';
const PASSATA = '2021-03-01';

let app;
const token = {};
const idSoci = [];
const idAccount = [];
const idLead = [];
const idConvertiti = [];
let idSala;
let idCorso;
let idEvento;
let idFutura;
let idPassata;
let contatoreIniziale;
let idEnte;

function come(chi, opzioni) {
	return app.inject({ ...opzioni, headers: { authorization: `Bearer ${token[chi]}`, ...opzioni.headers } });
}

const post = (chi, url, payload = {}) => come(chi, { method: 'POST', url, payload });

async function nuovoLead(dati = {}) {
	const res = await post('reception', '/api/entities/Lead', { full_name: `Lead ${idLead.length + 1}`, fonte: 'instagram', ...dati });
	assert.equal(res.statusCode, 201, res.body);
	idLead.push(res.json().id);
	return res.json();
}

async function pulisciPrenotazioni() {
	await db.delete(bookings).where(inArray(bookings.sessionId, [idFutura, idPassata]));
}

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const suffisso = Date.now();

	const soci = await db
		.insert(members)
		.values([1, 2].map((n) => ({ fullName: `Socio lead ${n}`, email: `socio${n}.lead.${suffisso}@test.local` })))
		.returning();
	idSoci.push(...soci.map((s) => s.id));

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db
		.insert(staffAccounts)
		.values([
			{ nome: 'Reception Lead', email: `rec.lead.${suffisso}@test.local`, passwordHash, ruolo: 'reception' },
			{ nome: 'Istruttore Lead', email: `ist.lead.${suffisso}@test.local`, passwordHash, ruolo: 'istruttore' },
			{ nome: 'Socio Lead', email: `soc.lead.${suffisso}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: soci[0].id },
		])
		.returning();
	idAccount.push(...account.map((a) => a.id));

	const accedi = async (email) => {
		const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
		assert.equal(res.statusCode, 200, `login di ${email} fallito: ${res.body}`);
		return res.json().token;
	};
	token.reception = await accedi(account[0].email);
	token.istruttore = await accedi(account[1].email);
	token.socio = await accedi(account[2].email);

	const [sala] = await db.insert(rooms).values({ name: `Sala lead ${suffisso}`, capacity: 50 }).returning();
	idSala = sala.id;
	const [corso] = await db.insert(courses).values({ name: `Corso lead ${suffisso}` }).returning();
	idCorso = corso.id;
	const [evento] = await db
		.insert(events)
		.values({
			courseId: corso.id, roomId: sala.id, capacity: CAPIENZA, recurrenceType: 'single',
			startDate: FUTURA, startTime: '10:00', endTime: '11:00',
		})
		.returning();
	idEvento = evento.id;
	const lezioni = await db
		.insert(sessions)
		.values([FUTURA, PASSATA].map((date) => ({
			eventId: evento.id, date, startTime: '10:00', endTime: '11:00', roomId: sala.id, capacity: CAPIENZA,
		})))
		.returning();
	idFutura = lezioni.find((l) => l.date === FUTURA).id;
	idPassata = lezioni.find((l) => l.date === PASSATA).id;

	// La conversione consuma un codice socio: a fine prova il contatore torna dov'era, così
	// i test non lasciano buchi nella numerazione del database su cui girano.
	const [ente] = await db.select().from(organizations).limit(1);
	idEnte = ente?.id;
	if (idEnte) {
		const [c] = await db.select().from(numberingCounters)
			.where(and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio')));
		contatoreIniziale = c?.value ?? null;
	}
});

after(async () => {
	await pulisciPrenotazioni();
	await db.delete(sessions).where(eq(sessions.eventId, idEvento));
	await db.delete(events).where(eq(events.id, idEvento));
	await db.delete(leads).where(inArray(leads.id, idLead.length ? idLead : ['00000000-0000-0000-0000-000000000000']));
	await db.delete(courses).where(eq(courses.id, idCorso));
	await db.delete(rooms).where(eq(rooms.id, idSala));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, idAccount));
	await db.delete(members).where(inArray(members.id, [...idSoci, ...idConvertiti]));
	if (idEnte) {
		const dove = and(eq(numberingCounters.organizationId, idEnte), eq(numberingCounters.scope, 'codice_socio'));
		if (contatoreIniziale === null) await db.delete(numberingCounters).where(dove);
		else await db.update(numberingCounters).set({ value: contatoreIniziale }).where(dove);
	}
	await app.close();
	await pool.end();
});

describe('chi può fare cosa', () => {
	test("l'istruttore vede i lead ma non li tocca", async () => {
		const lead = await nuovoLead();
		const lettura = await come('istruttore', { method: 'GET', url: '/api/entities/Lead' });
		assert.equal(lettura.statusCode, 200);
		assert.equal((await post('istruttore', '/api/entities/Lead', { full_name: 'X' })).statusCode, 403);
		assert.equal((await post('istruttore', `/api/lead/${lead.id}/stato`, { stato: 'contattato' })).statusCode, 403);
	});

	test('il socio non vede i lead e non li muove', async () => {
		const lead = await nuovoLead();
		assert.equal((await come('socio', { method: 'GET', url: '/api/entities/Lead' })).statusCode, 403);
		assert.equal((await post('socio', `/api/lead/${lead.id}/prova`, { session_id: idFutura })).statusCode, 403);
	});

	test("dall'anagrafica non si cambia lo stato", async () => {
		const lead = await nuovoLead();
		const res = await come('reception', {
			method: 'PUT',
			url: `/api/entities/Lead/${lead.id}`,
			payload: { stato: 'iscritto', convertito_member_id: idSoci[0], obiettivo: 'Dimagrire' },
		});
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().stato, 'nuovo');
		assert.equal(res.json().convertito_member_id, null);
		assert.equal(res.json().obiettivo, 'Dimagrire', 'il resto si salva');
	});

	test('la cronologia non si scrive, non si riscrive e non si cancella dall\'endpoint generico', async () => {
		const lead = await nuovoLead();
		const creata = await post('reception', '/api/entities/LeadAttivita', { lead_id: lead.id, tipo: 'nota', testo: 'x', autore_nome: 'Qualcun altro' });
		assert.equal(creata.statusCode, 400);

		const nota = await post('reception', `/api/lead/${lead.id}/attivita`, { tipo: 'nota', testo: 'Chiede gli orari serali' });
		assert.equal(nota.statusCode, 201, nota.body);
		const [riga] = await db.select().from(leadAttivita).where(eq(leadAttivita.leadId, lead.id));
		assert.equal(riga.autoreNome, 'Reception Lead', "l'autore lo decide il token");

		assert.equal((await come('reception', { method: 'DELETE', url: `/api/entities/LeadAttivita/${riga.id}` })).statusCode, 400);
		assert.equal((await come('reception', { method: 'PUT', url: `/api/entities/LeadAttivita/${riga.id}`, payload: { testo: 'y' } })).statusCode, 400);
	});
});

describe('i passaggi di stato', () => {
	test('uno stato che racconta un fatto non si sceglie a mano', async () => {
		const lead = await nuovoLead();
		for (const stato of ['iscritto', 'prova_svolta', 'prova_prenotata', 'inventato']) {
			assert.equal((await post('reception', `/api/lead/${lead.id}/stato`, { stato })).statusCode, 400, stato);
		}
	});

	test('perdere un contatto chiede il motivo, e lo toglie da chi richiamare', async () => {
		const lead = await nuovoLead({ prossima_azione_il: '2026-01-01' });
		assert.equal((await post('reception', `/api/lead/${lead.id}/stato`, { stato: 'perso' })).statusCode, 400);

		const res = await post('reception', `/api/lead/${lead.id}/stato`, { stato: 'perso', motivo_perdita: 'prezzo' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().lead.stato, 'perso');
		assert.equal(res.json().lead.motivo_perdita, 'prezzo');
		assert.equal(res.json().lead.prossima_azione_il, null);

		const [voce] = await db.select().from(leadAttivita).where(eq(leadAttivita.leadId, lead.id));
		assert.equal(voce.tipo, 'cambio_stato');
		assert.match(voce.testo, /Nuovo → Perso \(Prezzo\)/);

		const prova = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		assert.equal(prova.statusCode, 400, 'a un contatto perso non si prenota una prova');
	});
});

describe('la prova occupa un posto vero', () => {
	test('socio, prova, socio: il terzo va in lista d\'attesa', async () => {
		await pulisciPrenotazioni();
		const lead = await nuovoLead();

		await db.insert(bookings).values({ sessionId: idFutura, memberId: idSoci[0], memberName: 'Socio lead 1', status: 'confirmed' });
		const prova = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		assert.equal(prova.statusCode, 201, prova.body);
		assert.equal(prova.json().booking.status, 'confirmed');
		assert.equal(prova.json().booking.lead_id, lead.id);
		assert.equal(prova.json().booking.member_id, null);
		assert.equal(prova.json().lead.stato, 'prova_prenotata');

		const socio = await post('reception', '/api/prenotazioni', { session_id: idFutura, member_id: idSoci[1] });
		assert.equal(socio.json().booking.status, 'waitlisted', 'la prova ha preso l\'ultimo posto');

		const doppia = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		assert.equal(doppia.statusCode, 409);
		const [dopo] = await db.select().from(leadAttivita).where(and(eq(leadAttivita.leadId, lead.id), eq(leadAttivita.tipo, 'prova')));
		assert.ok(dopo, 'la prova riuscita è in cronologia');
	});

	test('il socio conta la prova fra i posti, ma non sa di chi è', async () => {
		const righe = await come('socio', { method: 'GET', url: `/api/entities/Booking?session_id=${idFutura}` });
		assert.equal(righe.statusCode, 200);
		for (const r of righe.json()) {
			assert.equal('lead_id' in r, false);
			assert.equal('member_name' in r, false);
		}

		const agenda = await come('socio', { method: 'GET', url: `/api/member/v1/corsi/agenda?dal=${FUTURA}&al=${FUTURA}` });
		assert.equal(agenda.statusCode, 200, agenda.body);
		const lezione = trova(agenda.json(), (n) => n && n.id === idFutura);
		assert.ok(lezione, "la lezione è nell'agenda");
		assert.equal(lezione.posti.confermati, CAPIENZA);
		assert.equal(lezione.posti.al_completo, true);
	});
});

function trova(nodo, criterio) {
	if (criterio(nodo)) return nodo;
	if (nodo && typeof nodo === 'object') {
		for (const v of Object.values(nodo)) {
			const r = trova(v, criterio);
			if (r) return r;
		}
	}
	return null;
}

describe('la disdetta della prova', () => {
	test("libera il posto a chi aspetta, e senza altre prove il lead torna da richiamare", async () => {
		await pulisciPrenotazioni();
		const lead = await nuovoLead();
		await db.insert(bookings).values({ sessionId: idFutura, memberId: idSoci[0], memberName: 'Socio lead 1', status: 'confirmed' });
		const prova = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		const inAttesa = await post('reception', '/api/prenotazioni', { session_id: idFutura, member_id: idSoci[1] });
		assert.equal(inAttesa.json().booking.status, 'waitlisted');

		const res = await post('reception', `/api/lead/${lead.id}/prova/${prova.json().booking.id}/disdici`);
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().promosso, true);
		assert.equal(res.json().lead.stato, 'contattato');

		const [promossa] = await db.select().from(bookings).where(eq(bookings.id, inAttesa.json().booking.id));
		assert.equal(promossa.status, 'confirmed');

		const diNuovo = await post('reception', `/api/lead/${lead.id}/prova/${prova.json().booking.id}/disdici`);
		assert.equal(diNuovo.statusCode, 400);
	});

	test('il socio non disdice la prova di un lead dal portale', async () => {
		await pulisciPrenotazioni();
		const lead = await nuovoLead();
		const prova = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		const res = await post('socio', `/api/member/v1/corsi/prenotazioni/${prova.json().booking.id}/disdici`);
		assert.equal(res.statusCode, 404);
	});
});

describe("l'esito della prova", () => {
	test('una prova futura non ha ancora un esito', async () => {
		await pulisciPrenotazioni();
		const lead = await nuovoLead();
		const prova = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		const res = await post('reception', `/api/lead/${lead.id}/prova/${prova.json().booking.id}/esito`, { presenza: 'presente' });
		assert.equal(res.statusCode, 400);
	});

	test('presente porta a "prova svolta", e la prova di un altro lead non si tocca', async () => {
		await pulisciPrenotazioni();
		const lead = await nuovoLead();
		const altro = await nuovoLead();
		// Una lezione passata non si prenota più: la riga si scrive direttamente, com'era il giorno della prova.
		const [prova] = await db.insert(bookings)
			.values({ sessionId: idPassata, leadId: lead.id, memberName: lead.full_name, status: 'confirmed' })
			.returning();
		await db.update(leads).set({ stato: 'prova_prenotata' }).where(eq(leads.id, lead.id));

		const intruso = await post('reception', `/api/lead/${altro.id}/prova/${prova.id}/esito`, { presenza: 'assente' });
		assert.equal(intruso.statusCode, 404);

		const res = await post('reception', `/api/lead/${lead.id}/prova/${prova.id}/esito`, { presenza: 'presente' });
		assert.equal(res.statusCode, 200, res.body);
		assert.equal(res.json().lead.stato, 'prova_svolta');
		const [riga] = await db.select().from(bookings).where(eq(bookings.id, prova.id));
		assert.equal(riga.presenza, 'presente');
	});

	test('una prenotazione non può essere di un socio e di un lead insieme', async () => {
		const lead = await nuovoLead();
		await assert.rejects(
			db.insert(bookings).values({ sessionId: idFutura, memberId: idSoci[0], leadId: lead.id, status: 'confirmed' }),
		);
		await assert.rejects(db.insert(bookings).values({ sessionId: idFutura, status: 'confirmed' }));
	});
});

describe("l'iscrizione", () => {
	test('crea il socio, gli passa le prenotazioni future e lascia al lead le prove fatte', async () => {
		await pulisciPrenotazioni();
		const lead = await nuovoLead({
			email: 'nuovo.socio@test.local', phone: '333', consenso_privacy: true, consenso_marketing: true, obiettivo: 'Forza',
		});
		const [passata] = await db.insert(bookings)
			.values({ sessionId: idPassata, leadId: lead.id, memberName: lead.full_name, status: 'confirmed', presenza: 'presente' })
			.returning();
		const futura = await post('reception', `/api/lead/${lead.id}/prova`, { session_id: idFutura });
		assert.equal(futura.statusCode, 201, futura.body);

		const res = await post('reception', `/api/lead/${lead.id}/converti`);
		assert.equal(res.statusCode, 201, res.body);
		const { member, lead: convertito, prenotazioni_spostate: spostate } = res.json();
		idConvertiti.push(member.id);

		assert.equal(member.full_name, lead.full_name);
		assert.equal(member.gdpr_consent, true);
		assert.equal(member.consenso_marketing, true);
		if (idEnte) assert.match(member.codice_socio, /^\d{6}$/);
		assert.equal(convertito.stato, 'iscritto');
		assert.equal(convertito.convertito_member_id, member.id);
		assert.equal(spostate, 1);

		const righe = await db.select().from(bookings)
			.where(or(eq(bookings.id, passata.id), eq(bookings.id, futura.json().booking.id)));
		const perId = Object.fromEntries(righe.map((r) => [r.id, r]));
		assert.equal(perId[passata.id].leadId, lead.id, 'la prova fatta resta nella storia del lead');
		assert.equal(perId[futura.json().booking.id].memberId, member.id, 'la lezione di domani è del socio');
		assert.equal(perId[futura.json().booking.id].leadId, null);

		const seconda = await post('reception', `/api/lead/${lead.id}/converti`);
		assert.equal(seconda.statusCode, 409);
		assert.equal(seconda.json().member_id, member.id);
	});
});

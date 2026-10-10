// La vista dell'istruttore: le sue lezioni, presenti e no-show calcolati dagli ingressi, chi salta
// spesso, e le note nel diario. Vede solo i soci delle sue lezioni; senza collegamento, niente.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, staffAccounts, instructors, courses, events, sessions, rooms, bookings, ingressi, attivita,
} from '../src/db/schema/index.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-istruttore-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);

let app;
const token = {};
const id = { soci: {}, persone: [], account: [], istruttori: [], corsi: [], eventi: [], lezioni: {}, sala: null };
const come = (chi, method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const nomi = ['Salta', 'Viene', 'Altrove'];
	const soci = await db.insert(members).values(nomi.map((n, i) => ({ nome: n, cognome: `Istr${lettere}`, codiceSocio: `IS${'ABC'[i]}${lettere}` }))).returning();
	soci.forEach((s, i) => { id.soci[nomi[i].toLowerCase()] = s.id; id.persone.push(s.personaId); });

	const [mio, altro] = await db.insert(instructors).values([{ nome: 'Mia', cognome: `Istruttrice${lettere}` }, { nome: 'Altro', cognome: `Istruttore${lettere}` }]).returning();
	id.istruttori = [mio.id, altro.id];
	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Mia Istruttrice', email: `istr.mia.${t}@test.local`, passwordHash, ruolo: 'istruttore', instructorId: mio.id },
		{ nome: 'Senza Collegamento', email: `istr.senza.${t}@test.local`, passwordHash, ruolo: 'istruttore' },
		{ nome: 'Reception Istr', email: `istr.reception.${t}@test.local`, passwordHash, ruolo: 'reception' },
	]).returning();
	id.account = account.map((a) => a.id);
	for (const [chi, a] of [['mia', account[0]], ['senza', account[1]], ['reception', account[2]]]) {
		token[chi] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: a.email, password: PASSWORD } })).json().token;
	}

	const [sala] = await db.insert(rooms).values({ name: `Sala istr ${t}` }).returning();
	id.sala = sala.id;
	const corsi = await db.insert(courses).values([{ name: `Pilates ${t}`, instructorId: mio.id }, { name: `Boxe ${t}`, instructorId: altro.id }]).returning();
	id.corsi = corsi.map((c) => c.id);
	const eventi = await db.insert(events).values(corsi.map((c) => ({
		courseId: c.id, roomId: sala.id, capacity: 10, recurrenceType: 'single', startDate: fra(-3), startTime: '18:00', endTime: '19:00',
	}))).returning();
	id.eventi = eventi.map((e) => e.id);
	// Due lezioni passate e una fra due giorni del mio corso; una passata dell'altro.
	const lezioni = await db.insert(sessions).values([
		{ eventId: eventi[0].id, date: fra(-3) }, { eventId: eventi[0].id, date: fra(-1) }, { eventId: eventi[0].id, date: fra(2) },
		{ eventId: eventi[1].id, date: fra(-1) },
	].map((l) => ({ ...l, startTime: '18:00', endTime: '19:00', roomId: sala.id, capacity: 10 }))).returning();
	[id.lezioni.prima, id.lezioni.ieri, id.lezioni.futura, id.lezioni.altrove] = lezioni.map((l) => l.id);
	const prenota = (lezione, socio) => ({ sessionId: lezione, memberId: socio, status: 'confirmed', memberName: 'x' });
	await db.insert(bookings).values([
		prenota(id.lezioni.prima, id.soci.salta), prenota(id.lezioni.ieri, id.soci.salta), prenota(id.lezioni.futura, id.soci.salta),
		prenota(id.lezioni.ieri, id.soci.viene),
		prenota(id.lezioni.altrove, id.soci.altrove),
	]);
	// "Viene" è entrato ieri alle 17:30 o alle 18:30 di Roma (ora solare o legale): dentro la finestra.
	await db.insert(ingressi).values({ memberId: id.soci.viene, entratoAlle: new Date(`${fra(-1)}T17:30:00+01:00`), esito: 'ammesso', metodo: 'qr', registratoDaNome: 'Test' });
});

after(async () => {
	await db.delete(attivita).where(inArray(attivita.personaId, id.persone));
	await db.delete(ingressi).where(inArray(ingressi.memberId, Object.values(id.soci)));
	await db.delete(bookings).where(inArray(bookings.sessionId, Object.values(id.lezioni)));
	await db.delete(sessions).where(inArray(sessions.eventId, id.eventi));
	await db.delete(events).where(inArray(events.id, id.eventi));
	await db.delete(courses).where(inArray(courses.id, id.corsi));
	await db.delete(rooms).where(eq(rooms.id, id.sala));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(instructors).where(inArray(instructors.id, id.istruttori));
	await db.delete(members).where(inArray(members.id, Object.values(id.soci)));
	await app.close();
	await pool.end();
});

describe('le mie lezioni', () => {
	test('chi non ha il modulo non entra; senza collegamento, nessuna lezione', async () => {
		assert.equal((await come('reception', 'GET', '/api/istruttore/lezioni')).statusCode, 403);
		const senza = (await come('senza', 'GET', '/api/istruttore/lezioni')).json();
		assert.equal(senza.collegato, false);
		assert.equal((await come('senza', 'GET', `/api/istruttore/soci/${id.soci.salta}`)).statusCode, 403);
	});

	test('presenti e no-show della lezione di ieri, solo le sue lezioni, e chi salta spesso', async () => {
		const res = await come('mia', 'GET', `/api/istruttore/lezioni?dal=${fra(-3)}&al=${fra(3)}`);
		assert.equal(res.statusCode, 200, res.body);
		const dati = res.json();
		assert.equal(dati.collegato, true);
		assert.deepEqual(dati.lezioni.map((l) => l.id), [id.lezioni.prima, id.lezioni.ieri, id.lezioni.futura]);
		const ieri = dati.lezioni.find((l) => l.id === id.lezioni.ieri);
		const esito = Object.fromEntries(ieri.prenotati.map((p) => [p.socio_id, p.esito]));
		assert.deepEqual(esito, { [id.soci.salta]: 'no_show', [id.soci.viene]: 'presente' });
		assert.equal(dati.lezioni.find((l) => l.id === id.lezioni.futura).prenotati[0].esito, 'in_attesa');
		assert.deepEqual(dati.spesso.map((s) => [s.socio_id, s.no_show]), [[id.soci.salta, 2]]);
		assert.ok(ieri.prenotati.find((p) => p.socio_id === id.soci.salta).salta_spesso);
		assert.ok(!JSON.stringify(dati).includes(id.soci.altrove), 'il socio di un altro corso non compare');
	});

	test('scrive una nota a un suo socio; a quello di un altro corso no', async () => {
		const res = await come('mia', 'POST', `/api/istruttore/soci/${id.soci.salta}/note`, { nota: 'Si è fatto male al ginocchio' });
		assert.equal(res.statusCode, 201, res.body);
		assert.equal((await come('mia', 'POST', `/api/istruttore/soci/${id.soci.altrove}/note`, { nota: 'x' })).statusCode, 404);
		assert.equal((await come('mia', 'GET', `/api/istruttore/soci/${id.soci.altrove}`)).statusCode, 404);
		const scheda = (await come('mia', 'GET', `/api/istruttore/soci/${id.soci.salta}`)).json();
		assert.equal(scheda.note[0].nota, 'Si è fatto male al ginocchio');
		assert.equal(scheda.note[0].autore_nome, 'Mia Istruttrice');
		const [riga] = await db.select().from(attivita).where(and(inArray(attivita.personaId, id.persone), eq(attivita.tipo, 'nota_istruttore')));
		assert.ok(riga, 'la nota è nel diario del socio, la legge anche la reception');
	});

	test('con i permessi predefiniti l\'istruttore non apre più soci, documenti, contatti e diario', async () => {
		for (const url of ['/api/segnali', `/api/persone/${id.persone[0]}/diario`, '/api/entities/MemberDocument', '/api/lead/lavoro']) {
			assert.equal((await come('mia', 'GET', url)).statusCode, 403, url);
		}
	});
});

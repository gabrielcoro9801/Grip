// Il motore dei segnali contro le rotte vere: Oggi, il contatto che nasconde, il rimando, i
// no-show calcolati dagli ingressi, la ricerca globale e i permessi.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import {
	members, persone, staffAccounts, subscriptions, ingressi, rooms, courses, events, sessions, bookings, attivita,
} from '../src/db/schema/index.js';
import { impostaMatrice, ripristinaMatricePredefinita, PERMESSI_PREDEFINITI } from '../../shared/permissions.js';
import { oggiIso, spostaGiorni } from '../../shared/giorni.js';

const PASSWORD = 'prova-segnali-1234';
const t = Date.now();
const lettere = String(t).replace(/\d/g, (c) => 'ABCDEFGHIJ'[c]);
const oggi = oggiIso();
const fra = (n) => spostaGiorni(oggi, n);

let app;
const token = {};
const id = { soci: {}, account: [], persone: [] };
const idCorso = {};

const come = (chi, metodo, url, payload) =>
	app.inject({ method: metodo, url, payload, headers: { authorization: `Bearer ${token[chi]}` } });
const login = async (email) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } })).json().token;
const persona = async (chiave) => {
	const [s] = await db.select({ personaId: members.personaId }).from(members).where(eq(members.id, id.soci[chiave])).limit(1);
	return s.personaId;
};
const oggiDi = async (chi = 'reception') => (await come(chi, 'GET', '/api/segnali?da_fare=1')).json();
const riga = (dati, chiave) => dati.persone.find((p) => p.socio_id === id.soci[chiave]);

before(async () => {
	app = buildApp({ logger: false });
	await app.ready();
	const nomi = ['Scade', 'Contattato', 'Rimandato', 'Saltalezioni', 'Regolare'];
	const soci = await db.insert(members).values(nomi.map((n, i) => ({
		nome: n, cognome: `Segnali${lettere}`, codiceSocio: `SG${'ABCDE'[i]}${lettere}`, phone: `+39347${String(t).slice(-6)}${i}`,
		codiceFiscale: i === 0 ? `SG${lettere}X` : null,
	}))).returning();
	soci.forEach((s, i) => { id.soci[nomi[i].toLowerCase()] = s.id; id.persone.push(s.personaId); });
	await db.insert(subscriptions).values(soci.map((s, i) => ({
		memberId: s.id, planName: 'Mensile', startDate: '2025-01-01', endDate: i < 3 ? fra(3) : fra(200),
	})));
	// Tutti entrano spesso: nessuno è assente o in calo, i segnali sono solo quelli voluti.
	await db.insert(ingressi).values(soci.flatMap((s) => [1, 3, 5, 8].map((g) => ({
		memberId: s.id, entratoAlle: new Date(`${fra(-g)}T08:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test',
	}))));

	// Due lezioni finite, prenotate da Saltalezioni senza entrare; una frequentata da Regolare.
	const [sala] = await db.insert(rooms).values({ name: `Sala segnali ${t}` }).returning();
	const [corso] = await db.insert(courses).values({ name: `Corso segnali ${t}` }).returning();
	const [evento] = await db.insert(events).values({
		courseId: corso.id, roomId: sala.id, capacity: 10, recurrenceType: 'single', startDate: fra(-6), startTime: '18:00', endTime: '19:00',
	}).returning();
	const lezioni = await db.insert(sessions).values([fra(-6), fra(-4)].map((date) => ({
		eventId: evento.id, date, startTime: '18:00', endTime: '19:00', roomId: sala.id, capacity: 10,
	}))).returning();
	await db.insert(bookings).values([
		...lezioni.map((l) => ({ sessionId: l.id, memberId: id.soci.saltalezioni, memberName: 'Saltalezioni' })),
		...lezioni.map((l) => ({ sessionId: l.id, memberId: id.soci.regolare, memberName: 'Regolare' })),
	]);
	// Regolare entra alle 16:00 UTC: le 18 a Roma d'estate, le 17 d'inverno, dentro la finestra in entrambi i casi.
	await db.insert(ingressi).values(lezioni.map((l) => ({
		memberId: id.soci.regolare, entratoAlle: new Date(`${l.date}T16:00:00Z`), esito: 'ammesso', metodo: 'manuale', registratoDaNome: 'Test',
	})));
	Object.assign(idCorso, { sala: sala.id, corso: corso.id, evento: evento.id, lezioni: lezioni.map((l) => l.id) });

	const passwordHash = await bcrypt.hash(PASSWORD, 4);
	const account = await db.insert(staffAccounts).values([
		{ nome: 'Reception Segnali', email: `sg.rec.${t}@test.local`, passwordHash, ruolo: 'reception' },
		{ nome: 'Istruttore Segnali', email: `sg.ist.${t}@test.local`, passwordHash, ruolo: 'istruttore' },
		{ nome: 'Socio Segnali', email: `sg.soc.${t}@test.local`, passwordHash, ruolo: 'member', linkedMemberId: soci[4].id },
	]).returning();
	id.account = account.map((a) => a.id);
	token.reception = await login(account[0].email);
	token.istruttore = await login(account[1].email);
	token.socio = await login(account[2].email);
});

after(async () => {
	ripristinaMatricePredefinita();
	const tutti = Object.values(id.soci);
	await db.delete(bookings).where(inArray(bookings.memberId, tutti));
	await db.delete(sessions).where(eq(sessions.eventId, idCorso.evento));
	await db.delete(events).where(eq(events.id, idCorso.evento));
	await db.delete(courses).where(eq(courses.id, idCorso.corso));
	await db.delete(rooms).where(eq(rooms.id, idCorso.sala));
	await db.delete(ingressi).where(inArray(ingressi.memberId, tutti));
	await db.delete(subscriptions).where(inArray(subscriptions.memberId, tutti));
	await db.delete(staffAccounts).where(inArray(staffAccounts.id, id.account));
	await db.delete(members).where(inArray(members.id, tutti));
	await db.delete(persone).where(inArray(persone.id, id.persone));
	await app.close();
	await pool.end();
});

describe('Oggi', () => {
	test('chi scade fra 3 giorni è in Oggi, con il perché in parole', async () => {
		const dati = await oggiDi();
		const scade = riga(dati, 'scade');
		assert.ok(scade, 'in Oggi');
		assert.equal(scade.fase, 'in_scadenza');
		assert.deepEqual(scade.da_fare, ['in_scadenza']);
		assert.equal(scade.perche, 'scade tra 3 giorni');
		assert.equal(scade.scadenza, fra(3));
		assert.ok(!riga(dati, 'regolare'), 'chi non ha niente da fare non è in Oggi');
		assert.ok(dati.conteggi.fasi.in_scadenza >= 3);
	});

	test('"proposto rinnovo" va nel diario e nasconde il segnale per una settimana', async () => {
		const pid = await persona('contattato');
		const r = await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'di_persona', esito: 'proposto_rinnovo', nota: 'Ci pensa' });
		assert.equal(r.statusCode, 201, r.body);
		const dati = await oggiDi();
		assert.ok(!riga(dati, 'contattato'), 'nascosto da Oggi');
		const scheda = (await come('reception', 'GET', `/api/segnali?persona=${pid}`)).json().persone[0];
		assert.equal(scheda.segnali.find((s) => s.codice === 'in_scadenza').nascosto_fino, fra(7));
		const diario = (await come('reception', 'GET', `/api/persone/${pid}/diario`)).json().attivita;
		assert.deepEqual(diario.map((a) => [a.tipo, a.esito, a.nota]), [['contatto', 'proposto_rinnovo', 'Ci pensa']]);
	});

	test('"rimanda" nasconde fino al giorno scelto; i giorni devono avere senso', async () => {
		const pid = await persona('rimandato');
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/rimanda`, { giorni: 0 })).statusCode, 400);
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/rimanda`, { giorni: 61 })).statusCode, 400);
		const r = await come('reception', 'POST', `/api/persone/${pid}/rimanda`, { giorni: 2 });
		assert.equal(r.statusCode, 201, r.body);
		assert.equal(r.json().attivita.esito, fra(2));
		assert.ok(!riga(await oggiDi(), 'rimandato'));
	});

	test('un contatto senza esito o canale validi si rifiuta', async () => {
		const pid = await persona('scade');
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'piccione', esito: 'risposto' })).statusCode, 400);
		assert.equal((await come('reception', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono', esito: 'boh' })).statusCode, 400);
	});
});

describe('presenze e no-show', () => {
	test('due lezioni prenotate senza entrare sono due no-show; chi entra nella finestra è presente', async () => {
		const salta = (await come('reception', 'GET', `/api/segnali?persona=${await persona('saltalezioni')}`)).json().persone[0];
		assert.ok(salta.da_fare.includes('no_show_ripetuti'), JSON.stringify(salta.segnali));
		assert.match(salta.perche, /2 no-show in 4 settimane/);
		const regolare = (await come('reception', 'GET', `/api/segnali?persona=${await persona('regolare')}`)).json().persone[0];
		assert.deepEqual(regolare.da_fare, []);
	});
});

describe('filtri dell\'elenco', () => {
	test('per fase e per segnale, solo soci', async () => {
		const perFase = (await come('reception', 'GET', '/api/segnali?tipo=soci&fase=in_scadenza')).json();
		assert.ok(perFase.persone.every((p) => p.fase === 'in_scadenza' && p.socio_id));
		assert.ok(riga(perFase, 'contattato'), 'l\'elenco mostra anche chi è già stato contattato');
		const perSegnale = (await come('reception', 'GET', '/api/segnali?tipo=soci&segnale=no_show_ripetuti')).json();
		assert.ok(riga(perSegnale, 'saltalezioni'));
		assert.ok(!riga(perSegnale, 'scade'));
		assert.equal((await come('reception', 'GET', '/api/segnali?fase=boh')).statusCode, 400);
		assert.equal((await come('reception', 'GET', '/api/segnali?persona=boh')).statusCode, 400);
	});
});

describe('la ricerca globale', () => {
	test('trova per telefono scritto in un altro formato, per codice socio e per codice fiscale', async () => {
		const cerca = async (q) => (await come('reception', 'GET', `/api/persone/cerca?q=${encodeURIComponent(q)}`)).json().risultati;
		const cifre = `347${String(t).slice(-6)}0`;
		const perTelefono = await cerca(`${cifre.slice(0, 3)} ${cifre.slice(3, 6)} ${cifre.slice(6)}`);
		assert.deepEqual(perTelefono.map((r) => r.socio_id), [id.soci.scade]);
		assert.equal(perTelefono[0].tipo, 'socio');
		assert.deepEqual((await cerca(`0039${cifre}`)).map((r) => r.socio_id), [id.soci.scade]);
		assert.deepEqual((await cerca(`SGB${lettere}`)).map((r) => r.socio_id), [id.soci.contattato]);
		assert.deepEqual((await cerca(`sg${lettere}x`)).map((r) => r.socio_id), [id.soci.scade], 'il codice fiscale, anche minuscolo');
		assert.ok((await cerca(`segnali${lettere} rimandato`)).some((r) => r.socio_id === id.soci.rimandato), 'le parole in qualunque ordine');
		assert.deepEqual(await cerca('x'), []);
	});
});

describe('i permessi', () => {
	test('il socio non legge i segnali, non cerca e non registra contatti', async () => {
		assert.equal((await come('socio', 'GET', '/api/segnali')).statusCode, 403);
		assert.equal((await come('socio', 'GET', '/api/persone/cerca?q=Scade')).statusCode, 403);
		assert.equal((await come('socio', 'POST', `/api/persone/${await persona('scade')}/contatti`, { canale: 'telefono', esito: 'risposto' })).statusCode, 403);
	});

	test('chi vede e basta legge, ma non registra contatti né rimanda', async () => {
		assert.equal((await come('istruttore', 'GET', '/api/segnali?da_fare=1')).statusCode, 200);
		const pid = await persona('scade');
		assert.equal((await come('istruttore', 'POST', `/api/persone/${pid}/contatti`, { canale: 'telefono', esito: 'risposto' })).statusCode, 403);
		assert.equal((await come('istruttore', 'POST', `/api/persone/${pid}/rimanda`, { giorni: 3 })).statusCode, 403);
	});

	test('chi segue solo i contatti non riceve i soci, né li trova', async () => {
		impostaMatrice({ permessi: { ...PERMESSI_PREDEFINITI, istruttore: { crm_leads: ['view'] } }, capacita: {} });
		try {
			const dati = (await come('istruttore', 'GET', '/api/segnali')).json();
			assert.ok(dati.persone.every((p) => !p.socio_id));
			const trovati = (await come('istruttore', 'GET', `/api/persone/cerca?q=${encodeURIComponent(`Segnali${lettere}`)}`)).json().risultati;
			assert.deepEqual(trovati, []);
		} finally {
			ripristinaMatricePredefinita();
		}
	});
});

describe('il bancone', () => {
	test('la verifica porta "proponi il rinnovo"; segnato nel diario, non si ripropone', async () => {
		const verifica = async () => (await come('reception', 'POST', '/api/ingressi/verifica', { member_id: id.soci.scade })).json();
		const prima = await verifica();
		assert.deepEqual(prima.segnali, [{ codice: 'in_scadenza', motivo: 'Scade tra 3 giorni: proponi il rinnovo', azioni: ['proposta_rinnovo'] }]);
		assert.equal(prima.socio.persona_id, await persona('scade'));
		const r = await come('reception', 'POST', `/api/persone/${prima.socio.persona_id}/contatti`, { canale: 'di_persona', esito: 'proposto_rinnovo' });
		assert.equal(r.statusCode, 201);
		assert.deepEqual((await verifica()).segnali, []);
	});

	test('chi non viene più, nelle statistiche, lo dice il motore', async () => {
		const s = (await come('reception', 'GET', '/api/ingressi/statistiche?giorni=30')).json();
		assert.equal(s.sogliaRischio, 14);
		assert.ok(!s.rischio.some((x) => Object.values(id.soci).includes(x.id)), 'tutti i nostri entrano spesso');
	});
});

describe('il diario resta pulito', () => {
	test('le righe scritte dai test hanno un autore', async () => {
		const righe = await db.select().from(attivita).where(inArray(attivita.personaId, id.persone));
		assert.ok(righe.every((r) => r.autoreNome === 'Reception Segnali'));
	});
});

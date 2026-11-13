// Le migrazioni 0059 (una sessione, un giorno) e 0060 (fisse a periodo), provate sulla parte
// scritta a mano: le bozze in drizzle/_bozze, quelle che si incollano nelle migrazioni generate.
//
// Il database dei test le ha già applicate. Qui si rifanno le tabelle com'erano prima, in uno
// schema a parte, con una sessione su due giorni, le sue lezioni, due fisse e le prenotazioni; si
// lanciano le bozze, e si guarda che la sessione sia diventata due, con le lezioni al posto giusto,
// le fisse divise e le prenotazioni attribuite alla fissa che le ha fatte.
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db/client.js';

const SCHEMA = `prova_migrazione_${Date.now()}`;
const bozza = (n) => readFile(new URL(`../drizzle/_bozze/${n}.sql`, import.meta.url), 'utf8');

let client;
const id = {
	corso: randomUUID(), sala: randomUUID(), evento: randomUUID(), soci: [randomUUID(), randomUUID(), randomUUID()],
	fisse: [randomUUID(), randomUUID()], lezioni: {}, prenotazioni: {},
};
const righe = async (sql, params = []) => (await client.query(sql, params)).rows;

before(async () => {
	client = await pool.connect();
	await client.query(`CREATE SCHEMA "${SCHEMA}"`);
	await client.query(`SET search_path TO "${SCHEMA}"`);
	// Le tabelle com'erano: senza vincoli né chiavi esterne, con le colonne che le migrazioni tolgono.
	await client.query(`
		CREATE TABLE events (LIKE public.events INCLUDING DEFAULTS);
		ALTER TABLE events ADD COLUMN days_of_week jsonb;
		CREATE TABLE sessions (LIKE public.sessions INCLUDING DEFAULTS);
		CREATE TABLE prenotazioni_fisse (LIKE public.prenotazioni_fisse INCLUDING DEFAULTS);
		ALTER TABLE prenotazioni_fisse ADD COLUMN giorni jsonb, ALTER COLUMN dal DROP NOT NULL;
		CREATE TABLE bookings (LIKE public.bookings INCLUDING DEFAULTS);
	`);

	// Lunedì e giovedì, scritti in disordine, «per 4 lezioni».
	await client.query(`INSERT INTO events (id, course_id, room_id, capacity, recurrence_type, days_of_week, start_date, end_condition, occurrence_count, start_time, end_time)
		VALUES ($1, $2, $3, 12, 'weekly', '["Thursday", "Monday"]', '2026-11-02', 'by_count', 4, '18:00', '19:00')`, [id.evento, id.corso, id.sala]);
	for (const data of ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12']) {
		const [l] = await righe(`INSERT INTO sessions (event_id, date, start_time, end_time, room_id, capacity)
			VALUES ($1, $2, '18:00', '19:00', $3, 12) RETURNING id`, [id.evento, data, id.sala]);
		id.lezioni[data] = l.id;
	}
	// Il primo socio fisso in tutti e due i giorni, il secondo solo il giovedì.
	await client.query(`INSERT INTO prenotazioni_fisse (id, member_id, event_id, giorni, attiva, created_date) VALUES
		($1, $3, $5, NULL, true, '2026-11-01 10:00+01'),
		($2, $4, $5, '["Thursday"]', true, '2026-11-01 10:00+01')`, [...id.fisse, id.soci[0], id.soci[1], id.evento]);
	const prenota = async (socio, data, quando = '2026-11-01 10:05+01') => {
		const [b] = await righe(`INSERT INTO bookings (session_id, member_id, status, created_date) VALUES ($1, $2, 'confirmed', $3) RETURNING id`,
			[id.lezioni[data], socio, quando]);
		id.prenotazioni[`${socio}:${data}`] = b.id;
	};
	for (const data of Object.keys(id.lezioni)) await prenota(id.soci[0], data);
	await prenota(id.soci[1], '2026-11-05');
	await prenota(id.soci[1], '2026-11-12');
	// Il terzo socio non ha fisse: la sua prenotazione resta senza.
	await prenota(id.soci[2], '2026-11-09');

	await client.query(await bozza('0059'));
	await client.query(await bozza('0060'));
});

after(async () => {
	await client.query(`DROP SCHEMA "${SCHEMA}" CASCADE`);
	await client.query('SET search_path TO DEFAULT');
	client.release();
	await pool.end();
});

describe('0059: una sessione su due giorni diventa due', () => {
	test('la riga tiene il lunedì, il giovedì nasce uguale', async () => {
		const sessioni = await righe('SELECT * FROM events ORDER BY giorno');
		assert.equal(sessioni.length, 2);
		const [lunedi, giovedi] = [sessioni.find((s) => s.giorno === 'Monday'), sessioni.find((s) => s.giorno === 'Thursday')];
		assert.equal(lunedi.id, id.evento, 'il primo giorno della settimana resta sulla riga di partenza');
		for (const campo of ['course_id', 'room_id', 'capacity', 'recurrence_type', 'start_time', 'end_time', 'start_date']) {
			assert.deepEqual(giovedi[campo], lunedi[campo], campo);
		}
	});

	test('le lezioni seguono il loro giorno', async () => {
		const perSessione = await righe(`SELECT e.giorno, array_agg(s.date::text ORDER BY s.date) AS date
			FROM sessions s JOIN events e ON e.id = s.event_id GROUP BY e.giorno ORDER BY e.giorno`);
		assert.deepEqual(perSessione, [
			{ giorno: 'Monday', date: ['2026-11-02', '2026-11-09'] },
			{ giorno: 'Thursday', date: ['2026-11-05', '2026-11-12'] },
		]);
	});

	test('«per 4 lezioni» diventa «fino all\'ultima lezione», per ognuna', async () => {
		const fini = await righe(`SELECT giorno, end_condition, end_date::text, occurrence_count FROM events ORDER BY giorno`);
		assert.deepEqual(fini, [
			{ giorno: 'Monday', end_condition: 'by_date', end_date: '2026-11-09', occurrence_count: null },
			{ giorno: 'Thursday', end_condition: 'by_date', end_date: '2026-11-12', occurrence_count: null },
		]);
	});

	test('le fisse: quella di tutti i giorni si copia, quella del giovedì si sposta', async () => {
		const fisse = await righe(`SELECT f.id, f.member_id, e.giorno FROM prenotazioni_fisse f JOIN events e ON e.id = f.event_id ORDER BY f.member_id, e.giorno`);
		const delPrimo = fisse.filter((f) => f.member_id === id.soci[0]);
		assert.deepEqual(delPrimo.map((f) => f.giorno).sort(), ['Monday', 'Thursday']);
		assert.equal(delPrimo.find((f) => f.giorno === 'Monday').id, id.fisse[0], 'la fissa di partenza resta col primo giorno');
		const delSecondo = fisse.filter((f) => f.member_id === id.soci[1]);
		assert.deepEqual(delSecondo, [{ id: id.fisse[1], member_id: id.soci[1], giorno: 'Thursday' }]);
	});
});

describe('0060: le fisse a periodo', () => {
	test('cominciano il giorno in cui sono nate, senza fine', async () => {
		const fisse = await righe('SELECT dal::text, al FROM prenotazioni_fisse');
		assert.equal(fisse.length, 3);
		assert.ok(fisse.every((f) => f.dal === '2026-11-01' && f.al === null));
	});

	test('ogni prenotazione va alla fissa della sua sessione; quella senza fissa resta senza', async () => {
		const fissaDi = async (socio, data) => (await righe('SELECT prenotazione_fissa_id FROM bookings WHERE id = $1',
			[id.prenotazioni[`${socio}:${data}`]]))[0].prenotazione_fissa_id;
		const copia = (await righe(`SELECT f.id FROM prenotazioni_fisse f JOIN events e ON e.id = f.event_id
			WHERE f.member_id = $1 AND e.giorno = 'Thursday'`, [id.soci[0]]))[0].id;
		assert.equal(await fissaDi(id.soci[0], '2026-11-02'), id.fisse[0]);
		assert.equal(await fissaDi(id.soci[0], '2026-11-09'), id.fisse[0]);
		assert.equal(await fissaDi(id.soci[0], '2026-11-05'), copia);
		assert.equal(await fissaDi(id.soci[0], '2026-11-12'), copia);
		assert.equal(await fissaDi(id.soci[1], '2026-11-05'), id.fisse[1]);
		assert.equal(await fissaDi(id.soci[2], '2026-11-09'), null);
	});
});

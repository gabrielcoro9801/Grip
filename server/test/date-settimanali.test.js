// Il riconoscimento delle lezioni settimanali salvate un giorno prima (lib/dateSettimanali.js).
//
// Lo script di ripristino scrive sulla produzione: la parte che decide cosa spostare va
// provata prima, sui casi che una query sul giorno della settimana sbaglierebbe.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { dateGiuste, esaminaEvento, spostaGiorni } from '../src/lib/dateSettimanali.js';

const lezioni = (...date) => date.map((date, i) => ({ id: `l${i}`, date }));

describe('le date giuste di un evento', () => {
	test('fino a una data', () => {
		assert.deepEqual(
			dateGiuste({ giorno: 'Monday', start_date: '2026-10-05', end_condition: 'by_date', end_date: '2026-10-19' }),
			['2026-10-05', '2026-10-12', '2026-10-19'],
		);
	});

	test("a occorrenze, dal primo giorno giusto dopo l'inizio", () => {
		assert.deepEqual(
			dateGiuste({ giorno: 'Thursday', start_date: '2026-10-20', end_condition: 'by_count', occurrence_count: 3 }),
			['2026-10-22', '2026-10-29', '2026-11-05'],
		);
	});

	test('senza un giorno valido, nessuna data', () => {
		assert.deepEqual(dateGiuste({ giorno: null, start_date: '2026-10-20', end_condition: 'by_count', occurrence_count: 3 }), []);
		assert.deepEqual(dateGiuste({ giorno: 'Lunedì', start_date: '2026-10-20', end_condition: 'by_count', occurrence_count: 3 }), []);
	});

	test('a cavallo di un mese e di un anno', () => {
		assert.equal(spostaGiorni('2026-12-31', 1), '2027-01-01');
		assert.equal(spostaGiorni('2026-03-01', -1), '2026-02-28');
	});
});

describe('cosa fare delle lezioni', () => {
	const delLunedi = { giorno: 'Monday', start_date: '2026-10-05', end_condition: 'by_date', end_date: '2026-10-19' };

	test('salvate di domenica: tutte avanti di un giorno', () => {
		const esame = esaminaEvento(delLunedi, lezioni('2026-10-04', '2026-10-11', '2026-10-18'));
		assert.equal(esame.esito, 'sfalsato');
		assert.deepEqual(esame.daSpostare.map((l) => l.a), ['2026-10-05', '2026-10-12', '2026-10-19']);
	});

	test('già giuste: niente da fare', () => {
		const esame = esaminaEvento(delLunedi, lezioni('2026-10-05', '2026-10-12', '2026-10-19'));
		assert.equal(esame.esito, 'giusto');
		assert.deepEqual(esame.daSpostare, []);
	});

	test('la domenica salvata di sabato: si sposta', () => {
		const domenica = { giorno: 'Sunday', start_date: '2026-10-03', end_condition: 'by_count', occurrence_count: 2 };
		const esame = esaminaEvento(domenica, lezioni('2026-10-03', '2026-10-10'));
		assert.equal(esame.esito, 'sfalsato');
		assert.deepEqual(esame.daSpostare.map((l) => l.a), ['2026-10-04', '2026-10-11']);
	});

	test("il sabato già giusto: resta dov'è", () => {
		const sabato = { giorno: 'Saturday', start_date: '2026-10-03', end_condition: 'by_count', occurrence_count: 2 };
		assert.equal(esaminaEvento(sabato, lezioni('2026-10-03', '2026-10-10')).esito, 'giusto');
	});

	test('una lezione spostata a mano non si tocca, e si segnala', () => {
		const esame = esaminaEvento(delLunedi, lezioni('2026-10-04', '2026-10-11', '2026-10-21'));
		assert.equal(esame.esito, 'sfalsato');
		assert.equal(esame.daSpostare.length, 2);
		assert.deepEqual(esame.fuoriSchema, [{ id: 'l2', date: '2026-10-21' }]);
	});

	test('a pari merito non si decide', () => {
		const esame = esaminaEvento(delLunedi, lezioni('2026-10-04', '2026-10-12'));
		assert.equal(esame.esito, 'incerto');
		assert.deepEqual(esame.daSpostare, []);
	});
});

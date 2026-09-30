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
			dateGiuste({ days_of_week: ['Monday'], start_date: '2026-10-05', end_condition: 'by_date', end_date: '2026-10-19' }),
			['2026-10-05', '2026-10-12', '2026-10-19'],
		);
	});

	test('a occorrenze, contando tutti i giorni scelti', () => {
		assert.deepEqual(
			dateGiuste({ days_of_week: ['Tuesday', 'Thursday'], start_date: '2026-10-20', end_condition: 'by_count', occurrence_count: 3 }),
			['2026-10-20', '2026-10-22', '2026-10-27'],
		);
	});

	test('a cavallo di un mese e di un anno', () => {
		assert.equal(spostaGiorni('2026-12-31', 1), '2027-01-01');
		assert.equal(spostaGiorni('2026-03-01', -1), '2026-02-28');
	});
});

describe('cosa fare delle lezioni', () => {
	const delLunedi = { days_of_week: ['Monday'], start_date: '2026-10-05', end_condition: 'by_date', end_date: '2026-10-19' };

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

	test('sabato e domenica salvati sfalsati: si spostano anche quelli che sembrano giusti', () => {
		// Sfalsate cadono di venerdì e di sabato: il sabato sembrerebbe a posto, ma è il sabato
		// che doveva essere domenica. Una query sul giorno della settimana lo lascerebbe lì.
		const weekend = { days_of_week: ['Saturday', 'Sunday'], start_date: '2026-10-03', end_condition: 'by_count', occurrence_count: 4 };
		const esame = esaminaEvento(weekend, lezioni('2026-10-02', '2026-10-03', '2026-10-09', '2026-10-10'));
		assert.equal(esame.esito, 'sfalsato');
		assert.deepEqual(esame.daSpostare.map((l) => l.a), ['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11']);
	});

	test('sabato e domenica già giusti: restano dove sono', () => {
		const weekend = { days_of_week: ['Saturday', 'Sunday'], start_date: '2026-10-03', end_condition: 'by_count', occurrence_count: 4 };
		assert.equal(esaminaEvento(weekend, lezioni('2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11')).esito, 'giusto');
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

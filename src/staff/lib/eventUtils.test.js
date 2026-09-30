// Le date delle lezioni, provate nel fuso in cui la palestra lavora.
//
// Un corso settimanale del lunedì veniva salvato di domenica: il ciclo camminava sulle
// mezzanotti locali e poi scriveva la data in UTC, che in Italia è ancora il giorno prima.
// Su una macchina in UTC l'errore non si vede: il fuso di Roma lo fissa `npm test`
// (src/fusoDeiTest.js), e qui si ripete per chi lancia il file da solo.
process.env.TZ = 'Europe/Rome';

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionDates, grigliaDelMese } from './eventUtils.js';

const giornoDellaSettimana = (iso) => new Date(`${iso}T12:00:00`).getDay();

describe('un corso settimanale', () => {
	test('del lunedì cade di lunedì, fino alla data di fine', () => {
		const date = generateSessionDates({
			recurrence_type: 'weekly',
			days_of_week: ['Monday'],
			start_date: '2026-10-05',
			end_condition: 'by_date',
			end_date: '2026-10-19',
		});
		assert.deepEqual(date, ['2026-10-05', '2026-10-12', '2026-10-19']);
	});

	test('a occorrenze, su più giorni, attraverso il cambio dell’ora', () => {
		// Il 25 ottobre 2026 finisce l'ora legale: un giorno di 25 ore non deve spostare niente.
		const date = generateSessionDates({
			recurrence_type: 'weekly',
			days_of_week: ['Tuesday', 'Thursday'],
			start_date: '2026-10-20',
			end_condition: 'by_count',
			occurrence_count: 4,
		});
		assert.deepEqual(date, ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
		for (const d of date) assert.ok([2, 4].includes(giornoDellaSettimana(d)), `${d} non è martedì né giovedì`);
	});
});

describe('la griglia del calendario', () => {
	test('la casella del giorno N cerca le lezioni del giorno N', () => {
		// Ottobre 2026 comincia di giovedì: la griglia parte da lunedì 28 settembre.
		const caselle = grigliaDelMese(2026, 9);
		assert.equal(caselle.length, 42);
		assert.equal(caselle[0].chiave, '2026-09-28');
		for (const { data, chiave } of caselle) {
			const attesa = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
			assert.equal(chiave, attesa);
		}
		assert.equal(caselle.find((c) => c.data.getMonth() === 9 && c.data.getDate() === 1).chiave, '2026-10-01');
	});

	test('attraverso il cambio dell’ora le caselle restano giorni interi', () => {
		const chiavi = grigliaDelMese(2026, 9).map((c) => c.chiave);
		assert.ok(chiavi.includes('2026-10-25') && chiavi.includes('2026-10-26'));
		assert.equal(new Set(chiavi).size, 42, 'un giorno doppio o saltato');
	});
});

// I conflitti di orario fra lezioni.
//
// Il modulo manda "09:00", il database restituisce "09:00:00": confrontate come stringhe
// intere, due lezioni consecutive nella stessa sala risultavano in conflitto.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { timeOverlap, getDayOfWeekFromDate } from './courseValidation.js';
import { checkEventConflicts } from './eventUtils.js';

describe('due orari si sovrappongono?', () => {
	test('una lezione che comincia quando finisce la precedente no, anche con i secondi del database', () => {
		assert.equal(timeOverlap('09:00', '10:00', '08:00:00', '09:00:00'), false);
		assert.equal(timeOverlap('08:00:00', '09:00:00', '09:00', '10:00'), false);
	});

	test('una che si accavalla sì', () => {
		assert.equal(timeOverlap('09:30', '10:30', '09:00:00', '10:00:00'), true);
		assert.equal(timeOverlap('09:00', '10:00', '09:00:00', '10:00:00'), true);
	});

	test('una contenuta nell’altra sì', () => {
		assert.equal(timeOverlap('09:15', '09:45', '09:00:00', '10:00:00'), true);
	});
});

describe('il conflitto di sala nella generazione', () => {
	const sala = 'sala-1';
	const esistente = { id: 's1', event_id: 'e1', date: '2026-10-05', start_time: '08:00:00', end_time: '09:00:00', room_id: sala, status: 'active' };
	const eventi = [{ id: 'e1', course_id: 'c1' }];
	const corsi = [{ id: 'c1', name: 'Pilates', instructor_id: 'i1' }, { id: 'c2', name: 'Yoga', instructor_id: 'i2' }];

	test('la lezione subito dopo, nella stessa sala, si genera', () => {
		const { conflicts, cleanDates } = checkEventConflicts(
			['2026-10-05'], { start_time: '09:00', end_time: '10:00', room_id: sala }, corsi[1], [esistente], eventi, corsi,
		);
		assert.deepEqual(conflicts, []);
		assert.deepEqual(cleanDates, ['2026-10-05']);
	});

	test('una che si accavalla viene scartata', () => {
		const { conflicts } = checkEventConflicts(
			['2026-10-05'], { start_time: '08:30', end_time: '09:30', room_id: sala }, corsi[1], [esistente], eventi, corsi,
		);
		assert.equal(conflicts.length, 1);
		assert.equal(conflicts[0].type, 'sala');
	});
});

describe('il giorno della settimana di una data', () => {
	test('si legge sul giorno di calendario, non in UTC', () => {
		assert.equal(getDayOfWeekFromDate('2026-10-05'), 'Monday');
		assert.equal(getDayOfWeekFromDate('2026-10-04'), 'Sunday');
	});
});

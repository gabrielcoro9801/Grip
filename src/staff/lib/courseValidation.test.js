// I conflitti di orario fra lezioni.
//
// Il modulo manda "09:00", il database restituisce "09:00:00": confrontate come stringhe
// intere, due lezioni consecutive nella stessa sala risultavano in conflitto.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { timeOverlap, getDayOfWeekFromDate } from './courseValidation.js';

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

// Il conflitto di sala nella generazione lo conta il server (POST /api/calendario/conflitti):
// i suoi test stanno in server/test/calendario.test.js.

describe('il giorno della settimana di una data', () => {
	test('si legge sul giorno di calendario, non in UTC', () => {
		assert.equal(getDayOfWeekFromDate('2026-10-05'), 'Monday');
		assert.equal(getDayOfWeekFromDate('2026-10-04'), 'Sunday');
	});
});

// Il termine di disdetta di un corso: fino a quando il socio disdice da sé.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { limiteDisdetta, motivoDisdettaChiusa } from './corsi.js';

const lezione = { date: '2026-10-12', start_time: '18:00:00', end_time: '19:00:00' };
// Ottobre è ora legale: le 14:30 UTC sono le 16:30 a Roma.
const alle = (oraRoma) => new Date(`2026-10-12T${String(Number(oraRoma.slice(0, 2)) - 2).padStart(2, '0')}:${oraRoma.slice(3)}:00Z`);

describe('il termine di disdetta', () => {
	test("l'inizio meno le ore, anche a cavallo del giorno prima", () => {
		assert.deepEqual(limiteDisdetta(lezione, 2), { data: '2026-10-12', ora: '16:00' });
		assert.deepEqual(limiteDisdetta(lezione, 24), { data: '2026-10-11', ora: '18:00' });
		assert.deepEqual(limiteDisdetta(lezione, 0), { data: '2026-10-12', ora: '18:00' });
		assert.equal(limiteDisdetta(lezione, null), null, 'senza termine: fino alla fine');
	});

	test('aperta prima del limite, chiusa dal limite in poi, con il perché', () => {
		assert.equal(motivoDisdettaChiusa(lezione, 2, alle('15:59')), null);
		assert.match(motivoDisdettaChiusa(lezione, 2, alle('16:00')), /fino a 2 ore prima.*reception/);
		assert.match(motivoDisdettaChiusa(lezione, 1, alle('17:30')), /fino a 1 ora prima/);
		assert.match(motivoDisdettaChiusa(lezione, 0, alle('18:05')), /fino all'inizio/);
		assert.equal(motivoDisdettaChiusa(lezione, null, alle('18:30')), null);
	});
});

// La giornata a ore della finestra del giorno: dove va ogni lezione e quali ore si vedono.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { disponiLezioni, intervalloOre } from './vistaGiorno.js';

const lezione = (id, start_time, end_time) => ({ id, start_time, end_time });
/** id → [colonna, colonne] */
const posti = (blocchi) => Object.fromEntries(blocchi.map((b) => [b.lezione.id, [b.colonna, b.colonne]]));

describe('disponiLezioni', () => {
	test('due lezioni sovrapposte si dividono la larghezza', () => {
		const blocchi = disponiLezioni([lezione('b', '09:30:00', '10:30:00'), lezione('a', '09:00', '10:00')]);
		assert.deepEqual(blocchi.map((b) => b.lezione.id), ['a', 'b'], "nell'ordine di inizio");
		assert.deepEqual(posti(blocchi), { a: [0, 2], b: [1, 2] });
		assert.equal(blocchi[0].inizio, 9 * 60);
		assert.equal(blocchi[1].fine, 10 * 60 + 30);
	});

	test('tre a catena: tutto il gruppo in due colonne, la terza torna nella prima', () => {
		const blocchi = disponiLezioni([
			lezione('a', '09:00', '10:00'), lezione('b', '09:30', '10:30'), lezione('c', '10:15', '11:15'),
		]);
		assert.deepEqual(posti(blocchi), { a: [0, 2], b: [1, 2], c: [0, 2] });
	});

	test('tre alla stessa ora: tre colonne', () => {
		const blocchi = disponiLezioni([lezione('a', '18:00', '19:00'), lezione('b', '18:00', '19:00'), lezione('c', '18:00', '19:00')]);
		assert.deepEqual(blocchi.map((b) => b.colonna).sort(), [0, 1, 2]);
		assert.ok(blocchi.every((b) => b.colonne === 3));
	});

	test('una lezione che finisce quando l’altra comincia non la tocca', () => {
		const blocchi = disponiLezioni([lezione('a', '09:00', '10:00'), lezione('b', '10:00', '11:00')]);
		assert.deepEqual(posti(blocchi), { a: [0, 1], b: [0, 1] });
	});

	test('un giorno vuoto non ha blocchi', () => {
		assert.deepEqual(disponiLezioni([]), []);
		assert.deepEqual(disponiLezioni(undefined), []);
	});
});

describe('intervalloOre', () => {
	test('dalle 7 alle 22 se le lezioni ci stanno dentro', () => {
		assert.deepEqual(intervalloOre([lezione('a', '09:00', '10:00')]), { da: 7, a: 22 });
		assert.deepEqual(intervalloOre([]), { da: 7, a: 22 });
	});

	test('dalla prima lezione se è prima delle 7, fino all’ultima se va oltre', () => {
		assert.deepEqual(intervalloOre([lezione('a', '06:30', '07:30'), lezione('b', '21:30', '22:15')]), { da: 6, a: 23 });
	});
});

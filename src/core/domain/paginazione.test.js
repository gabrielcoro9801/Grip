// La paginazione degli elenchi: 12 tile, 25 righe, e una pagina fuori misura che diventa l'ultima.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paginaDi, numeriPagina } from './paginazione.js';

const numeri = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('un elenco vuoto ha una pagina, vuota', () => {
	assert.deepEqual(paginaDi([], 1, 12), { righe: [], pagina: 1, pagine: 1, totale: 0, da: 0, a: 0 });
	assert.equal(paginaDi([], 3, 12).pagina, 1);
});

test('una pagina oltre l\'ultima diventa l\'ultima', () => {
	const p = paginaDi(numeri(30), 9, 12);
	assert.equal(p.pagina, 3);
	assert.equal(p.pagine, 3);
	assert.deepEqual(p.righe, [25, 26, 27, 28, 29, 30]);
	assert.equal(p.da, 25);
	assert.equal(p.a, 30);
});

test('12 esatti stanno in una pagina', () => {
	const p = paginaDi(numeri(12), 1, 12);
	assert.equal(p.pagine, 1);
	assert.equal(p.righe.length, 12);
	assert.equal(p.a, 12);
});

test('13 fanno due pagine, e la seconda ha il tredicesimo', () => {
	assert.equal(paginaDi(numeri(13), 1, 12).pagine, 2);
	const seconda = paginaDi(numeri(13), 2, 12);
	assert.deepEqual(seconda.righe, [13]);
	assert.equal(seconda.da, 13);
	assert.equal(seconda.a, 13);
});

test('zero, negativi e testo diventano la pagina 1', () => {
	assert.equal(paginaDi(numeri(54), 0, 12).pagina, 1);
	assert.equal(paginaDi(numeri(54), -2, 12).pagina, 1);
	assert.equal(paginaDi(numeri(54), 'due', 12).pagina, 1);
	assert.equal(paginaDi(numeri(54), '2', 12).pagina, 2);
});

test('con il solo totale, come quando conta il server: «1–12 di 54», 5 pagine', () => {
	assert.deepEqual(numeriPagina(54, 1, 12), { pagina: 1, pagine: 5, totale: 54, da: 1, a: 12 });
	assert.deepEqual(numeriPagina(54, 5, 12), { pagina: 5, pagine: 5, totale: 54, da: 49, a: 54 });
});

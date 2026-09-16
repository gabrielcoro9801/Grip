// I conti della pagina "Andamento" dei lead.
//
// Un errore qui non fa cadere niente: fa dire alla palestra che a marzo sono arrivati otto
// contatti invece di nove. Sono i numeri su cui si decide dove investire, quindi si provano.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { filtraContatti, contaPer, contattiPerMese, anniDisponibili, anniNascitaDisponibili } from './lead.js';

const leads = [
	{ id: 1, data_contatto: '2026-01-15', sesso: 'F', anno_nascita: 1990, canale_id: 'ig' },
	{ id: 2, data_contatto: '2026-01-31', sesso: 'M', anno_nascita: 1985, canale_id: 'fb' },
	{ id: 3, data_contatto: '2026-03-02', sesso: 'F', anno_nascita: null, canale_id: 'ig' },
	{ id: 4, data_contatto: '2025-12-31', sesso: 'altro', anno_nascita: 1990, canale_id: 'ig' },
	{ id: 5, data_contatto: '2026-12-01', sesso: 'F', anno_nascita: 2001, canale_id: 'tel' },
];
const ids = (righe) => righe.map((r) => r.id);

describe('i filtri', () => {
	test('senza filtri, tutti', () => {
		assert.equal(filtraContatti(leads).length, 5);
		assert.equal(filtraContatti(leads, { anno: '', mese: null, sesso: undefined }).length, 5);
	});

	test('anno e mese si leggono dalla giornata di contatto, senza sconfinare', () => {
		assert.deepEqual(ids(filtraContatti(leads, { anno: 2026 })), [1, 2, 3, 5]);
		assert.deepEqual(ids(filtraContatti(leads, { anno: '2026', mese: '1' })), [1, 2]);
		assert.deepEqual(ids(filtraContatti(leads, { mese: 12 })), [4, 5], 'il mese senza anno vale per ogni anno');
	});

	test('si combinano', () => {
		assert.deepEqual(ids(filtraContatti(leads, { anno: 2026, sesso: 'F', canaleId: 'ig' })), [1, 3]);
		assert.deepEqual(ids(filtraContatti(leads, { annoNascita: '1990' })), [1, 4]);
	});
});

test('i conteggi per campo, dal più frequente, con i dati mancanti a parte', () => {
	assert.deepEqual(contaPer(leads, 'canale_id'), [
		{ valore: 'ig', totale: 3 }, { valore: 'fb', totale: 1 }, { valore: 'tel', totale: 1 },
	]);
	assert.deepEqual(contaPer(leads, 'anno_nascita').find((r) => r.valore === null), { valore: null, totale: 1 });
});

test('i mesi a zero restano nella serie', () => {
	const serie = contattiPerMese(leads, 2026);
	assert.equal(serie.length, 12);
	assert.deepEqual(serie.map((m) => m.totale), [2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	assert.equal(serie[2].etichetta, 'Marzo');
});

test('le voci dei filtri vengono dai dati, dal più recente', () => {
	assert.deepEqual(anniDisponibili(leads), [2026, 2025]);
	assert.deepEqual(anniNascitaDisponibili(leads), [2001, 1990, 1985]);
	assert.deepEqual(anniDisponibili([]), []);
});

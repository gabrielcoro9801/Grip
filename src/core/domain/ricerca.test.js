// La ricerca dei soci: più parole in qualunque ordine, senza accenti né apostrofi diversi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { corrispondeRicerca } from './ricerca.js';

const alessandro = { nome: 'Alessandro Colombo', email: 'ale.colombo@example.it', codice_socio: 'GR0042', telefono: '+39 340 123 4567' };
const dangelo = { nome: "Giulia D'Angelo", email: 'giulia@example.it', codice_socio: 'GR0007', telefono: null };
const niccolo = { nome: 'Niccolò Ferri', email: null, codice_socio: 'GR0013', telefono: '333 9876543' };

const trova = (socio, testo) => corrispondeRicerca(socio, testo);

test('una parola, come oggi', () => {
	assert.ok(trova(alessandro, 'Alessandro'));
	assert.ok(trova(alessandro, 'colom'));
	assert.ok(!trova(alessandro, 'Rossi'));
});

test('un testo vuoto trova tutti', () => {
	assert.ok(trova(alessandro, ''));
	assert.ok(trova(alessandro, '   '));
	assert.ok(trova(alessandro, undefined));
});

test('«Cognome Nome»: le parole in qualunque ordine', () => {
	assert.ok(trova(alessandro, 'Colombo Alessandro'));
	assert.ok(trova(alessandro, 'Alessandro Colombo'));
	assert.ok(!trova(alessandro, 'Colombo Marco'));
});

test('due parole a metà', () => {
	assert.ok(trova(alessandro, 'colombo ale'));
	assert.ok(trova(alessandro, 'ale col'));
});

test('senza accenti, in tutti e due i versi', () => {
	assert.ok(trova(niccolo, 'Niccolo'));
	assert.ok(trova(niccolo, 'niccolò'));
	assert.ok(trova({ ...niccolo, nome: 'Niccolo Ferri' }, 'Niccolò'));
});

test('gli apostrofi ’ ʼ \' valgono uguale', () => {
	assert.ok(trova(dangelo, 'D’Angelo'));
	assert.ok(trova(dangelo, 'Dʼangelo'));
	assert.ok(trova(dangelo, "d'angelo"));
	assert.ok(trova(dangelo, 'D‘Angelo'));
	assert.ok(trova({ ...dangelo, nome: 'Giulia D’Angelo' }, "D'Angelo"));
});

test('gli spazi doppi non contano', () => {
	assert.ok(trova(alessandro, '  Colombo    Alessandro  '));
	assert.ok(trova(alessandro, 'Colombo\tAlessandro'));
});

test('il telefono, da tre cifre in su', () => {
	assert.ok(trova(alessandro, '340'));
	assert.ok(trova(alessandro, '3401234567'));
	assert.ok(trova(alessandro, '+39 340 123 4567'));
	assert.ok(trova(alessandro, '340-123'));
	assert.ok(!trova(alessandro, '34'), 'due cifre sono troppo poche');
	assert.ok(!trova(dangelo, '340'), 'senza telefono non si trova per numero');
	assert.ok(trova(alessandro, 'colombo 340'), 'una parola nel nome, una nel telefono');
});

test('il codice e l\'email', () => {
	assert.ok(trova(alessandro, 'GR0042'));
	assert.ok(trova(alessandro, 'gr0042'));
	assert.ok(trova(alessandro, 'ale.colombo@'));
	assert.ok(!trova(alessandro, 'GR0007'));
});

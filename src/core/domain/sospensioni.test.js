// La sospensione di un abbonamento: la scadenza si calcola, i giorni sospesi non sono coperti, e il
// motore dei segnali non scambia un socio fermo per uno che sta andando via.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { conSospensioni, abbonamentoCopre, sospensioneIl, motivoSenzaCopertura, MESSAGGIO_SOSPESO, MESSAGGIO_SENZA_ABBONAMENTO } from './abbonamenti.js';
import { segnaliPersona, coperturaAbbonamento, daFare, richiestaRinnovoAperta } from './segnali.js';
import { avvisiSocio, semaforo } from './avvisi.js';

const OGGI = '2026-10-10';
const mensile = { id: 'a', start_date: '2026-10-01', end_date: '2026-10-31' };
const quattordici = { dal: '2026-10-05', al: '2026-10-18' };

describe('conSospensioni', () => {
	test('14 giorni sospesi: scade 14 giorni dopo, e quei giorni non sono coperti', () => {
		const [i] = conSospensioni([mensile], [quattordici]);
		assert.equal(i.end_date, '2026-11-14');
		assert.equal(i.fine_originale, '2026-10-31');
		assert.equal(i.giorni_sospesi, 14);
		assert.equal(abbonamentoCopre([i], '2026-10-04'), true);
		assert.equal(abbonamentoCopre([i], '2026-10-05'), false);
		assert.equal(abbonamentoCopre([i], '2026-10-18'), false);
		assert.equal(abbonamentoCopre([i], '2026-10-19'), true);
		assert.equal(abbonamentoCopre([i], '2026-11-14'), true);
		assert.equal(abbonamentoCopre([i], '2026-11-15'), false);
		assert.equal(sospensioneIl([i], OGGI).al, '2026-10-18');
	});

	test('il rinnovo già comprato che segue slitta; quello lontano resta dov\'è', () => {
		const rinnovo = { id: 'b', start_date: '2026-11-01', end_date: '2026-11-30' };
		const lontano = { id: 'c', start_date: '2027-03-01', end_date: '2027-03-31' };
		const [a, b, c] = conSospensioni([mensile, rinnovo, lontano], [quattordici]);
		assert.equal(a.end_date, '2026-11-14');
		assert.deepEqual([b.start_date, b.end_date], ['2026-11-15', '2026-12-14']);
		assert.deepEqual([c.start_date, c.end_date], ['2027-03-01', '2027-03-31']);
	});

	test('senza sospensioni non cambia niente; un periodo rovesciato si ignora', () => {
		assert.deepEqual(conSospensioni([mensile], []).map((i) => i.end_date), ['2026-10-31']);
		assert.deepEqual(conSospensioni([mensile], [{ dal: '2026-10-20', al: '2026-10-10' }]).map((i) => i.end_date), ['2026-10-31']);
	});

	test('due sospensioni si sommano', () => {
		const [i] = conSospensioni([mensile], [quattordici, { dal: '2026-11-01', al: '2026-11-05' }]);
		assert.equal(i.end_date, '2026-11-19');
	});

	test('il perché non si prenota: sospeso, o senza abbonamento', () => {
		const iscrizioni = conSospensioni([mensile], [quattordici]);
		assert.equal(motivoSenzaCopertura(iscrizioni, '2026-10-12'), MESSAGGIO_SOSPESO);
		assert.equal(motivoSenzaCopertura(iscrizioni, '2026-12-01'), MESSAGGIO_SENZA_ABBONAMENTO);
		assert.equal(motivoSenzaCopertura(iscrizioni, '2026-10-20'), null);
	});
});

describe('la sospensione nel motore e nel semaforo', () => {
	const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
	const iscrizioni = conSospensioni([{ ...mensile, start_date: '2025-10-01' }], [quattordici]);

	test('durante: fase sospeso, niente assenza né calo, e la scadenza è quella allungata', () => {
		const r = segnaliPersona({ socio, iscrizioni, ingressi: { ultimo: '2026-10-04', quattro: 1, dodici: 30, totale: 200 }, oggi: OGGI });
		assert.equal(r.fase, 'sospeso');
		assert.deepEqual(daFare(r.segnali, 'staff'), []);
		assert.equal(r.copertura.fine, '2026-11-14');
		assert.equal(r.copertura.valido, false);
	});

	test('dopo la ripresa l\'assenza si conta dalla ripresa, e il calo non scatta', () => {
		const dopo = '2026-10-25';
		const r = segnaliPersona({ socio, iscrizioni, ingressi: { ultimo: '2026-10-04', quattro: 1, dodici: 30, totale: 200 }, oggi: dopo });
		assert.equal(coperturaAbbonamento(iscrizioni, dopo).ripresa, '2026-10-19');
		assert.equal(r.fase, 'attivo');
		assert.deepEqual(daFare(r.segnali, 'staff'), []);
		const tardi = segnaliPersona({ socio, iscrizioni, ingressi: { ultimo: '2026-10-04', quattro: 0, dodici: 10, totale: 200 }, oggi: '2026-11-03' });
		assert.ok(daFare(tardi.segnali, 'staff').some((s) => s.codice === 'assente'));
		assert.match(daFare(tardi.segnali, 'staff').find((s) => s.codice === 'assente').motivo, /15 giorni/);
	});

	test('il semaforo dice sospeso, non scaduto', () => {
		const avvisi = avvisiSocio({ socio, iscrizioni, documenti: [], oggi: OGGI });
		assert.equal(semaforo(avvisi), 'rosso');
		assert.equal(avvisi[0].codice, 'abbonamento_sospeso');
		assert.match(avvisi[0].testo, /riprende il 19\/10\/2026/);
	});
});

describe('la richiesta di rinnovo dal portale', () => {
	const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
	const iscrizioni = [{ start_date: '2025-10-01', end_date: '2026-10-20', created_date: '2025-10-01T09:00:00Z' }];
	const richiesta = '2026-10-10T08:00:00Z';

	test('aperta finché non arriva un contatto riuscito o un abbonamento nuovo', () => {
		assert.equal(richiestaRinnovoAperta(richiesta, { iscrizioni }), true);
		assert.equal(richiestaRinnovoAperta(richiesta, { ultimoContatto: '2026-10-10T09:00:00Z', iscrizioni }), false);
		assert.equal(richiestaRinnovoAperta(richiesta, { ultimoContatto: '2026-10-09T09:00:00Z', iscrizioni }), true);
		assert.equal(richiestaRinnovoAperta(richiesta, { iscrizioni: [...iscrizioni, { created_date: '2026-10-10T10:00:00Z' }] }), false);
		assert.equal(richiestaRinnovoAperta(null, { iscrizioni }), false);
	});

	test('è il segnale più prezioso, e un contatto di prima non lo nasconde', () => {
		const r = segnaliPersona({
			socio, iscrizioni, ingressi: { ultimo: '2026-10-09', quattro: 8, dodici: 24, totale: 100 }, oggi: OGGI,
			contatti: { ultimo: '2026-10-08', riscontro: '2026-10-08T10:00:00Z', richiestaRinnovo: richiesta },
		});
		const fare = daFare(r.segnali, 'staff');
		assert.equal(fare[0].codice, 'rinnovo_richiesto');
		assert.ok(fare[0].priorita > 90);
		assert.match(fare[0].motivo, /portale oggi/);
	});

	test('un socio archiviato non lo riceve', () => {
		const r = segnaliPersona({ socio: { ...socio, archiviato_il: '2026-10-10' }, iscrizioni, oggi: OGGI, contatti: { richiestaRinnovo: richiesta } });
		assert.deepEqual(daFare(r.segnali, 'staff'), []);
	});
});

describe('il bancone per chi è già entrato dal tornello', () => {
	const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
	const iscrizioni = [{ start_date: '2025-10-01', end_date: '2027-10-01' }];

	test('bentornato e traguardo restano dopo l\'ingresso di oggi', () => {
		const r = segnaliPersona({ socio, iscrizioni, oggi: OGGI, ingressi: { ultimo: OGGI, prima: '2026-09-15', oggi: 1, quattro: 1, dodici: 10, totale: 50 } });
		assert.deepEqual(daFare(r.segnali, 'bancone').map((s) => s.codice).sort(), ['bentornato', 'traguardo']);
		assert.match(daFare(r.segnali, 'bancone').find((s) => s.codice === 'traguardo').motivo, /50°/);
	});

	test('e non si ripetono al secondo ingresso dello stesso giorno, né il giorno dopo', () => {
		const r = segnaliPersona({ socio, iscrizioni, oggi: OGGI, ingressi: { ultimo: OGGI, prima: '2026-10-08', oggi: 2, quattro: 5, dodici: 20, totale: 52 } });
		assert.deepEqual(daFare(r.segnali, 'bancone'), []);
	});
});

// Gli avvisi di un socio: la stessa regola agli ingressi e nel portale.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { avvisiSocio, semaforo } from './avvisi.js';

const OGGI = '2026-10-07';
const adulto = { date_of_birth: '1990-01-01' };
const minore = { date_of_birth: '2012-01-01' };
const valido = [{ start_date: '2026-09-01', end_date: '2026-12-31' }];
const codici = (a) => a.map((x) => x.codice);

describe('gli avvisi', () => {
	test('tutto in regola: nessun avviso, verde', () => {
		const a = avvisiSocio({ socio: adulto, iscrizioni: valido, oggi: OGGI });
		assert.deepEqual(a, []);
		assert.equal(semaforo(a), 'verde');
	});

	test('abbonamento scaduto o assente: rosso, e per primo', () => {
		const a = avvisiSocio({ socio: adulto, iscrizioni: [{ start_date: '2026-01-01', end_date: '2026-09-30' }], oggi: OGGI });
		assert.equal(a[0].codice, 'abbonamento_non_valido');
		assert.match(a[0].testo, /30\/09\/2026/);
		assert.equal(semaforo(a), 'rosso');
		assert.equal(avvisiSocio({ socio: adulto, oggi: OGGI })[0].titolo, 'Nessun abbonamento');
	});

	test('in scadenza senza rinnovo: giallo; con il rinnovo già fatto: niente', () => {
		const breve = [{ start_date: '2026-09-01', end_date: '2026-10-15' }];
		assert.deepEqual(codici(avvisiSocio({ socio: adulto, iscrizioni: breve, oggi: OGGI })), ['abbonamento_in_scadenza']);
		const rinnovato = [...breve, { start_date: '2026-10-16', end_date: '2027-01-15' }];
		assert.deepEqual(avvisiSocio({ socio: adulto, iscrizioni: rinnovato, oggi: OGGI }), []);
	});

	test('i documenti non contano più: un minorenne senza nessun documento è in regola', () => {
		assert.deepEqual(avvisiSocio({ socio: minore, iscrizioni: valido, oggi: OGGI }), []);
	});

	test('il socio archiviato è rosso', () => {
		assert.equal(semaforo(avvisiSocio({ socio: { ...adulto, archiviato_il: '2026-10-01' }, iscrizioni: valido, oggi: OGGI })), 'rosso');
	});
});

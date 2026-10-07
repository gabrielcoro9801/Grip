// Gli avvisi di un socio: la stessa regola al bancone e nel portale.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { avvisiSocio, semaforo } from './avvisi.js';

const OGGI = '2026-10-07';
const adulto = { date_of_birth: '1990-01-01' };
const minore = { date_of_birth: '2012-01-01' };
const valido = [{ start_date: '2026-09-01', end_date: '2026-12-31' }];
const documentiInRegola = [
	{ document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: '2027-06-01' },
	{ document_type: 'documento_identita', created_date: '2026-01-01', expiry_date: '2030-01-01' },
];
const codici = (a) => a.map((x) => x.codice);

describe('gli avvisi', () => {
	test('tutto in regola: nessun avviso, verde', () => {
		const a = avvisiSocio({ socio: adulto, iscrizioni: valido, documenti: documentiInRegola, oggi: OGGI });
		assert.deepEqual(a, []);
		assert.equal(semaforo(a), 'verde');
	});

	test('abbonamento scaduto o assente: rosso, e per primo', () => {
		const a = avvisiSocio({ socio: adulto, iscrizioni: [{ start_date: '2026-01-01', end_date: '2026-09-30' }], documenti: [], oggi: OGGI });
		assert.equal(a[0].codice, 'abbonamento_non_valido');
		assert.match(a[0].testo, /30\/09\/2026/);
		assert.equal(semaforo(a), 'rosso');
		assert.equal(avvisiSocio({ socio: adulto, oggi: OGGI })[0].titolo, 'Nessun abbonamento');
	});

	test('in scadenza senza rinnovo: giallo; con il rinnovo già fatto: niente', () => {
		const breve = [{ start_date: '2026-09-01', end_date: '2026-10-15' }];
		assert.deepEqual(codici(avvisiSocio({ socio: adulto, iscrizioni: breve, documenti: documentiInRegola, oggi: OGGI })), ['abbonamento_in_scadenza']);
		const rinnovato = [...breve, { start_date: '2026-10-16', end_date: '2027-01-15' }];
		assert.deepEqual(avvisiSocio({ socio: adulto, iscrizioni: rinnovato, documenti: documentiInRegola, oggi: OGGI }), []);
	});

	test('documenti: mancanti, scaduti, in scadenza; il consenso solo per il minorenne', () => {
		const scaduto = [{ document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: '2026-09-01' }];
		const a = avvisiSocio({ socio: adulto, iscrizioni: valido, documenti: scaduto, oggi: OGGI });
		assert.deepEqual(codici(a).sort(), ['certificato_medico_scaduto', 'documento_identita_mancante']);
		assert.equal(semaforo(a), 'giallo');

		const inScadenza = [{ ...documentiInRegola[0], expiry_date: '2026-10-20' }, documentiInRegola[1]];
		assert.deepEqual(codici(avvisiSocio({ socio: adulto, iscrizioni: valido, documenti: inScadenza, oggi: OGGI })), ['certificato_medico_in_scadenza']);

		assert.ok(codici(avvisiSocio({ socio: minore, iscrizioni: valido, documenti: documentiInRegola, oggi: OGGI })).includes('consenso_genitori_mancante'));
		assert.ok(!codici(avvisiSocio({ socio: adulto, iscrizioni: valido, documenti: documentiInRegola, oggi: OGGI })).includes('consenso_genitori_mancante'));
	});

	test('un certificato nuovo accanto a uno scaduto: in regola', () => {
		const sostituito = [
			{ document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: '2026-09-01' },
			{ document_type: 'certificato_medico', created_date: '2026-09-02', expiry_date: '2027-09-01' },
			documentiInRegola[1],
		];
		assert.deepEqual(avvisiSocio({ socio: adulto, iscrizioni: valido, documenti: sostituito, oggi: OGGI }), []);
	});

	test('il socio archiviato è rosso', () => {
		assert.equal(semaforo(avvisiSocio({ socio: { ...adulto, archiviato_il: '2026-10-01' }, iscrizioni: valido, documenti: documentiInRegola, oggi: OGGI })), 'rosso');
	});
});

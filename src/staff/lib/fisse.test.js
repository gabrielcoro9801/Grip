// Le prenotazioni fisse come le racconta e le controlla la finestra, prima del server.
process.env.TZ = 'Europe/Rome';

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { periodoFissa, lezioniDaTenere, fineDaNumero, limiteFissa, descriviLimite, controllaPeriodo } from './fisse.js';
import { fineCopertura } from '../../../shared/abbonamenti.js';

// Il lunedì alle 18, da novembre 2026: sei lezioni, la seconda annullata.
const lezione = (date, extra = {}) => ({ id: date, date, start_time: '18:00', end_time: '19:00', status: 'active', ...extra });
const lezioni = [
	lezione('2026-11-02'), lezione('2026-11-09', { status: 'cancelled' }), lezione('2026-11-16'),
	lezione('2026-11-23'), lezione('2026-11-30'), lezione('2026-12-07'),
];
// Il 10 novembre a mezzogiorno.
const adesso = new Date('2026-11-10T12:00:00+01:00');

describe('il periodo in una riga', () => {
	test('con una fine, e senza (dal portale)', () => {
		assert.equal(periodoFissa({ dal: '2026-11-02', al: '2026-12-07' }), 'dal 02/11/2026 al 07/12/2026');
		assert.equal(periodoFissa({ dal: '2026-11-02', al: null }), 'dal 02/11/2026, senza data di fine (dal portale)');
	});
});

describe('per N lezioni', () => {
	test('conta solo le lezioni da tenere: niente annullate, niente finite', () => {
		const daTenere = lezioniDaTenere(lezioni, '2026-11-01', adesso);
		assert.deepEqual(daTenere.map((l) => l.date), ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07']);
		assert.equal(fineDaNumero(daTenere, 3), '2026-11-30');
		assert.equal(fineDaNumero(daTenere, 5), null);
		assert.equal(fineDaNumero(daTenere, 0), null);
	});
});

describe('fin dove si arriva', () => {
	test('il primo fra la fine della sessione e quella dell\'abbonamento', () => {
		assert.deepEqual(limiteFissa({ ultimaLezione: '2026-12-07', fineAbbonamento: '2026-11-30' }), { al: '2026-11-30', perche: 'abbonamento' });
		assert.deepEqual(limiteFissa({ ultimaLezione: '2026-12-07', fineAbbonamento: '9999-12-31' }), { al: '2026-12-07', perche: 'sessione' });
		// Le iscrizioni non lette: decide il server.
		assert.deepEqual(limiteFissa({ ultimaLezione: '2026-12-07', fineAbbonamento: undefined }), { al: '2026-12-07', perche: 'sessione' });
		assert.equal(limiteFissa({ ultimaLezione: '2026-12-07', fineAbbonamento: null }).perche, 'senza_abbonamento');
	});

	test('un rinnovo che parte il giorno dopo allunga la copertura', () => {
		const iscrizioni = [
			{ start_date: '2026-10-01', end_date: '2026-11-15' },
			{ start_date: '2026-11-16', end_date: '2026-12-15' },
		];
		assert.equal(fineCopertura(iscrizioni, '2026-11-10'), '2026-12-15');
		assert.equal(fineCopertura(iscrizioni, '2027-01-10'), null);
	});

	test('la frase sotto il campo', () => {
		assert.equal(descriviLimite({ al: '2026-11-30', perche: 'abbonamento' }), "Al massimo fino al 30/11/2026, quando finisce l'abbonamento del socio.");
		assert.equal(descriviLimite({ al: '2026-12-07', perche: 'sessione' }), 'Al massimo fino al 07/12/2026, l\'ultima lezione della sessione.');
	});
});

describe('il modulo, controllato prima del server', () => {
	const daTenere = lezioniDaTenere(lezioni, '2026-11-10', adesso);
	const limite = { al: '2026-11-30', perche: 'abbonamento' };
	const oggi = '2026-11-10';

	test('per N lezioni diventa la data dell\'N-esima', () => {
		assert.deepEqual(controllaPeriodo({ dal: oggi, fine: 'numero', numero: '2' }, daTenere, limite, oggi), { al: '2026-11-23', lezioni: 2 });
	});

	test('oltre l\'abbonamento, oltre le lezioni, prima di oggi', () => {
		assert.match(controllaPeriodo({ dal: oggi, fine: 'data', al: '2026-12-07' }, daTenere, limite, oggi).errore, /abbonamento del socio finisce il 30\/11\/2026/);
		assert.match(controllaPeriodo({ dal: oggi, fine: 'numero', numero: '9' }, daTenere, limite, oggi).errore, /ha 4 lezioni, non 9/);
		assert.match(controllaPeriodo({ dal: '2026-11-01', fine: 'data', al: '2026-11-23' }, daTenere, limite, oggi).errore, /oggi o più avanti/);
	});
});

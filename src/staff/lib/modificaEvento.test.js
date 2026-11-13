// La modifica di una sessione: quali lezioni tocca e cosa ci scrive.
process.env.TZ = 'Europe/Rome';

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	campiCambiati, lezioniDellaSerie, pianificaModifica, descriviSerie, divergeDalModello, descriviRimozione, fineAttualeSerie,
	richiesteConflitti, conflittiPerLezione, nomeGiorno,
} from './modificaEvento.js';

// Pilates il martedì alle 18, in sala A: ottobre e novembre 2026.
const evento = {
	id: 'ev1', course_id: 'pilates', room_id: 'salaA', capacity: 10, recurrence_type: 'weekly',
	giorno: 'Tuesday', start_date: '2026-10-06', end_condition: 'by_date', end_date: '2026-11-10',
	start_time: '18:00:00', end_time: '19:00:00',
};
const lezione = (id, date, extra = {}) => ({
	id, event_id: 'ev1', date, start_time: '18:00:00', end_time: '19:00:00', room_id: 'salaA', capacity: 10,
	status: 'active', modified_manually: false, confermati: 0, ...extra,
});
const serie = [
	lezione('l1', '2026-10-06'), lezione('l2', '2026-10-13'), lezione('l3', '2026-10-20'),
	lezione('l4', '2026-10-27'), lezione('l5', '2026-11-03'), lezione('l6', '2026-11-10'),
];
const modello = { room_id: 'salaA', start_time: '18:00:00', end_time: '19:00:00', capacity: 10 };
const contesto = (extra = {}) => ({
	rooms: [{ id: 'salaA', name: 'A', stato: 'attivo' }, { id: 'salaB', name: 'B', stato: 'attivo' }],
	...extra,
});

describe('quello che è cambiato', () => {
	test('solo i campi toccati, con gli orari letti in ore e minuti', () => {
		const prima = { course_id: 'pilates', room_id: 'salaA', start_time: '18:00:00', end_time: '19:00:00', capacity: '10', date: '2026-10-06' };
		const dopo = { ...prima, start_time: '18:00', end_time: '19:30', capacity: '10' };
		assert.deepEqual(campiCambiati(prima, dopo), { end_time: '19:30' });
	});

	test('il corso non si cambia più in modifica; la data fine sì', () => {
		const prima = { course_id: 'pilates', room_id: 'salaA', start_time: '18:00', end_time: '19:00', capacity: 10, date: '2026-10-06', end_date: '2026-10-22' };
		assert.deepEqual(campiCambiati(prima, { ...prima, course_id: 'yoga' }), {});
		assert.deepEqual(campiCambiati(prima, { ...prima, end_date: '2026-11-30' }), { end_date: '2026-11-30' });
	});
});

describe('togliere lezioni, raccontato prima di farlo', () => {
	test('solo eliminate, solo annullate, entrambe, e aggiunte', () => {
		assert.equal(descriviRimozione({ eliminate: 1 }), 'Verrà eliminata 1 lezione senza prenotazioni.');
		assert.equal(
			descriviRimozione({ annullate: 2, soci_avvisati: 5 }),
			'2 lezioni hanno prenotazioni: verranno annullate, e 5 soci riceveranno un avviso nel portale.',
		);
		assert.equal(
			descriviRimozione({ eliminate: 3, annullate: 1, soci_avvisati: 1, aggiunte: 0 }),
			'Verranno eliminate 3 lezioni senza prenotazioni. 1 lezione ha prenotazioni: verrà annullata, e 1 socio riceverà un avviso nel portale.',
		);
		assert.equal(descriviRimozione({ aggiunte: 4 }), 'Verranno aggiunte 4 lezioni.');
		assert.equal(descriviRimozione({}), 'Nessuna lezione cambia.');
	});

	test('una sessione a occorrenze finisce con la sua ultima lezione', () => {
		const aOccorrenze = { ...evento, end_condition: 'by_count', end_date: null, occurrence_count: 6 };
		assert.equal(fineAttualeSerie(aOccorrenze, serie), '2026-11-10');
		assert.equal(fineAttualeSerie(evento, []), '2026-11-10');
	});
});

describe('le lezioni della sessione', () => {
	test('da oggi in poi', () => {
		const date = lezioniDellaSerie(evento, serie, { oggi: '2026-10-21' }).map((l) => l.date);
		assert.deepEqual(date, ['2026-10-27', '2026-11-03', '2026-11-10']);
	});

	test('le lezioni annullate e quelle di altre sessioni restano fuori', () => {
		const altre = [...serie, lezione('x', '2026-11-17', { status: 'cancelled' }), { ...lezione('y', '2026-11-17'), event_id: 'ev2' }];
		assert.equal(lezioniDellaSerie(evento, altre, { oggi: '2026-10-01' }).length, 6);
	});
});

describe('le domande sulle sovrapposizioni', () => {
	test('una sola domanda se tutte le lezioni vanno nella stessa sala alla stessa ora', () => {
		const richieste = richiesteConflitti(serie.slice(4), { start_time: '19:00', end_time: '20:00' });
		assert.equal(richieste.length, 1);
		assert.deepEqual(richieste[0].corpo, { date: ['2026-11-03', '2026-11-10'], start_time: '19:00', end_time: '20:00', room_id: 'salaA' });
	});

	test('una lezione messa a parte in un\'altra sala fa una domanda a sé', () => {
		const aParte = lezione('l5', '2026-11-03', { room_id: 'salaB', modified_manually: true });
		const richieste = richiesteConflitti([aParte, serie[5]], { start_time: '17:00' });
		assert.deepEqual(richieste.map((r) => r.corpo.room_id), ['salaB', 'salaA']);
	});

	test('le risposte tornano sulla lezione di quella data', () => {
		const richieste = richiesteConflitti(serie.slice(4), { room_id: 'salaB' });
		const per = conflittiPerLezione(richieste, [{ conflitti: [{ data: '2026-11-10', messaggio: '10/11: sala occupata da «Yoga» 18:30–19:30' }] }]);
		assert.deepEqual([...per], [['l6', '10/11: sala occupata da «Yoga» 18:30–19:30']]);
	});
});

describe('cosa si scrive su ogni lezione', () => {
	test('cambiato il modello, la lezione che gli corrisponde non è "modificata a parte"', () => {
		const nuovo = { ...modello, start_time: '19:00', end_time: '20:00' };
		const { daScrivere, problemi } = pianificaModifica(serie.slice(4), { start_time: '19:00', end_time: '20:00' }, nuovo, contesto());
		assert.equal(problemi.length, 0);
		assert.deepEqual(daScrivere.map((d) => d.dati), [
			{ start_time: '19:00', end_time: '20:00', modified_manually: false },
			{ start_time: '19:00', end_time: '20:00', modified_manually: false },
		]);
	});

	test('una lezione già messa in un\'altra sala tiene la sua sala se si cambia solo l\'orario', () => {
		const aParte = lezione('l3', '2026-10-20', { room_id: 'salaB', modified_manually: true });
		const nuovo = { ...modello, start_time: '17:00' };
		const { daScrivere } = pianificaModifica([aParte], { start_time: '17:00' }, nuovo, contesto());
		assert.deepEqual(daScrivere[0].dati, { start_time: '17:00', modified_manually: true });
	});
});

describe('le lezioni che non si possono cambiare', () => {
	test('una sovrapposizione trovata dal server', () => {
		const conflitti = new Map([['l3', '20/10: sala occupata da «Yoga» 18:30–19:30']]);
		const { daScrivere, problemi } = pianificaModifica(serie.slice(2, 4), { room_id: 'salaB' }, { ...modello, room_id: 'salaB' }, contesto({ conflitti }));
		assert.deepEqual(problemi.map((p) => p.lezione.id), ['l3']);
		assert.equal(problemi[0].messaggio, '20/10: sala occupata da «Yoga» 18:30–19:30');
		assert.deepEqual(daScrivere.map((d) => d.lezione.id), ['l4']);
	});

	test('una sala sospesa proprio quel giorno', () => {
		const rooms = [{ id: 'salaA', name: 'A', stato: 'attivo' }, { id: 'salaB', name: 'B', stato: 'sospeso', sospesa_dal: '2026-10-26', sospesa_al: '2026-10-28' }];
		const { problemi } = pianificaModifica(serie.slice(2, 4), { room_id: 'salaB' }, modello, contesto({ rooms }));
		assert.deepEqual(problemi.map((p) => p.lezione.id), ['l4']);
	});

	test('meno posti dei soci già confermati', () => {
		const lezioni = [lezione('l1', '2026-10-06', { confermati: 3 }), serie[1]];
		const { problemi, daScrivere } = pianificaModifica(lezioni, { capacity: 2 }, { ...modello, capacity: 2 }, contesto());
		assert.deepEqual(problemi.map((p) => p.lezione.id), ['l1']);
		assert.equal(daScrivere.length, 1);
	});

	test('spostato solo l\'inizio, una lezione che finiva prima avrebbe l\'inizio dopo la fine', () => {
		const corta = lezione('l5', '2026-11-03', { end_time: '18:30:00', modified_manually: true });
		const { problemi } = pianificaModifica([corta], { start_time: '18:45' }, { ...modello, start_time: '18:45' }, contesto());
		assert.equal(problemi.length, 1);
	});

	test('una lezione saltata che si discosta dal nuovo modello va segnata come a parte', () => {
		const piena = lezione('l1', '2026-10-06', { confermati: 3 });
		const { daSegnare } = pianificaModifica([piena], { capacity: 2 }, { ...modello, capacity: 2 }, contesto());
		assert.deepEqual(daSegnare.map((l) => l.id), ['l1']);
	});
});

describe('come si racconta una sessione', () => {
	test('il suo giorno, e la fine', () => {
		assert.equal(descriviSerie(evento), 'Ogni martedì, dal 06/10/2026 al 10/11/2026');
		assert.equal(descriviSerie({ ...evento, end_condition: 'by_count', occurrence_count: 12 }), 'Ogni martedì, dal 06/10/2026 per 12 lezioni');
		assert.equal(nomeGiorno('Sunday'), 'domenica');
	});

	test('una lezione identica al modello non diverge, anche con gli orari scritti in due modi', () => {
		assert.equal(divergeDalModello(lezione('l1', '2026-10-06', { start_time: '18:00' }), modello), false);
	});
});

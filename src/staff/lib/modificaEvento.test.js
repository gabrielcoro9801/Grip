// La modifica di un evento dal calendario: quali lezioni tocca e cosa ci scrive.
process.env.TZ = 'Europe/Rome';

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	campiCambiati, lezioniDellaSerie, pianificaModifica, descriviSerie, divergeDalModello, descriviRimozione, fineAttualeSerie,
} from './modificaEvento.js';

// Pilates il martedì e il giovedì alle 18, in sala A: ottobre 2026.
const evento = {
	id: 'ev1', course_id: 'pilates', room_id: 'salaA', capacity: 10, recurrence_type: 'weekly',
	days_of_week: ['Tuesday', 'Thursday'], start_date: '2026-10-06', end_condition: 'by_date', end_date: '2026-10-22',
	start_time: '18:00:00', end_time: '19:00:00',
};
const lezione = (id, date, extra = {}) => ({
	id, event_id: 'ev1', date, start_time: '18:00:00', end_time: '19:00:00', room_id: 'salaA', capacity: 10,
	status: 'active', modified_manually: false, ...extra,
});
const serie = [
	lezione('l1', '2026-10-06'), lezione('l2', '2026-10-08'), lezione('l3', '2026-10-13'),
	lezione('l4', '2026-10-15'), lezione('l5', '2026-10-20'), lezione('l6', '2026-10-22'),
];
const modello = { room_id: 'salaA', start_time: '18:00:00', end_time: '19:00:00', capacity: 10 };
const contesto = (extra = {}) => ({
	sessions: serie, events: [evento], courses: [{ id: 'pilates', instructor_id: 'anna' }],
	rooms: [{ id: 'salaA', name: 'A', stato: 'attivo' }, { id: 'salaB', name: 'B', stato: 'attivo' }],
	bookings: [], corso: { id: 'pilates', instructor_id: 'anna' }, ...extra,
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

	test('una serie a occorrenze finisce con la sua ultima lezione', () => {
		const aOccorrenze = { ...evento, end_condition: 'by_count', end_date: null, occurrence_count: 6 };
		assert.equal(fineAttualeSerie(aOccorrenze, serie), '2026-10-22');
		assert.equal(fineAttualeSerie(evento, []), '2026-10-22');
	});
});

describe('tutta la serie', () => {
	test('da oggi in poi, solo nei giorni scelti', () => {
		const date = lezioniDellaSerie(evento, serie, { giorni: ['Tuesday'], oggi: '2026-10-10' }).map((l) => l.date);
		assert.deepEqual(date, ['2026-10-13', '2026-10-20']);
	});

	test('le lezioni annullate e quelle di altri eventi restano fuori', () => {
		const altre = [...serie, lezione('x', '2026-10-27', { status: 'cancelled' }), { ...lezione('y', '2026-10-27'), event_id: 'ev2' }];
		assert.equal(lezioniDellaSerie(evento, altre, { oggi: '2026-10-01' }).length, 6);
	});
});

describe('cosa si scrive su ogni lezione', () => {
	test('cambiato il modello, la lezione che gli corrisponde non è "modificata a parte"', () => {
		const nuovo = { ...modello, start_time: '19:00' , end_time: '20:00' };
		const { daScrivere, problemi } = pianificaModifica(serie.slice(4), { start_time: '19:00', end_time: '20:00' }, nuovo, contesto());
		assert.equal(problemi.length, 0);
		assert.deepEqual(daScrivere.map((d) => d.dati), [
			{ start_time: '19:00', end_time: '20:00', modified_manually: false },
			{ start_time: '19:00', end_time: '20:00', modified_manually: false },
		]);
	});

	test('solo il martedì: il modello resta, e le lezioni cambiate sono "modificate a parte"', () => {
		const { daScrivere } = pianificaModifica([serie[2]], { room_id: 'salaB' }, modello, contesto());
		assert.deepEqual(daScrivere[0].dati, { room_id: 'salaB', modified_manually: true });
	});

	test('una lezione già messa in un\'altra sala tiene la sua sala se si cambia solo l\'orario', () => {
		const aParte = lezione('l3', '2026-10-13', { room_id: 'salaB', modified_manually: true });
		const nuovo = { ...modello, start_time: '17:00' };
		const { daScrivere } = pianificaModifica([aParte], { start_time: '17:00' }, nuovo, contesto());
		assert.deepEqual(daScrivere[0].dati, { start_time: '17:00', modified_manually: true });
	});
});

describe('le lezioni che non si possono cambiare', () => {
	test('una sala occupata da un altro corso quel giorno', () => {
		const yoga = { id: 's-yoga', event_id: 'ev2', date: '2026-10-13', start_time: '18:30', end_time: '19:30', room_id: 'salaB', status: 'active' };
		const { daScrivere, problemi } = pianificaModifica(serie.slice(2, 4), { room_id: 'salaB' }, modello, contesto({
			sessions: [...serie, yoga], events: [evento, { id: 'ev2', course_id: 'yoga' }],
			courses: [{ id: 'pilates', instructor_id: 'anna' }, { id: 'yoga', name: 'Yoga', instructor_id: 'luca' }],
		}));
		assert.deepEqual(problemi.map((p) => p.lezione.id), ['l3']);
		assert.equal(problemi[0].messaggio, '13/10: sala occupata da «Yoga» 18:30–19:30');
		assert.deepEqual(daScrivere.map((d) => d.lezione.id), ['l4']);
	});

	test('una sala sospesa proprio quel giorno', () => {
		const rooms = [{ id: 'salaA', name: 'A', stato: 'attivo' }, { id: 'salaB', name: 'B', stato: 'sospeso', sospesa_dal: '2026-10-14', sospesa_al: '2026-10-16' }];
		const { problemi } = pianificaModifica(serie.slice(2, 4), { room_id: 'salaB' }, modello, contesto({ rooms }));
		assert.deepEqual(problemi.map((p) => p.lezione.id), ['l4']);
	});

	test('meno posti dei soci già confermati', () => {
		const bookings = [1, 2, 3].map((n) => ({ id: `b${n}`, session_id: 'l1', status: 'confirmed' }));
		const { problemi, daScrivere } = pianificaModifica(serie.slice(0, 2), { capacity: 2 }, { ...modello, capacity: 2 }, contesto({ bookings }));
		assert.deepEqual(problemi.map((p) => p.lezione.id), ['l1']);
		assert.equal(daScrivere.length, 1);
	});

	test('spostato solo l\'inizio, una lezione che finiva prima avrebbe l\'inizio dopo la fine', () => {
		const corta = lezione('l5', '2026-10-20', { end_time: '18:30:00', modified_manually: true });
		const { problemi } = pianificaModifica([corta], { start_time: '18:45' }, { ...modello, start_time: '18:45' }, contesto());
		assert.equal(problemi.length, 1);
	});

	test('una lezione saltata che si discosta dal nuovo modello va segnata come a parte', () => {
		const bookings = [1, 2, 3].map((n) => ({ id: `b${n}`, session_id: 'l1', status: 'confirmed' }));
		const { daSegnare } = pianificaModifica([serie[0]], { capacity: 2 }, { ...modello, capacity: 2 }, contesto({ bookings }));
		assert.deepEqual(daSegnare.map((l) => l.id), ['l1']);
	});
});

describe('come si racconta una serie', () => {
	test('i giorni in ordine di settimana, e la fine', () => {
		assert.equal(descriviSerie({ ...evento, days_of_week: ['Thursday', 'Tuesday'] }), 'Ogni martedì e giovedì, dal 06/10/2026 al 22/10/2026');
		assert.equal(descriviSerie({ ...evento, end_condition: 'by_count', occurrence_count: 12 }), 'Ogni martedì e giovedì, dal 06/10/2026 per 12 lezioni');
	});

	test('una lezione identica al modello non diverge, anche con gli orari scritti in due modi', () => {
		assert.equal(divergeDalModello(lezione('l1', '2026-10-06', { start_time: '18:00' }), modello), false);
	});
});

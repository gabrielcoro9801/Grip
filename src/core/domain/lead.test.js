// Le regole della strada di un lead, e i conti che ne tira fuori la Dashboard.
//
// Sbagliare qui non fa cadere niente: fa vedere alla reception una prova in più o in meno,
// o un lead da richiamare che non c'è. Sono gli errori che nessuno segnala, perché il numero
// sembra plausibile.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	transizioneConsentita,
	puoPrenotareProva,
	puoConvertire,
	statoDopoEsito,
	spostaData,
	leadPrevistiAiCorsi,
	proveDaEsitare,
	leadDaRicontattare,
	riepilogoProve,
	STATI_LEAD,
} from './lead.js';

describe('i passaggi di stato', () => {
	test('gli stati che raccontano un fatto non si scelgono da un menu', () => {
		for (const { valore } of STATI_LEAD) {
			assert.equal(transizioneConsentita(valore, 'prova_prenotata'), false, `da ${valore}`);
			assert.equal(transizioneConsentita(valore, 'prova_svolta'), false, `da ${valore}`);
			assert.equal(transizioneConsentita(valore, 'iscritto'), false, `da ${valore}`);
		}
	});

	test("un iscritto non torna indietro, un perso sì", () => {
		assert.equal(transizioneConsentita('iscritto', 'contattato'), false);
		assert.equal(transizioneConsentita('perso', 'contattato'), true);
	});

	test('uno stato sconosciuto non apre nessuna porta', () => {
		assert.equal(transizioneConsentita('inventato', 'contattato'), false);
		assert.equal(puoPrenotareProva('inventato'), false);
		assert.equal(puoConvertire('inventato'), false);
	});

	test('prova e conversione non valgono per chi è già chiuso', () => {
		assert.equal(puoPrenotareProva('perso'), false);
		assert.equal(puoPrenotareProva('iscritto'), false);
		assert.equal(puoPrenotareProva('contattato'), true);
		assert.equal(puoConvertire('iscritto'), false);
		assert.equal(puoConvertire('perso'), true, 'chi era perso può comunque iscriversi');
	});

	test("chi salta la prova si richiama, non si perde", () => {
		assert.equal(statoDopoEsito('presente'), 'prova_svolta');
		assert.equal(statoDopoEsito('assente'), 'contattato');
		assert.equal(statoDopoEsito('forse'), null);
	});
});

describe('le date', () => {
	test('spostaData attraversa mesi, anni e il cambio d\'ora', () => {
		assert.equal(spostaData('2026-09-28', 7), '2026-10-05');
		assert.equal(spostaData('2026-12-30', 3), '2027-01-02');
		assert.equal(spostaData('2026-10-24', 2), '2026-10-26');
	});
});

const dati = () => ({
	courses: [{ id: 'c1', name: 'Yoga' }, { id: 'c2', name: 'Boxe' }],
	events: [{ id: 'e1', course_id: 'c1' }, { id: 'e2', course_id: 'c2' }],
	sessions: [
		{ id: 's-ieri', event_id: 'e1', date: '2026-09-15', start_time: '18:00:00', status: 'active' },
		{ id: 's-oggi', event_id: 'e2', date: '2026-09-16', start_time: '19:00:00', status: 'active' },
		{ id: 's-dopo', event_id: 'e1', date: '2026-09-18', start_time: '09:00:00', status: 'active' },
		{ id: 's-lim', event_id: 'e1', date: '2026-09-23', start_time: '09:00:00', status: 'active' },
		{ id: 's-fuori', event_id: 'e1', date: '2026-09-24', start_time: '09:00:00', status: 'active' },
		{ id: 's-annullata', event_id: 'e2', date: '2026-09-17', start_time: '09:00:00', status: 'cancelled' },
	],
	leads: [
		{ id: 'l1', full_name: 'Anna', stato: 'prova_prenotata' },
		{ id: 'l2', full_name: 'Bruno', stato: 'prova_prenotata' },
	],
	bookings: [
		{ id: 'b1', session_id: 's-ieri', lead_id: 'l1', status: 'confirmed' },
		{ id: 'b2', session_id: 's-oggi', lead_id: 'l2', status: 'confirmed' },
		{ id: 'b3', session_id: 's-dopo', lead_id: 'l1', status: 'waitlisted' },
		{ id: 'b4', session_id: 's-lim', lead_id: 'l2', status: 'confirmed' },
		{ id: 'b5', session_id: 's-fuori', lead_id: 'l2', status: 'confirmed' },
		{ id: 'b6', session_id: 's-dopo', lead_id: 'l2', status: 'cancelled' },
		{ id: 'b7', session_id: 's-dopo', member_id: 'm1', status: 'confirmed' },
		{ id: 'b8', session_id: 's-annullata', lead_id: 'l1', status: 'confirmed' },
	],
});

describe('i lead previsti ai corsi', () => {
	test('solo le prove dei lead, da oggi a sette giorni compresi, senza disdette né lezioni annullate', () => {
		const gruppi = leadPrevistiAiCorsi(dati(), '2026-09-16', 7);
		const ids = gruppi.flatMap((g) => g.prove.map((p) => p.booking_id)).sort();
		assert.deepEqual(ids, ['b2', 'b3', 'b4']);
	});

	test('raggruppate per corso, e i corsi in ordine di prima prova', () => {
		const gruppi = leadPrevistiAiCorsi(dati(), '2026-09-16', 7);
		assert.deepEqual(gruppi.map((g) => g.corso.nome), ['Boxe', 'Yoga']);
		assert.deepEqual(gruppi[1].prove.map((p) => p.data), ['2026-09-18', '2026-09-23']);
		assert.equal(gruppi[1].prove[0].nome, 'Anna');
		assert.equal(gruppi[1].prove[0].stato_prenotazione, 'waitlisted', 'la lista d\'attesa si vede');
	});

	test('senza prove, nessun gruppo', () => {
		assert.deepEqual(leadPrevistiAiCorsi({}, '2026-09-16'), []);
	});
});

test('le prove da esitare sono quelle passate, confermate e senza presenza', () => {
	const d = dati();
	d.bookings.push({ id: 'b9', session_id: 's-ieri', lead_id: 'l2', status: 'confirmed', presenza: 'presente' });
	assert.deepEqual(proveDaEsitare(d, '2026-09-16').map((b) => b.id), ['b1']);
});

describe('chi ricontattare', () => {
	const leads = [
		{ id: 'nuovo-recente', stato: 'nuovo', created_date: '2026-09-15T10:00:00Z' },
		{ id: 'nuovo-vecchio', stato: 'nuovo', created_date: '2026-09-01T10:00:00Z' },
		{ id: 'nuovo-programmato', stato: 'nuovo', prossima_azione_il: '2026-09-20' },
		{ id: 'in-ritardo', stato: 'contattato', prossima_azione_il: '2026-09-10' },
		{ id: 'oggi', stato: 'proposta', prossima_azione_il: '2026-09-16' },
		{ id: 'domani', stato: 'proposta', prossima_azione_il: '2026-09-17' },
		{ id: 'perso', stato: 'perso', prossima_azione_il: '2026-09-01' },
		{ id: 'iscritto', stato: 'iscritto' },
	];

	test('prima i nuovi mai richiamati, poi le azioni in ritardo', () => {
		assert.deepEqual(
			leadDaRicontattare(leads, '2026-09-16').map((l) => l.id),
			['nuovo-vecchio', 'nuovo-recente', 'in-ritardo', 'oggi'],
		);
	});
});

test('la conversione si conta sulle persone, non sulle prenotazioni', () => {
	const r = riepilogoProve({
		leads: [
			{ id: 'a', stato: 'iscritto' },
			{ id: 'b', stato: 'proposta' },
			{ id: 'c', stato: 'contattato' },
		],
		bookings: [
			{ lead_id: 'a', status: 'confirmed', presenza: 'presente' },
			{ lead_id: 'a', status: 'confirmed', presenza: 'presente' },
			{ lead_id: 'b', status: 'confirmed', presenza: 'presente' },
			{ lead_id: 'c', status: 'confirmed', presenza: 'assente' },
			{ lead_id: 'c', status: 'cancelled' },
			{ member_id: 'm', status: 'confirmed', presenza: 'presente' },
		],
	});
	assert.deepEqual(r, { prenotate: 4, svolte: 3, assenti: 1, convertite: 1, conversione: 0.5 });
});

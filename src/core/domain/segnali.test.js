// Il motore dei segnali: fasi, rischio spiegato, contatti che nascondono, presenze e no-show.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { segnaliPersona, esitoPrenotazione, coperturaAbbonamento, eCompleanno, daFare, perche, fase } from './segnali.js';
import { spostaGiorni } from './giorni.js';

const OGGI = '2026-10-10';
const g = (n) => spostaGiorni(OGGI, n);
// Un socio "normale": iscritto da un anno, abbonamento valido per mesi, entra due volte a settimana.
const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
const annuale = [{ id: 'a1', plan_name: 'Annuale', start_date: '2026-01-01', end_date: '2026-12-31' }];
const regolare = { ultimo: g(-2), quattro: 8, dodici: 24, totale: 120 };
const certificatoBuono = [{ id: 'c1', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: '2027-06-01' }];
const calcola = (extra = {}) => segnaliPersona({ socio, iscrizioni: annuale, documenti: certificatoBuono, ingressi: regolare, oggi: OGGI, ...extra });
const staff = (r) => daFare(r.segnali, 'staff').map((s) => s.codice);

describe('le fasi', () => {
	test('un socio regolare è attivo e non ha niente da fare', () => {
		const r = calcola();
		assert.equal(r.fase, 'attivo');
		assert.deepEqual(staff(r), []);
	});

	test('chi non è socio è un contatto, con le condizioni della sua trattativa', () => {
		const r = segnaliPersona({ trattativa: { stato: 'nuovo', data_contatto: g(-1) }, oggi: OGGI });
		assert.equal(r.fase, 'lead');
		assert.deepEqual(staff(r), ['da_contattare']);
		assert.equal(fase(r.fase).etichetta, 'Contatto');
	});

	test('nuovo nei primi 30 giorni, ambientamento fino a 90, poi attivo', () => {
		const da = (giorni) => calcola({ iscrizioni: [{ start_date: g(-giorni), end_date: g(200) }], ingressi: { ...regolare, ultimo: OGGI } }).fase;
		assert.equal(da(0), 'nuovo');
		assert.equal(da(30), 'nuovo');
		assert.equal(da(31), 'ambientamento');
		assert.equal(da(90), 'ambientamento');
		assert.equal(da(91), 'attivo');
	});

	test('un rinnovo con qualche settimana di ritardo non lo fa tornare nuovo', () => {
		const r = calcola({ iscrizioni: [
			{ start_date: '2025-06-01', end_date: g(-40) },
			{ start_date: g(-5), end_date: g(25) },
		] });
		assert.equal(r.fase, 'attivo');
		assert.equal(r.copertura.inizio, '2025-06-01');
	});

	test('in scadenza a 14 giorni, se non ha già rinnovato', () => {
		const tre = calcola({ iscrizioni: [{ id: 's1', plan_name: 'Mensile', start_date: g(-27), end_date: g(3) }] });
		assert.equal(tre.fase, 'in_scadenza');
		const segnale = tre.segnali.find((s) => s.codice === 'in_scadenza' && s.pubblico === 'staff');
		assert.equal(segnale.motivo, 'scade tra 3 giorni');
		assert.deepEqual(segnale.dati, { iscrizione_id: 's1', abbonamento: 'Mensile', giorni: 3 });
		const rinnovato = calcola({ iscrizioni: [{ start_date: g(-27), end_date: g(3) }, { start_date: g(4), end_date: g(34) }] });
		assert.notEqual(rinnovato.fase, 'in_scadenza');
		assert.equal(rinnovato.copertura.scadenza, g(34));
	});

	test('scaduto da 60 giorni si recupera, da 61 è un ex socio; un archiviato è ex socio', () => {
		assert.equal(calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(-60) }] }).fase, 'scaduto_recuperabile');
		assert.equal(calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(-61) }] }).fase, 'ex_socio');
		assert.equal(calcola({ socio: { ...socio, archiviato_il: g(-3) } }).fase, 'ex_socio');
	});

	test('appena iscritto senza abbonamento è nuovo, iscritto da tanto senza abbonamento è ex', () => {
		assert.equal(calcola({ socio: { ...socio, created_date: g(-3) }, iscrizioni: [] }).fase, 'nuovo');
		assert.equal(calcola({ iscrizioni: [] }).fase, 'ex_socio');
	});

	test('assente da 14 giorni senza ingressi, contati da quando è socio', () => {
		assert.equal(calcola({ ingressi: { ...regolare, ultimo: g(-14), quattro: 2 } }).fase, 'assente');
		assert.equal(calcola({ ingressi: { ...regolare, ultimo: g(-13), quattro: 2 } }).fase, 'in_calo');
		// Iscritto da 10 giorni e mai entrato: non è ancora assente.
		const nuovo = calcola({ iscrizioni: [{ start_date: g(-10), end_date: g(20) }], ingressi: { ultimo: null, quattro: 0, dodici: 0, totale: 0 } });
		assert.equal(nuovo.fase, 'nuovo');
	});

	test('in calo sotto la metà della media delle 12 settimane; con pochi ingressi il calo non conta', () => {
		const r = calcola({ ingressi: { ...regolare, quattro: 3, dodici: 27 } });
		assert.equal(r.fase, 'in_calo');
		assert.equal(r.segnali.find((s) => s.codice === 'in_calo').motivo, '3 ingressi in 4 settimane contro 9 di media');
		assert.equal(calcola({ ingressi: { ...regolare, quattro: 5, dodici: 27 } }).fase, 'attivo');
		assert.equal(calcola({ ingressi: { ...regolare, quattro: 0, dodici: 6 } }).fase, 'attivo');
	});

	test('se la palestra non registra gli ingressi nessuno risulta assente', () => {
		const r = calcola({ ingressi: null });
		assert.equal(r.fase, 'attivo');
		assert.deepEqual(staff(r), []);
	});
});

describe('i segnali', () => {
	test('il rischio si spiega in parole', () => {
		const r = calcola({
			iscrizioni: [{ start_date: '2025-01-01', end_date: g(9) }],
			ingressi: { ...regolare, quattro: 3, dodici: 27 }, noShow: 2,
		});
		const fare = daFare(r.segnali);
		assert.deepEqual(fare.map((s) => s.codice), ['in_scadenza', 'in_calo', 'no_show_ripetuti']);
		assert.equal(perche(fare), 'scade tra 9 giorni · 3 ingressi in 4 settimane contro 9 di media · 2 no-show in 4 settimane');
	});

	test('un contatto nasconde i segnali per 7 giorni, un rimando fino al giorno scelto', () => {
		const scadenza = { iscrizioni: [{ start_date: '2025-01-01', end_date: g(3) }] };
		const contattato = calcola({ ...scadenza, contatti: { ultimo: g(-2) } });
		assert.deepEqual(staff(contattato), []);
		assert.equal(contattato.segnali.find((s) => s.codice === 'in_scadenza').nascostoFino, g(5));
		assert.deepEqual(staff(calcola({ ...scadenza, contatti: { ultimo: g(-7) } })), ['in_scadenza']);
		assert.deepEqual(staff(calcola({ ...scadenza, contatti: { rimandatoAl: g(2) } })), []);
		assert.deepEqual(staff(calcola({ ...scadenza, contatti: { rimandatoAl: OGGI } })), ['in_scadenza']);
	});

	test('i segnali di un lead li nasconde solo il rimando: il contatto ne cambia lo stato', () => {
		const lead = { trattativa: { stato: 'nuovo', data_contatto: g(-1) }, oggi: OGGI };
		assert.deepEqual(staff(segnaliPersona({ ...lead, contatti: { ultimo: g(-1) } })), ['da_contattare']);
		assert.deepEqual(staff(segnaliPersona({ ...lead, contatti: { rimandatoAl: g(3) } })), []);
	});

	test('ambientamento: la prima settimana, e chi a un mese viene poco', () => {
		const sette = calcola({ iscrizioni: [{ start_date: g(-7), end_date: g(23) }], ingressi: { ultimo: g(-1), quattro: 2, dodici: 2, totale: 2 } });
		assert.deepEqual(staff(sette), ['ambientamento_giorno_7']);
		const mese = calcola({ iscrizioni: [{ start_date: g(-30), end_date: g(60) }], ingressi: { ultimo: g(-3), quattro: 2, dodici: 3, totale: 3 } });
		assert.deepEqual(staff(mese), ['ambientamento_pochi_ingressi']);
	});

	test('i certificati: scaduto o in scadenza, uno per socio; un ex socio non si richiama', () => {
		const scaduto = calcola({ documenti: [{ id: 'd1', file_name: 'c.pdf', document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: g(-1) }] });
		const s = scaduto.segnali.find((x) => x.codice === 'certificato_scaduto');
		assert.deepEqual(s.dati, { documento_id: 'd1', file_name: 'c.pdf', giorni: -1, scaduto: true });
		const inScadenza = calcola({ documenti: [{ document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: g(20) }] });
		assert.ok(staff(inScadenza).includes('certificato_in_scadenza'));
		const ex = calcola({ socio: { ...socio, archiviato_il: g(-1) }, documenti: [{ document_type: 'certificato_medico', expiry_date: g(-1) }] });
		assert.deepEqual(staff(ex), []);
	});

	test('compleanno, anche per chi è nato il 29 febbraio', () => {
		assert.ok(staff(calcola({ socio: { ...socio, date_of_birth: '1990-10-10' } })).includes('compleanno'));
		assert.equal(eCompleanno('2000-02-29', '2027-02-28'), true);
		assert.equal(eCompleanno('2000-02-29', '2028-02-28'), false);
		assert.equal(eCompleanno('2000-02-29', '2028-02-29'), true);
	});

	test('al bancone: proponi il rinnovo, bentornato, traguardo; un saluto basta per oggi', () => {
		const r = calcola({
			socio: { ...socio, date_of_birth: '1990-10-10' },
			iscrizioni: [{ start_date: '2025-01-01', end_date: g(3) }],
			ingressi: { ultimo: g(-20), quattro: 0, dodici: 10, totale: 49 },
		});
		const bancone = daFare(r.segnali, 'bancone');
		assert.deepEqual(bancone.map((s) => s.codice).sort(), ['bentornato', 'compleanno', 'in_scadenza', 'traguardo']);
		assert.equal(bancone.find((s) => s.codice === 'in_scadenza').motivo, 'Scade tra 3 giorni: proponi il rinnovo');
		assert.equal(bancone.find((s) => s.codice === 'traguardo').motivo, 'Oggi è il suo 50° ingresso!');
		const salutato = calcola({
			socio: { ...socio, date_of_birth: '1990-10-10' },
			iscrizioni: [{ start_date: '2025-01-01', end_date: g(3) }], contatti: { ultimo: OGGI },
		});
		assert.deepEqual(daFare(salutato.segnali, 'bancone'), []);
	});

	test('il portale riceve gli avvisi di sempre', () => {
		const r = calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(-5) }] });
		assert.ok(r.segnali.some((s) => s.pubblico === 'socio' && s.codice === 'abbonamento_non_valido'));
	});
});

describe('presenze e no-show', () => {
	const lezione = { data: '2026-10-08', inizio: '18:00', fine: '19:00' };
	const roma = (data, ora) => new Date(`${data}T${ora}:00+02:00`);

	test('entrato da un\'ora prima alla fine: presente', () => {
		assert.equal(esitoPrenotazione(lezione, [roma('2026-10-08', '17:00')], roma('2026-10-10', '09:00')), 'presente');
		assert.equal(esitoPrenotazione(lezione, [roma('2026-10-08', '19:00')], roma('2026-10-10', '09:00')), 'presente');
	});

	test('entrato troppo presto, un altro giorno o mai, a lezione finita: no-show', () => {
		assert.equal(esitoPrenotazione(lezione, [roma('2026-10-08', '16:59')], roma('2026-10-10', '09:00')), 'no_show');
		assert.equal(esitoPrenotazione(lezione, [roma('2026-10-09', '18:10')], roma('2026-10-10', '09:00')), 'no_show');
		assert.equal(esitoPrenotazione(lezione, [], roma('2026-10-08', '19:01')), 'no_show');
	});

	test('a lezione non finita, senza ingresso, non è ancora niente', () => {
		assert.equal(esitoPrenotazione(lezione, [], roma('2026-10-08', '18:30')), 'in_attesa');
	});
});

describe('la copertura dell\'abbonamento', () => {
	test('senza fine copre sempre e non scade', () => {
		const c = coperturaAbbonamento([{ start_date: '2026-01-01', end_date: null }], OGGI);
		assert.equal(c.valido, true);
		assert.equal(c.fine, null);
		assert.equal(c.scadenza, null);
	});
});

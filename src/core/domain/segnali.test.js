// Il motore dei segnali: gli stati, il rischio spiegato, il bancone, presenze e no-show.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	segnaliPersona, esitoPrenotazione, coperturaAbbonamento, eCompleanno, compleannoVicino, daFare, perche, fase,
	SEGNALI, CODICI_SEGNALE, regolaSegnale,
} from './segnali.js';
import { spostaGiorni } from './giorni.js';
import { soglieDi } from './soglie.js';

const OGGI = '2026-10-10';
const g = (n) => spostaGiorni(OGGI, n);
// Un socio "normale": iscritto da un anno, abbonamento valido per mesi, entra due volte a settimana,
// documenti in regola.
const socio = { created_date: '2025-01-01', archiviato_il: null, date_of_birth: '1990-05-20' };
const annuale = [{ id: 'a1', plan_name: 'Annuale', start_date: '2026-01-01', end_date: '2026-12-31' }];
const regolare = { ultimo: g(-2), quattro: 8, dodici: 24, totale: 120 };
const documentiInRegola = [
	{ id: 'c1', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: '2027-06-01' },
	{ id: 'i1', document_type: 'documento_identita', created_date: '2026-01-01', expiry_date: '2030-01-01' },
];
const calcola = (extra = {}) => segnaliPersona({ socio, iscrizioni: annuale, documenti: documentiInRegola, ingressi: regolare, oggi: OGGI, ...extra });
const staff = (r) => daFare(r.segnali, 'staff').map((s) => s.codice);

describe('gli stati', () => {
	test('un socio regolare è attivo e non ha niente da fare', () => {
		const r = calcola();
		assert.equal(r.fase, 'attivo');
		assert.deepEqual(staff(r), []);
	});

	test('chi non è socio è un contatto: il suo lavoro sta nella sezione Lead, non qui', () => {
		const r = segnaliPersona({ trattativa: { stato: 'nuovo', data_contatto: g(-1) }, oggi: OGGI });
		assert.equal(r.fase, 'lead');
		assert.deepEqual(r.segnali, []);
		assert.equal(fase(r.fase).etichetta, 'Contatto');
	});

	test('nuovo nei primi 30 giorni di abbonamento, poi attivo', () => {
		const da = (giorni) => calcola({ iscrizioni: [{ start_date: g(-giorni), end_date: g(200) }], ingressi: { ...regolare, ultimo: OGGI } }).fase;
		assert.equal(da(0), 'nuovo');
		assert.equal(da(30), 'nuovo');
		assert.equal(da(31), 'attivo');
	});

	test('un rinnovo con qualche settimana di ritardo non lo fa tornare nuovo', () => {
		const r = calcola({ iscrizioni: [
			{ start_date: '2025-06-01', end_date: g(-40) },
			{ start_date: g(-5), end_date: g(25) },
		] });
		assert.equal(r.fase, 'attivo');
		assert.equal(r.copertura.inizio, '2025-06-01');
	});

	test('in scadenza non è uno stato: resta attivo, e il rinnovo è un segnale', () => {
		const tre = calcola({ iscrizioni: [{ id: 's1', plan_name: 'Mensile', start_date: '2025-01-01', end_date: g(3) }] });
		assert.equal(tre.fase, 'attivo');
		const segnale = tre.segnali.find((s) => s.codice === 'in_scadenza' && s.pubblico === 'staff');
		assert.equal(segnale.motivo, 'scade tra 3 giorni');
		assert.deepEqual(segnale.dati, { iscrizione_id: 's1', abbonamento: 'Mensile', giorni: 3, fine: g(3) });
		const rinnovato = calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(3) }, { start_date: g(4), end_date: g(34) }] });
		assert.ok(!staff(rinnovato).includes('in_scadenza'));
		assert.equal(rinnovato.copertura.scadenza, g(34));
	});

	test('senza abbonamento: scaduto (seguito per scadutoGiorni o no), mai avuto, appena iscritto senza pagare', () => {
		const sessanta = calcola({ iscrizioni: [{ id: 's1', start_date: '2025-01-01', end_date: g(-60) }] });
		assert.equal(sessanta.fase, 'senza_abbonamento');
		assert.ok(staff(sessanta).includes('scaduto'));
		assert.deepEqual(sessanta.segnali.find((s) => s.codice === 'scaduto').dati, { iscrizione_id: 's1', abbonamento: null, giorni: -60, fine: g(-60) });
		const sessantuno = calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(-61) }] });
		assert.equal(sessantuno.fase, 'senza_abbonamento');
		assert.ok(!staff(sessantuno).includes('scaduto'));
		// La finestra la sceglie la palestra.
		const trenta = soglieDi({ soglie: { scadutoGiorni: 30 } });
		assert.ok(!staff(calcola({ soglie: trenta, iscrizioni: [{ start_date: '2025-01-01', end_date: g(-31) }] })).includes('scaduto'));
		assert.match(regolaSegnale('scaduto', trenta), /30 giorni/);
		assert.equal(calcola({ socio: { ...socio, created_date: g(-3) }, iscrizioni: [] }).fase, 'senza_abbonamento');
		assert.equal(calcola({ iscrizioni: [] }).fase, 'senza_abbonamento');
	});

	test('archiviato vince su tutto, e non ha niente da fare', () => {
		const r = calcola({ socio: { ...socio, archiviato_il: g(-3) }, iscrizioni: [{ start_date: '2025-01-01', end_date: g(-10) }] });
		assert.equal(r.fase, 'archiviato');
		assert.deepEqual(staff(r), []);
	});

	test('chi non entra da 14 giorni è in calo, contati da quando è socio', () => {
		const assente = calcola({ ingressi: { ...regolare, ultimo: g(-14), quattro: 2 } });
		assert.equal(assente.fase, 'in_calo');
		assert.ok(staff(assente).includes('assente'));
		assert.equal(calcola({ ingressi: { ...regolare, ultimo: g(-13), quattro: 2 } }).fase, 'in_calo');
		// Iscritto da 10 giorni e mai entrato: è nuovo, e non ancora assente.
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

	test('un documento scaduto non cambia lo stato: è un segnale', () => {
		const r = calcola({ documenti: [{ id: 'c1', document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: g(-1) }, documentiInRegola[1]] });
		assert.equal(r.fase, 'attivo');
		assert.deepEqual(staff(r), ['documento_scaduto']);
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
			ingressi: { ...regolare, quattro: 3, dodici: 27 },
		});
		const fare = daFare(r.segnali);
		assert.deepEqual(fare.map((s) => s.codice), ['in_scadenza', 'in_calo']);
		assert.equal(perche(fare), 'scade tra 9 giorni · 3 ingressi in 4 settimane contro 9 di media');
		assert.deepEqual(fare[1].dati, { giorni: 2, quattro: 3, media: 9 });
	});

	test('un contatto del diario non nasconde più i segnali per lo staff: gli avvisi si chiudono a parte', () => {
		const fatto = calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(3) }], contatti: { perSegnale: { in_scadenza: g(-2) } } });
		assert.deepEqual(staff(fatto), ['in_scadenza']);
		assert.equal(fatto.segnali.find((s) => s.codice === 'in_scadenza' && s.pubblico === 'staff').nascostoFino, null);
	});

	test('i segnali tolti non esistono più', () => {
		for (const c of ['rinnovo_richiesto', 'scaduto_recuperabile', 'no_show_ripetuti', 'ambientamento_giorno_7', 'ambientamento_pochi_ingressi', 'documento_mancante', 'da_contattare']) {
			assert.ok(!CODICI_SEGNALE.includes(c), c);
		}
		assert.deepEqual(SEGNALI.map((s) => s.valore), ['scaduto', 'in_scadenza', 'assente', 'in_calo', 'documento_scaduto', 'documento_in_scadenza', 'compleanno']);
	});

	test('un segnale spento dalla palestra non si calcola, ma lo stato non cambia', () => {
		const soglie = soglieDi({ segnali_spenti: ['assente', 'compleanno'] });
		const r = calcola({ soglie, socio: { ...socio, date_of_birth: '1990-10-10' }, ingressi: { ...regolare, ultimo: g(-20), quattro: 0 } });
		assert.equal(r.fase, 'in_calo');
		assert.ok(!r.segnali.some((s) => s.codice === 'assente' || s.codice === 'compleanno'), 'né per lo staff né per il bancone');
	});

	test('le soglie della palestra cambiano i segnali', () => {
		const soglie = soglieDi({ soglie: { segnali: { assenzaGiorni: 21 } } });
		const r = calcola({ soglie, ingressi: { ...regolare, ultimo: g(-15), quattro: 6 } });
		assert.deepEqual(staff(r), []);
		assert.match(regolaSegnale('assente', soglie), /21 giorni/);
		assert.equal(soglie.segnali.noShowSegnale, undefined);
	});

	test('i nuovi soci non hanno più segnali loro', () => {
		const sette = calcola({ iscrizioni: [{ start_date: g(-7), end_date: g(23) }], ingressi: { ultimo: g(-1), quattro: 2, dodici: 2, totale: 2 } });
		assert.deepEqual(staff(sette), []);
	});

	test('i documenti: scaduti o in scadenza; quello che manca non è un segnale; un archiviato non si richiama', () => {
		const scaduto = calcola({ documenti: [{ id: 'd1', file_name: 'c.pdf', document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: g(-1) }, documentiInRegola[1]] });
		const s = scaduto.segnali.find((x) => x.codice === 'documento_scaduto');
		assert.equal(s.motivo, 'certificato medico scaduto il 09/10/2026');
		assert.equal(s.dati.documenti[0].documento_id, 'd1');
		assert.equal(s.dati.documenti[0].giorni, -1);
		const manca = calcola({ documenti: [documentiInRegola[0]] });
		assert.deepEqual(staff(manca), []);
		// …ma il portale lo dice ancora.
		assert.ok(manca.segnali.some((x) => x.pubblico === 'socio' && x.codice === 'documento_identita_mancante'));
		const inScadenza = calcola({ documenti: [{ document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: g(20) }, documentiInRegola[1]] });
		assert.ok(staff(inScadenza).includes('documento_in_scadenza'));
		const ex = calcola({ socio: { ...socio, archiviato_il: g(-1) }, documenti: [{ document_type: 'certificato_medico', expiry_date: g(-1) }] });
		assert.deepEqual(staff(ex), []);
	});

	test('compleanno, anche per chi è nato il 29 febbraio', () => {
		assert.ok(staff(calcola({ socio: { ...socio, date_of_birth: '1990-10-10' } })).includes('compleanno'));
		assert.equal(eCompleanno('2000-02-29', '2027-02-28'), true);
		assert.equal(eCompleanno('2000-02-29', '2028-02-28'), false);
		assert.equal(eCompleanno('2000-02-29', '2028-02-29'), true);
	});

	test('il compleanno per lo staff va da 3 giorni prima a 3 dopo; al bancone solo il giorno stesso', () => {
		const tra3 = calcola({ socio: { ...socio, date_of_birth: '1990-10-13' } });
		assert.ok(staff(tra3).includes('compleanno'));
		assert.equal(tra3.segnali.find((s) => s.codice === 'compleanno').motivo, 'compie gli anni tra 3 giorni');
		assert.deepEqual(tra3.segnali.find((s) => s.codice === 'compleanno').dati, { data: '2026-10-13', anno: 2026, giorni: 3 });
		assert.ok(!daFare(tra3.segnali, 'bancone').some((s) => s.codice === 'compleanno'));
		const fa3 = calcola({ socio: { ...socio, date_of_birth: '1990-10-07' } });
		assert.equal(fa3.segnali.find((s) => s.codice === 'compleanno').motivo, 'ha compiuto gli anni 3 giorni fa');
		assert.ok(!staff(calcola({ socio: { ...socio, date_of_birth: '1990-10-14' } })).includes('compleanno'));
		assert.ok(!staff(calcola({ socio: { ...socio, date_of_birth: '1990-10-06' } })).includes('compleanno'));
		assert.equal(compleannoVicino('1990-10-11', OGGI, 0, 0), null);
		assert.match(regolaSegnale('compleanno', soglieDi({ soglie: { compleannoPrimaGiorni: 0, compleannoDopoGiorni: 0 } })), /oggi/);
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
			iscrizioni: [{ start_date: '2025-01-01', end_date: g(3) }], contatti: { perSegnale: { compleanno: OGGI, in_scadenza: OGGI } },
		});
		assert.deepEqual(daFare(salutato.segnali, 'bancone'), []);
	});

	test('il portale riceve gli avvisi di sempre', () => {
		const r = calcola({ iscrizioni: [{ start_date: '2025-01-01', end_date: g(-5) }] });
		assert.ok(r.segnali.some((s) => s.pubblico === 'socio' && s.codice === 'abbonamento_non_valido'));
	});

	test('ogni segnale per lo staff ha la sua regola', () => {
		for (const s of SEGNALI) assert.ok(regolaSegnale(s.valore), `${s.valore} senza regola`);
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

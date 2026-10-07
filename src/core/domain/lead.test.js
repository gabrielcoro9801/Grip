// I conti della pagina "Andamento" dei lead.
//
// Un errore qui non fa cadere niente: fa dire alla palestra che Instagram porta più soci del
// passaparola quando è il contrario. Sono i numeri su cui si decide dove investire, quindi si provano.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	intervalloPeriodo, filtraAndamento, fasciaEta, riepilogoAndamento, variazione, serieMensile,
	esitiPerCanale, matriceStagionalita, motiviPerdita, contaInOrdine, anniDisponibili, FASCE_ETA,
} from './lead.js';

const righe = [
	{ data_contatto: '2026-01-15', canale_id: 'ig', sesso: 'F', anno_nascita: 1990, esito: 'socio', socio_dal: '2026-01-25' },
	{ data_contatto: '2026-01-31', canale_id: 'fb', sesso: 'M', anno_nascita: 1985, esito: 'perso', motivo: 'prezzo' },
	{ data_contatto: '2026-03-02', canale_id: 'ig', sesso: 'F', anno_nascita: null, esito: 'aperto' },
	{ data_contatto: '2026-03-20', canale_id: 'ig', sesso: 'altro', anno_nascita: 2010, esito: 'socio', socio_dal: '2026-04-09' },
	{ data_contatto: '2025-03-10', canale_id: 'fb', sesso: 'M', anno_nascita: 2001, esito: 'perso', motivo: 'non_raggiungibile' },
];
const canali = [{ id: 'ig', nome: 'Instagram' }, { id: 'fb', nome: 'Facebook' }];

describe('il periodo', () => {
	test('ultimi dodici mesi: interi, fino alla fine di questo, e lo stesso periodo un anno prima', () => {
		const p = intervalloPeriodo('ultimi_12', '2026-10-07');
		assert.equal(p.dal, '2025-11-01');
		assert.equal(p.al, '2026-10-31');
		assert.equal(p.mesi.length, 12);
		assert.deepEqual(p.precedente, { dal: '2024-11-01', al: '2025-10-31' });
	});

	test("quest'anno fino a oggi, e un anno intero", () => {
		assert.deepEqual(intervalloPeriodo('anno', '2026-10-07').mesi.at(-1), '2026-10');
		const anno = intervalloPeriodo('2025', '2026-10-07');
		assert.equal(anno.dal, '2025-01-01');
		assert.equal(anno.al, '2025-12-31');
	});

	test('a dicembre gli ultimi dodici mesi sono l\'anno solare', () => {
		const p = intervalloPeriodo('ultimi_12', '2026-12-05');
		assert.equal(p.dal, '2026-01-01');
		assert.equal(p.al, '2026-12-31');
	});
});

describe('filtri ed età', () => {
	test('ogni filtro restringe, uno assente non filtra', () => {
		assert.equal(filtraAndamento(righe, { dal: '2026-01-01', al: '2026-12-31' }).length, 4);
		assert.equal(filtraAndamento(righe, { canaleId: 'ig' }).length, 3);
		assert.equal(filtraAndamento(righe, { mese: '2026-03' }).length, 2);
		assert.equal(filtraAndamento(righe, { sesso: 'M', fascia: '35-44' }).length, 1);
		assert.equal(filtraAndamento(righe).length, righe.length);
	});

	test("l'età si conta all'anno del contatto; senza anno di nascita è non indicata", () => {
		assert.equal(fasciaEta(righe[0]), '35-44');
		assert.equal(fasciaEta(righe[3]), 'u18');
		assert.equal(fasciaEta(righe[2]), 'nd');
		assert.equal(fasciaEta(righe[4]), '18-24');
	});
});

describe('i numeri', () => {
	test('contatti, soci, tasso per coorte e giorni medi dal contatto al socio', () => {
		const r = riepilogoAndamento(filtraAndamento(righe, { dal: '2026-01-01', al: '2026-12-31' }));
		assert.deepEqual(r, { contatti: 4, soci: 2, aperti: 1, persi: 1, tasso: 0.5, giorniMedi: 15 });
		assert.equal(riepilogoAndamento([]).tasso, null);
	});

	test('la variazione sull\'anno prima, e niente variazione da zero', () => {
		assert.equal(variazione(12, 10), 0.2);
		assert.equal(variazione(3, 0), null);
	});

	test('mese per mese, anche a zero, con lo stesso mese dell\'anno prima', () => {
		const p = intervalloPeriodo('anno', '2026-03-31');
		const serie = serieMensile(filtraAndamento(righe, p), p.mesi, filtraAndamento(righe, p.precedente));
		assert.deepEqual(serie.map((m) => m.contatti), [2, 0, 2]);
		assert.deepEqual(serie.map((m) => m.soci), [1, 0, 1]);
		assert.deepEqual(serie.map((m) => m.annoPrima), [0, 0, 1]);
		assert.equal(serie[2].etichettaLunga, 'Marzo 2026');
	});
});

describe('canali, stagioni e motivi', () => {
	test('per canale: come sono finiti, dal più grande', () => {
		const [ig, fb] = esitiPerCanale(righe, canali);
		assert.deepEqual([ig.nome, ig.contatti, ig.socio, ig.aperto, ig.perso], ['Instagram', 3, 2, 1, 0]);
		assert.equal(fb.perso, 2);
		assert.equal(Math.round(ig.tasso * 100), 67);
		assert.equal(esitiPerCanale([{ ...righe[0], canale_id: 'x' }], canali)[0].nome, 'Canale eliminato');
	});

	test('la stagionalità somma lo stesso mese di anni diversi', () => {
		const { righe: m, massimo } = matriceStagionalita(righe, canali);
		const fb = m.find((r) => r.canale_id === 'fb');
		assert.equal(fb.mesi[0], 1);
		assert.equal(fb.mesi[2], 1);
		assert.equal(massimo, 2);
	});

	test('i motivi di perdita, compreso il non raggiungibile', () => {
		assert.deepEqual(motiviPerdita(righe), [{ motivo: 'prezzo', totale: 1 }, { motivo: 'non_raggiungibile', totale: 1 }]);
	});

	test('i conti in un ordine dato, con gli zeri', () => {
		const fasce = contaInOrdine(righe, fasciaEta, FASCE_ETA.map((f) => f.valore));
		assert.equal(fasce.length, FASCE_ETA.length);
		assert.equal(fasce.find((f) => f.valore === '45-54').totale, 0);
		assert.deepEqual(anniDisponibili(righe), [2026, 2025]);
	});
});

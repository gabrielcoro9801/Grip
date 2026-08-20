// La partita doppia.
//
// È la logica più delicata dell'applicazione, ed è delicata in un modo particolare: quando
// sbaglia non dà errore. Produce una scrittura che quadra perfettamente e che è sul conto
// sbagliato, oppure due importi che sommano a un centesimo di troppo. Lo si scopre mesi
// dopo, da un bilancio che non torna, quando ricostruire cos'è successo costa giorni.
//
// Da qui l'invariante che quasi ogni test qui sotto ricontrolla: **dare deve fare avere**.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	costruisciRigheScrittura,
	costruisciRigheSaldo,
	costruisciRigheRata,
	scorporaIva,
	totaliRighe,
	centesimi,
} from '../../shared/scritture.js';
import { ContoDiSistemaMancante } from '../../shared/contiSistema.js';

// Un piano dei conti con una numerazione volutamente diversa da quella predefinita: se un
// test passasse solo con i codici "2.1" e "4.3", vorrebbe dire che il legame col numero è
// ancora lì.
const CONTI = [
	{ id: 'c-cassa', codice: 'A-01', nome: 'Denaro contante', tipo_conto: 'attivo', ruolo_sistema: 'cassa' },
	{ id: 'c-banca', codice: 'A-02', nome: 'Conto corrente', tipo_conto: 'attivo', ruolo_sistema: 'banca' },
	{ id: 'c-iva', codice: 'P-99', nome: 'IVA da versare', tipo_conto: 'passivo', ruolo_sistema: 'iva_debito' },
	{ id: 'c-erario', codice: 'P-77', nome: 'Erario ritenute', tipo_conto: 'passivo', ruolo_sistema: 'erario_ritenute_autonomi' },
	{ id: 'c-debiti-banche', codice: 'P-10', nome: 'Mutui', tipo_conto: 'passivo', ruolo_sistema: 'debiti_banche' },
	{ id: 'c-interessi', codice: 'C-50', nome: 'Interessi', tipo_conto: 'costo', ruolo_sistema: 'interessi_passivi' },
	{ id: 'c-ricavi', codice: 'R-01', nome: 'Quote associative', tipo_conto: 'ricavo' },
	{ id: 'c-crediti', codice: 'A-20', nome: 'Crediti v/clienti', tipo_conto: 'attivo' },
	{ id: 'c-costi', codice: 'C-01', nome: 'Affitto', tipo_conto: 'costo' },
	{ id: 'c-debiti-forn', codice: 'P-20', nome: 'Fornitori', tipo_conto: 'passivo' },
];

const INCASSO_CON_IVA = {
	tipo: 'entrata',
	nome_visibile: 'Incasso locazione sala',
	conto_contropartita_id: 'c-ricavi',
	conto_credito_debito_id: 'c-crediti',
	gestisce_iva: true,
	aliquota_iva_default: 22,
};

const INCASSO_ISTITUZIONALE = {
	tipo: 'entrata',
	nome_visibile: 'Quota associativa',
	conto_contropartita_id: 'c-ricavi',
	conto_credito_debito_id: 'c-crediti',
	gestisce_iva: false,
	aliquota_iva_default: 0,
};

const USCITA = {
	tipo: 'uscita',
	nome_visibile: 'Pagamento fornitore',
	conto_contropartita_id: 'c-costi',
	conto_credito_debito_id: 'c-debiti-forn',
	gestisce_iva: false,
	aliquota_iva_default: 0,
};

const riga = (righe, contoId) => righe.find((r) => r.conto_id === contoId);

describe('scorporo IVA', () => {
	test('un lordo di 610 al 22% dà 500 di imponibile e 110 di imposta', () => {
		assert.deepEqual(scorporaIva(610, INCASSO_CON_IVA), { imponibile: 500, iva: 110, aliquota: 22 });
	});

	test("senza gestione IVA l'imponibile è il lordo", () => {
		assert.deepEqual(scorporaIva(100, INCASSO_ISTITUZIONALE), { imponibile: 100, iva: 0, aliquota: 0 });
	});

	test('imponibile e imposta sommano sempre al lordo, per ogni importo', () => {
		// È qui che si annidano gli sbilanci da un centesimo: due valori che sommano al
		// lordo prima dell'arrotondamento possono non sommarci più dopo. Lo scandaglio
		// copre ogni importo da 0,01 a 500,00 e tutte le aliquote in uso.
		for (const aliquota of [4, 5, 10, 22]) {
			const causale = { gestisce_iva: true, aliquota_iva_default: aliquota };
			for (let centesimo = 1; centesimo <= 50000; centesimo++) {
				const lordo = centesimo / 100;
				const { imponibile, iva } = scorporaIva(lordo, causale);
				assert.equal(
					centesimi(imponibile + iva),
					lordo,
					`sbilancio su ${lordo.toFixed(2)} al ${aliquota}%: ${imponibile} + ${iva}`,
				);
			}
		}
	});
});

describe('incasso immediato', () => {
	test('con IVA: liquidità in dare, ricavo netto e imposta in avere', () => {
		const { righe, imponibile, iva } = costruisciRigheScrittura({
			causale: INCASSO_CON_IVA,
			importoLordo: 610,
			conti: CONTI,
			metodoLiquidita: 'banca',
			controparteId: 'cliente-1',
			controparteTipo: 'cliente',
		});
		assert.equal(imponibile, 500);
		assert.equal(iva, 110);
		assert.equal(righe.length, 3);
		assert.equal(riga(righe, 'c-banca').dare, 610);
		assert.equal(riga(righe, 'c-ricavi').avere, 500);
		assert.equal(riga(righe, 'c-iva').avere, 110);
		assert.equal(riga(righe, 'c-ricavi').controparte_id, 'cliente-1');
		assert.ok(totaliRighe(righe).quadra);
	});

	test('istituzionale: nessuna riga di IVA', () => {
		// Una quota associativa è fuori campo IVA: una riga sul conto dell'imposta qui
		// significherebbe versare all'erario denaro che non gli spetta.
		const { righe } = costruisciRigheScrittura({
			causale: INCASSO_ISTITUZIONALE,
			importoLordo: 100,
			conti: CONTI,
			metodoLiquidita: 'cassa',
		});
		assert.equal(righe.length, 2);
		assert.equal(riga(righe, 'c-iva'), undefined);
		assert.equal(riga(righe, 'c-cassa').dare, 100);
		assert.equal(riga(righe, 'c-ricavi').avere, 100);
	});

	test('cassa e banca finiscono su conti diversi', () => {
		const perCassa = costruisciRigheScrittura({ causale: INCASSO_ISTITUZIONALE, importoLordo: 50, conti: CONTI, metodoLiquidita: 'cassa' });
		const perBanca = costruisciRigheScrittura({ causale: INCASSO_ISTITUZIONALE, importoLordo: 50, conti: CONTI, metodoLiquidita: 'banca' });
		assert.ok(riga(perCassa.righe, 'c-cassa'));
		assert.ok(riga(perBanca.righe, 'c-banca'));
	});
});

describe('operazione a credito', () => {
	test("l'incasso a credito muove il credito, non la liquidità", () => {
		const { righe, statoPagamento } = costruisciRigheScrittura({
			causale: INCASSO_CON_IVA,
			importoLordo: 610,
			conti: CONTI,
			aCredito: true,
			controparteId: 'cliente-1',
			controparteTipo: 'cliente',
		});
		assert.equal(riga(righe, 'c-crediti').dare, 610);
		assert.equal(riga(righe, 'c-cassa'), undefined, 'la cassa non si muove finché non si incassa');
		assert.equal(riga(righe, 'c-banca'), undefined);
		assert.equal(statoPagamento, 'da_incassare');
	});

	test("l'uscita a credito è da pagare", () => {
		const { statoPagamento } = costruisciRigheScrittura({
			causale: USCITA, importoLordo: 200, conti: CONTI, aCredito: true,
		});
		assert.equal(statoPagamento, 'da_pagare');
	});

	test('una causale senza conto di credito non si registra a credito', () => {
		const senzaCredito = { ...USCITA, conto_credito_debito_id: null };
		assert.throws(
			() => costruisciRigheScrittura({ causale: senzaCredito, importoLordo: 100, conti: CONTI, aCredito: true }),
			/conto di credito\/debito/,
		);
	});
});

describe("ritenuta d'acconto", () => {
	test('pagamento immediato: il costo resta intero, il denaro esce al netto', () => {
		// La ritenuta non è uno sconto sul compenso: è una parte del compenso che si versa
		// all'erario per conto del professionista.
		const { righe } = costruisciRigheScrittura({
			causale: USCITA,
			importoLordo: 1000,
			conti: CONTI,
			metodoLiquidita: 'banca',
			ritenuta: { importo: 200 },
		});
		assert.equal(riga(righe, 'c-costi').dare, 1000, 'il costo è il compenso pieno');
		assert.equal(riga(righe, 'c-banca').avere, 800, 'dalla banca escono solo 800');
		assert.equal(riga(righe, 'c-erario').avere, 200, "200 restano dovuti all'erario");
		assert.ok(totaliRighe(righe).quadra);
	});

	test('a credito: al fornitore si deve il netto, non il lordo', () => {
		const { righe } = costruisciRigheScrittura({
			causale: USCITA,
			importoLordo: 2000,
			conti: CONTI,
			aCredito: true,
			ritenuta: { importo: 400 },
			controparteId: 'forn-1',
			controparteTipo: 'fornitore',
		});
		assert.equal(riga(righe, 'c-costi').dare, 2000);
		assert.equal(riga(righe, 'c-debiti-forn').avere, 1600, 'lo scadenzario deve mostrare 1600, non 2000');
		assert.equal(riga(righe, 'c-erario').avere, 400);
		assert.ok(totaliRighe(righe).quadra);
	});

	test('senza ritenuta nessuna riga verso l’erario', () => {
		const { righe } = costruisciRigheScrittura({ causale: USCITA, importoLordo: 1000, conti: CONTI });
		assert.equal(riga(righe, 'c-erario'), undefined);
	});

	test("una ritenuta superiore al compenso viene rifiutata", () => {
		assert.throws(
			() => costruisciRigheScrittura({ causale: USCITA, importoLordo: 100, conti: CONTI, ritenuta: { importo: 150 } }),
			/non può superare/,
		);
	});
});

describe('conti di sistema mancanti', () => {
	test('senza il conto della cassa si dice quale ruolo manca, non "errore"', () => {
		const senzaCassa = CONTI.filter((c) => c.ruolo_sistema !== 'cassa');
		assert.throws(
			() => costruisciRigheScrittura({ causale: INCASSO_ISTITUZIONALE, importoLordo: 50, conti: senzaCassa }),
			(err) => err instanceof ContoDiSistemaMancante && err.ruolo === 'cassa' && /Cassa/.test(err.message),
		);
	});

	test("il conto dell'IVA serve solo se c'è IVA", () => {
		// Un ente istituzionale può non avere affatto un conto IVA: pretenderlo sempre
		// bloccherebbe registrazioni del tutto legittime.
		const senzaIva = CONTI.filter((c) => c.ruolo_sistema !== 'iva_debito');
		assert.doesNotThrow(() =>
			costruisciRigheScrittura({ causale: INCASSO_ISTITUZIONALE, importoLordo: 50, conti: senzaIva }));
		assert.throws(
			() => costruisciRigheScrittura({ causale: INCASSO_CON_IVA, importoLordo: 610, conti: senzaIva }),
			ContoDiSistemaMancante,
		);
	});
});

describe('i conti si trovano per ruolo, non per numero', () => {
	test('rinumerare tutto il piano dei conti non cambia nulla', () => {
		// È il punto della riscrittura: il codice del conto appartiene all'ente, non al
		// motore. Qui i numeri cambiano tutti e la scrittura deve restare identica.
		const rinumerati = CONTI.map((c) => ({ ...c, codice: `Z${Math.random().toString(36).slice(2, 6)}` }));
		const prima = costruisciRigheScrittura({ causale: INCASSO_CON_IVA, importoLordo: 610, conti: CONTI, metodoLiquidita: 'banca' });
		const dopo = costruisciRigheScrittura({ causale: INCASSO_CON_IVA, importoLordo: 610, conti: rinumerati, metodoLiquidita: 'banca' });
		assert.deepEqual(dopo.righe, prima.righe);
	});
});

describe('saldo di un credito o di un debito', () => {
	test('incassare un credito porta denaro in cassa e chiude il credito', () => {
		const righe = costruisciRigheSaldo({
			contoCreditoDebitoId: 'c-crediti', importo: 610, conti: CONTI, metodoLiquidita: 'cassa', daIncassare: true,
		});
		assert.equal(riga(righe, 'c-cassa').dare, 610);
		assert.equal(riga(righe, 'c-crediti').avere, 610);
		assert.ok(totaliRighe(righe).quadra);
	});

	test('pagare un debito lo chiude e fa uscire il denaro', () => {
		const righe = costruisciRigheSaldo({
			contoCreditoDebitoId: 'c-debiti-forn', importo: 200, conti: CONTI, metodoLiquidita: 'banca', daIncassare: false,
		});
		assert.equal(riga(righe, 'c-debiti-forn').dare, 200);
		assert.equal(riga(righe, 'c-banca').avere, 200);
		assert.ok(totaliRighe(righe).quadra);
	});
});

describe('rata di finanziamento', () => {
	test('il capitale riduce il debito, gli interessi sono un costo', () => {
		const righe = costruisciRigheRata({
			quotaCapitale: 814.4, quotaInteressi: 41.67, conti: CONTI, metodoLiquidita: 'banca',
		});
		assert.equal(riga(righe, 'c-debiti-banche').dare, 814.4);
		assert.equal(riga(righe, 'c-interessi').dare, 41.67);
		assert.equal(riga(righe, 'c-banca').avere, 856.07);
		assert.ok(totaliRighe(righe).quadra);
	});

	test('una rata a tasso zero non crea una riga di interessi da zero euro', () => {
		const righe = costruisciRigheRata({ quotaCapitale: 500, quotaInteressi: 0, conti: CONTI, metodoLiquidita: 'cassa' });
		assert.equal(righe.length, 2);
		assert.equal(riga(righe, 'c-interessi'), undefined);
	});
});

describe('importi rifiutati', () => {
	for (const importo of [0, -10, null, undefined, NaN]) {
		test(`un importo ${JSON.stringify(importo)} non produce una scrittura`, () => {
			assert.throws(() => costruisciRigheScrittura({ causale: INCASSO_ISTITUZIONALE, importoLordo: importo, conti: CONTI }));
		});
	}
});

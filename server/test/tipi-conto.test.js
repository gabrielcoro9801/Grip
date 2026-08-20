// La classificazione di un conto, spiegata a chi non fa il commercialista.
//
// Sbagliarla non dà errore: la registrazione si fa, quadra, e il bilancio risulta storto.
// Per questo il form chiede a cosa serve il conto invece di chiedere "attivo o passivo", e
// la natura la deriva. Ma non può imporla: i fondi rettificativi esistono e sono legittimi.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	TIPI_CONTO,
	NOMI_TIPI_CONTO,
	naturaTipica,
	eRettificativo,
	effettoDelMovimento,
} from '../../shared/tipiConto.js';

describe('il catalogo', () => {
	test('ogni tipo ha una domanda in italiano e degli esempi', () => {
		// Senza, l'elenco tornerebbe a essere il vocabolario tecnico che nessuno capisce.
		for (const [nome, t] of Object.entries(TIPI_CONTO)) {
			assert.ok(t.domanda?.length > 10, `${nome} senza domanda`);
			assert.ok(t.esempi?.length > 10, `${nome} senza esempi`);
			assert.ok(['dare', 'avere'].includes(t.naturaTipica), `${nome} senza natura tipica`);
		}
	});

	test('copre i cinque tipi che il bilancio conosce', () => {
		assert.deepEqual(NOMI_TIPI_CONTO.sort(), ['attivo', 'costo', 'passivo', 'patrimonio_netto', 'ricavo']);
	});
});

describe('la natura si deriva dal tipo', () => {
	test('quello che si possiede e quello che si spende aumentano in dare', () => {
		assert.equal(naturaTipica('attivo'), 'dare');
		assert.equal(naturaTipica('costo'), 'dare');
	});

	test('quello che si deve, il patrimonio e le entrate aumentano in avere', () => {
		assert.equal(naturaTipica('passivo'), 'avere');
		assert.equal(naturaTipica('patrimonio_netto'), 'avere');
		assert.equal(naturaTipica('ricavo'), 'avere');
	});
});

describe('i conti rettificativi', () => {
	test('un fondo ammortamento è attivo ma aumenta in avere', () => {
		// È il conto 1.9 del piano predefinito: sta fra le attività ma le riduce. Se la
		// natura fosse imposta dal tipo, non sarebbe creabile.
		assert.equal(eRettificativo('attivo', 'avere'), true);
	});

	test('un conto normale non è rettificativo', () => {
		assert.equal(eRettificativo('attivo', 'dare'), false);
		assert.equal(eRettificativo('ricavo', 'avere'), false);
	});

	test('senza tipo o senza natura non si dichiara niente', () => {
		assert.equal(eRettificativo(null, 'dare'), false);
		assert.equal(eRettificativo('attivo', null), false);
	});
});

describe("l'effetto del movimento", () => {
	test('dice cosa succede, non come si chiama la regola', () => {
		const testo = effettoDelMovimento('ricavo', 'avere');
		assert.match(testo, /movimento in avere aumenta questo conto/);
		assert.match(testo, /dare lo diminuisce/);
	});

	test('per un conto in dare le parti si invertono', () => {
		assert.match(effettoDelMovimento('costo', 'dare'), /in dare aumenta questo conto/);
	});

	test('su un rettificativo lo dice, e spiega perché è insolito', () => {
		const testo = effettoDelMovimento('attivo', 'avere');
		assert.match(testo, /rettificativo/);
		assert.match(testo, /fondo ammortamento/);
	});

	test('senza natura non si racconta nulla', () => {
		assert.equal(effettoDelMovimento('attivo', null), null);
	});
});

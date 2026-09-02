// Quando una registrazione deve dichiarare la natura fiscale, e quando no.
//
// Un'ASD/SSD promiscua deve poter separare, conto per conto, cosa appartiene all'attività
// istituzionale e cosa a quella commerciale: è la base su cui si calcola l'IRES. Ma non ogni
// scrittura movimenta un conto economico — le chiusure, i saldi, le rate di prestito, i
// compensi PT girano solo liquidità e conti patrimoniali — e obbligarle tutte alla stessa
// dichiarazione avrebbe due esiti sbagliati: o si finisce a inventare una natura per una
// scrittura tecnica che non ne ha una, o l'obbligo si allenta ovunque per non romperle. Qui
// la regola si può interrogare senza un database acceso.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	NATURE_FISCALI,
	ORIGINI_SENZA_NATURA_FISCALE,
	naturaFiscaleRichiesta,
	erroreNaturaFiscale,
} from '../../shared/naturaFiscale.js';

const CONTO_RICAVO = 'conto-ricavo';
const CONTO_COSTO = 'conto-costo';
const CONTO_CASSA = 'conto-cassa';

const CONTI_PER_ID = {
	[CONTO_RICAVO]: { tipo_conto: 'ricavo' },
	[CONTO_COSTO]: { tipo_conto: 'costo' },
	[CONTO_CASSA]: { tipo_conto: 'attivo' },
};

describe('le quattro origini tecniche non chiedono mai la natura fiscale', () => {
	for (const tipoOrigine of ['chiusura_esercizio', 'saldo', 'rata_prestito', 'compenso_pt']) {
		test(`${tipoOrigine} non la richiede, anche se tocca un conto di ricavo`, () => {
			const righe = [{ conto_id: CONTO_RICAVO }, { conto_id: CONTO_CASSA }];
			assert.equal(naturaFiscaleRichiesta({ tipoOrigine, righe, contiPerId: CONTI_PER_ID }), false);
		});
	}

	test('sono esattamente queste quattro, non una di più o di meno', () => {
		assert.deepEqual([...ORIGINI_SENZA_NATURA_FISCALE].sort(), [
			'chiusura_esercizio', 'compenso_pt', 'rata_prestito', 'saldo',
		]);
	});
});

describe('le altre origini la richiedono solo se toccano ricavo o costo', () => {
	test('una scrittura che tocca solo cassa e un conto patrimoniale non la richiede', () => {
		const righe = [{ conto_id: CONTO_CASSA }];
		assert.equal(naturaFiscaleRichiesta({ tipoOrigine: 'manuale', righe, contiPerId: CONTI_PER_ID }), false);
	});

	test('una riga su un conto di ricavo la richiede', () => {
		const righe = [{ conto_id: CONTO_CASSA }, { conto_id: CONTO_RICAVO }];
		assert.equal(naturaFiscaleRichiesta({ tipoOrigine: 'incasso_cliente', righe, contiPerId: CONTI_PER_ID }), true);
	});

	test('una riga su un conto di costo la richiede', () => {
		const righe = [{ conto_id: CONTO_CASSA }, { conto_id: CONTO_COSTO }];
		assert.equal(naturaFiscaleRichiesta({ tipoOrigine: 'pagamento_fornitore', righe, contiPerId: CONTI_PER_ID }), true);
	});

	test('un conto sconosciuto al piano dei conti non fa scattare la richiesta da solo', () => {
		const righe = [{ conto_id: 'conto-non-nel-piano' }];
		assert.equal(naturaFiscaleRichiesta({ tipoOrigine: 'manuale', righe, contiPerId: CONTI_PER_ID }), false);
	});
});

describe('il messaggio d\'errore', () => {
	test('un valore fuori enum è sempre rifiutato, anche su una scrittura tecnica', () => {
		const errore = erroreNaturaFiscale({
			tipoOrigine: 'chiusura_esercizio',
			naturaFiscale: 'valore-inventato',
			righe: [],
			contiPerId: {},
		});
		assert.match(errore, /non è una natura fiscale valida/);
	});

	test('i quattro valori ammessi passano tutti', () => {
		for (const naturaFiscale of NATURE_FISCALI) {
			const errore = erroreNaturaFiscale({
				tipoOrigine: 'incasso_cliente',
				naturaFiscale,
				righe: [{ conto_id: CONTO_RICAVO }],
				contiPerId: CONTI_PER_ID,
			});
			assert.equal(errore, null, `"${naturaFiscale}" dovrebbe essere ammesso`);
		}
	});

	test('mancante su una scrittura che tocca un ricavo: errore', () => {
		const errore = erroreNaturaFiscale({
			tipoOrigine: 'incasso_cliente',
			naturaFiscale: null,
			righe: [{ conto_id: CONTO_RICAVO }],
			contiPerId: CONTI_PER_ID,
		});
		assert.match(errore, /Indicare la natura fiscale/);
	});

	test('mancante su una scrittura tecnica: nessun errore', () => {
		const errore = erroreNaturaFiscale({
			tipoOrigine: 'saldo',
			naturaFiscale: null,
			righe: [{ conto_id: CONTO_RICAVO }],
			contiPerId: CONTI_PER_ID,
		});
		assert.equal(errore, null);
	});

	test('mancante su una scrittura che non tocca conti economici: nessun errore', () => {
		const errore = erroreNaturaFiscale({
			tipoOrigine: 'rettifica_cassa',
			naturaFiscale: null,
			righe: [{ conto_id: CONTO_CASSA }],
			contiPerId: CONTI_PER_ID,
		});
		assert.equal(errore, null);
	});
});

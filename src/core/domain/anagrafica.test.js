// Codice fiscale, sesso e documenti: le regole che segreteria e server devono applicare uguali.
//
// Girano con `node --test`, senza Vite.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	codiceFiscaleValido,
	normalizzaCodiceFiscale,
	carattereDiControllo,
	sessoValido,
	nomeCompleto,
	nomeDocumento,
	motivoDocumentoNonValido,
	conStatoDocumenti,
} from './anagrafica.js';

describe('il codice fiscale', () => {
	test('accetta i codici ben scritti, anche in minuscolo e con spazi', () => {
		assert.equal(codiceFiscaleValido('RSSMRA85T10A562S'), true);
		assert.equal(codiceFiscaleValido('MRTMTT25D09F205Z'), true);
		assert.equal(codiceFiscaleValido(' rss mra 85t10 a562s '), true);
		assert.equal(normalizzaCodiceFiscale(' rss mra 85t10 a562s '), 'RSSMRA85T10A562S');
	});

	test('accetta gli omocodici, con il loro carattere di controllo', () => {
		// "1" del giorno sostituito da "M": l'Agenzia lo fa quando due codici coincidono.
		const primi15 = 'RSSMRA85T1MA562';
		assert.equal(codiceFiscaleValido(`${primi15}${carattereDiControllo(primi15)}`), true);
	});

	test("prende l'errore di battitura", () => {
		assert.equal(codiceFiscaleValido('RSSMRA85T10A562T'), false, 'controllo sbagliato');
		assert.equal(codiceFiscaleValido('RSSMRA58T10A562S'), false, 'due cifre invertite');
	});

	test('rifiuta quello che non ha la forma di un codice fiscale', () => {
		for (const cf of ['', null, undefined, 'RSSMRA85T10A562', 'RSSMRA85T10A562SS', 'RSSMRA85Z10A562S', '12345678901']) {
			assert.equal(codiceFiscaleValido(cf), false, String(cf));
		}
	});
});

test('sesso: tre valori e nient\'altro', () => {
	assert.equal(sessoValido('M'), true);
	assert.equal(sessoValido('F'), true);
	assert.equal(sessoValido('altro'), true);
	assert.equal(sessoValido('m'), false);
	assert.equal(sessoValido(''), false);
});

test('il nome completo è quello che calcola il database', () => {
	assert.equal(nomeCompleto({ nome: 'Maria Grazia', cognome: 'Rossi' }), 'Maria Grazia Rossi');
	assert.equal(nomeCompleto({ nome: 'Cher', cognome: '' }), 'Cher');
});

describe('i documenti', () => {
	test('il nome di un documento', () => {
		assert.equal(nomeDocumento({ document_type: 'certificato_medico' }), 'Certificato medico');
		assert.equal(nomeDocumento({ document_type: 'altro', titolo: 'Contratto' }), 'Contratto');
	});

	test('cosa serve per salvarli', () => {
		assert.equal(motivoDocumentoNonValido({ document_type: 'certificato_medico', expiry_date: '2027-01-01' }), null);
		assert.match(motivoDocumentoNonValido({ document_type: 'certificato_medico' }), /scadenza/);
		// Anche il documento di identità scade: senza data non si sa quando richiamare il socio.
		assert.equal(motivoDocumentoNonValido({ document_type: 'documento_identita', expiry_date: '2030-05-20' }), null);
		assert.match(motivoDocumentoNonValido({ document_type: 'documento_identita' }), /scadenza/);
		assert.equal(motivoDocumentoNonValido({ document_type: 'altro', titolo: 'Contratto' }), null);
		assert.match(motivoDocumentoNonValido({ document_type: 'altro', titolo: '  ' }), /documento/);
		assert.match(motivoDocumentoNonValido({ document_type: 'Certificato Medico' }), /non valido/);
	});
});

describe("lo stato dei documenti, e chi finisce in archivio", () => {
	// I giorni li passa chi chiama: nel test sono una tabella, così le prove non cambiano
	// risposta col passare del tempo — che è esattamente il modo in cui un test sulle
	// scadenze marcisce senza che nessuno lo tocchi.
	const giorni = { scaduto: -10, vecchio: -400, quasi: 12, lontano: 200 };
	const giorniAlla = (chiave) => (chiave === null || chiave === undefined ? null : giorni[chiave]);
	const stati = (documenti) =>
		Object.fromEntries(conStatoDocumenti(documenti, giorniAlla).map((d) => [d.id, d.stato]));

	test('valido, in scadenza e scaduto li decidono i giorni che mancano', () => {
		assert.deepEqual(
			stati([
				{ id: 'a', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: 'lontano' },
				{ id: 'b', document_type: 'documento_identita', created_date: '2026-01-01', expiry_date: 'quasi' },
				{ id: 'c', document_type: 'altro', created_date: '2026-01-01', expiry_date: 'scaduto' },
			]),
			{ a: 'valido', b: 'in_scadenza', c: 'archiviato' }
		);
	});

	test('trenta giorni esatti sono ancora "in scadenza", trentuno no', () => {
		const alSoglio = (g) =>
			conStatoDocumenti(
				[{ id: 'x', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: 'x' }],
				() => g
			)[0].stato;
		assert.equal(alSoglio(30), 'in_scadenza');
		assert.equal(alSoglio(31), 'valido');
		assert.equal(alSoglio(0), 'in_scadenza', 'scade oggi: ancora valido, ma da rifare');
	});

	test('un certificato scaduto resta in vista finché non ne arriva un altro', () => {
		const solo = [{ id: 'vecchio', document_type: 'certificato_medico', created_date: '2024-01-01', expiry_date: 'vecchio' }];
		assert.deepEqual(stati(solo), { vecchio: 'scaduto' }, 'senza sostituto non si archivia');

		const conSostituto = [
			...solo,
			{ id: 'nuovo', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: 'lontano' },
		];
		assert.deepEqual(stati(conSostituto), { vecchio: 'archiviato', nuovo: 'valido' });
	});

	test('lo stesso vale per il documento di identità, e non per gli "altri"', () => {
		assert.deepEqual(
			stati([{ id: 'ci', document_type: 'documento_identita', created_date: '2024-01-01', expiry_date: 'vecchio' }]),
			{ ci: 'scaduto' }
		);
		// Un "altro" scaduto non lascia la sezione vuota a segnalare qualcosa: può andare via.
		assert.deepEqual(
			stati([{ id: 'contratto', document_type: 'altro', created_date: '2024-01-01', expiry_date: 'vecchio' }]),
			{ contratto: 'archiviato' }
		);
	});

	test('anche se il sostituto è a sua volta scaduto, in vista resta solo l\'ultimo', () => {
		assert.deepEqual(
			stati([
				{ id: 'primo', document_type: 'certificato_medico', created_date: '2023-01-01', expiry_date: 'vecchio' },
				{ id: 'secondo', document_type: 'certificato_medico', created_date: '2025-01-01', expiry_date: 'scaduto' },
			]),
			{ primo: 'archiviato', secondo: 'scaduto' }
		);
	});

	test('senza data di scadenza un documento non scade e non si archivia', () => {
		assert.deepEqual(
			stati([
				{ id: 'senza', document_type: 'altro', created_date: '2024-01-01', expiry_date: null },
				{ id: 'dopo', document_type: 'altro', created_date: '2026-01-01', expiry_date: null },
			]),
			{ senza: 'valido', dopo: 'valido' }
		);
	});

	test('i documenti di tipi diversi non si sostituiscono a vicenda', () => {
		assert.deepEqual(
			stati([
				{ id: 'cert', document_type: 'certificato_medico', created_date: '2024-01-01', expiry_date: 'vecchio' },
				{ id: 'ci', document_type: 'documento_identita', created_date: '2026-01-01', expiry_date: 'lontano' },
			]),
			{ cert: 'scaduto', ci: 'valido' }
		);
	});
});

// Codice fiscale, sesso e documenti: le regole che segreteria e server devono applicare uguali.
//
// Girano con `node --test`, senza Vite.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	codiceFiscaleValido,
	partitaIvaValida,
	normalizzaCodiceFiscale,
	carattereDiControllo,
	sessoValido,
	nomeCompleto,
	nomeDocumento,
	motivoDocumentoNonValido,
	conStatoDocumenti,
	motivoDataNascitaNonValida,
	etaA,
	eMinorenne,
	tipoAtteso,
	tipoDocumentoValido,
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

	test('uno scaduto caricato dopo uno valido nasce già archiviato', () => {
		// Succede quando si registra la copia di un certificato vecchio dopo aver inserito
		// quello nuovo: l'ordine di caricamento non dice quale dei due vale.
		assert.deepEqual(
			stati([
				{ id: 'buono', document_type: 'certificato_medico', created_date: '2026-01-01', expiry_date: 'lontano' },
				{ id: 'vecchio', document_type: 'certificato_medico', created_date: '2026-06-01', expiry_date: 'scaduto' },
			]),
			{ buono: 'valido', vecchio: 'archiviato' }
		);
	});

	test('vale anche per il documento di identità, e anche se il valido è solo "in scadenza"', () => {
		assert.deepEqual(
			stati([
				{ id: 'buono', document_type: 'documento_identita', created_date: '2026-01-01', expiry_date: 'quasi' },
				{ id: 'vecchio', document_type: 'documento_identita', created_date: '2026-06-01', expiry_date: 'vecchio' },
			]),
			{ buono: 'in_scadenza', vecchio: 'archiviato' }
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

test("la partita IVA: undici cifre e l'ultima di controllo", () => {
  assert.equal(partitaIvaValida("01234567897"), true);
  assert.equal(partitaIvaValida("IT 01234567897"), true, "prefisso e spazi non contano");
  assert.equal(partitaIvaValida("01234567890"), false, "cifra di controllo sbagliata");
  assert.equal(partitaIvaValida("1234567897"), false, "dieci cifre");
  assert.equal(partitaIvaValida(""), false);
});

describe('la data di nascita e l\'età', () => {
	test('obbligatoria, vera, non nel futuro e non prima del 1900', () => {
		const oggi = '2026-10-07';
		assert.match(motivoDataNascitaNonValida('', oggi), /obbligatoria/);
		assert.match(motivoDataNascitaNonValida(null, oggi), /obbligatoria/);
		assert.match(motivoDataNascitaNonValida('2026-02-30', oggi), /non è valida/);
		assert.match(motivoDataNascitaNonValida('2026-10-08', oggi), /futuro/);
		assert.match(motivoDataNascitaNonValida('1899-12-31', oggi), /1900/);
		assert.equal(motivoDataNascitaNonValida('2026-10-07', oggi), null, 'nato oggi va bene');
		assert.equal(motivoDataNascitaNonValida('1985-12-10', oggi), null);
	});

	test('gli anni si compiono il giorno del compleanno, non prima', () => {
		assert.equal(etaA('2008-10-07', '2026-10-07'), 18);
		assert.equal(etaA('2008-10-08', '2026-10-07'), 17);
		assert.equal(etaA('2008-02-29', '2026-02-28'), 17, 'il 29 febbraio si compie il 1° marzo');
		assert.equal(etaA('2008-02-29', '2026-03-01'), 18);
		assert.equal(etaA(null, '2026-10-07'), null);
	});

	test('minorenne fino al giorno prima dei 18 anni; senza data non lo si sa', () => {
		assert.equal(eMinorenne('2008-10-08', '2026-10-07'), true);
		assert.equal(eMinorenne('2008-10-07', '2026-10-07'), false);
		assert.equal(eMinorenne(null, '2026-10-07'), false);
	});
});

describe('il consenso dei genitori', () => {
	const minore = { date_of_birth: '2012-05-01' };
	const adulto = { date_of_birth: '1990-05-01' };

	test('è un tipo di documento a sé, atteso solo per i minorenni', () => {
		assert.equal(tipoDocumentoValido('consenso_genitori'), true);
		assert.equal(nomeDocumento({ document_type: 'consenso_genitori' }), 'Consenso dei genitori');
		assert.equal(tipoAtteso('consenso_genitori', minore, '2026-10-07'), true);
		assert.equal(tipoAtteso('consenso_genitori', adulto, '2026-10-07'), false);
		assert.equal(tipoAtteso('consenso_genitori', {}, '2026-10-07'), false);
		// Gli altri non cambiano con l'età.
		assert.equal(tipoAtteso('certificato_medico', adulto), true);
		assert.equal(tipoAtteso('altro', minore), false);
	});

	test('non chiede la scadenza, e non va mai in archivio da solo', () => {
		assert.equal(motivoDocumentoNonValido({ document_type: 'consenso_genitori' }), null);
		const [consenso] = conStatoDocumenti(
			[{ id: 'c', document_type: 'consenso_genitori', created_date: '2020-01-01', expiry_date: null }],
			() => null,
		);
		assert.equal(consenso.stato, 'valido');
	});
});

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

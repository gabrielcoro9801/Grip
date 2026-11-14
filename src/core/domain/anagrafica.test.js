// Codice fiscale, sesso, nascita: le regole che segreteria e server devono applicare uguali.
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
	motivoDataNascitaNonValida,
	etaA,
	eMinorenne,
	consensoGenitoriDaFirmare,
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

describe('il consenso dei genitori (R4: una spunta, non più un documento)', () => {
	test('da firmare solo per il minorenne senza la spunta', () => {
		const oggi = '2026-10-07';
		assert.equal(consensoGenitoriDaFirmare({ date_of_birth: '2012-05-01' }, oggi), true);
		assert.equal(consensoGenitoriDaFirmare({ date_of_birth: '2012-05-01', consenso_genitori_firmato: true }, oggi), false);
		assert.equal(consensoGenitoriDaFirmare({ date_of_birth: '1990-05-01' }, oggi), false);
		assert.equal(consensoGenitoriDaFirmare({}, oggi), false, 'senza data non lo si sa');
	});
});

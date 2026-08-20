// La costruzione del file XML della fattura elettronica.
//
// Vale la pena testarla riga per riga perché lo SdI non perdona: un elemento fuori
// sequenza, un importo con la virgola al posto del punto, una PEC indicata insieme a un
// codice destinatario valido — e la fattura viene scartata. Lo si scopre giorni dopo, con
// il numero progressivo ormai consumato.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	costruisciXmlFattura,
	datiMancanti,
	datiMancantiCliente,
	nomeFileFattura,
	progressivoInvio,
	DESTINATARIO_SCONOSCIUTO,
} from '../../shared/fatturaElettronica.js';

const emittente = {
	ragione_sociale: 'ASD Grip Palestra',
	partita_iva: '01234567891',
	codice_fiscale: '98765432101',
	regime_fiscale_codice: 'RF18',
	indirizzo_via: 'Via Roma',
	indirizzo_civico: '10',
	indirizzo_cap: '20100',
	indirizzo_comune: 'Milano',
	indirizzo_provincia: 'MI',
};

const cliente = {
	ragione_sociale: 'Rossi Sport S.r.l.',
	partita_iva: '11223344556',
	indirizzo_via: 'Corso Buenos Aires',
	indirizzo_civico: '5',
	indirizzo_cap: '20124',
	indirizzo_comune: 'Milano',
	indirizzo_provincia: 'MI',
	codice_destinatario: 'ABC1234',
};

// Lo stesso caso già verificato in contabilità: affitto sala a un'azienda.
const fattura = {
	numero_progressivo: 1,
	esercizio_fiscale: 2026,
	data_emissione: '2026-03-15',
	descrizione: 'Affitto sala corsi',
	imponibile: 500,
	iva: 110,
	aliquota_iva: 22,
	totale: 610,
};

const trasmissione = { progressivo_invio: '00001' };

function xml(sovrascrivi = {}) {
	return costruisciXmlFattura({ emittente, cliente, fattura, trasmissione, ...sovrascrivi });
}

describe('il documento prodotto', () => {
	test('dichiara formato e schema che lo SdI si aspetta', () => {
		const out = xml();
		assert.match(out, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
		assert.match(out, /<p:FatturaElettronica versione="FPR12"/);
		assert.match(out, /<FormatoTrasmissione>FPR12<\/FormatoTrasmissione>/);
	});

	test('riporta emittente, destinatario e recapito', () => {
		const out = xml();
		assert.match(out, /<IdCodice>01234567891<\/IdCodice>/);
		assert.match(out, /<Denominazione>ASD Grip Palestra<\/Denominazione>/);
		assert.match(out, /<RegimeFiscale>RF18<\/RegimeFiscale>/);
		assert.match(out, /<Denominazione>Rossi Sport S\.r\.l\.<\/Denominazione>/);
		assert.match(out, /<CodiceDestinatario>ABC1234<\/CodiceDestinatario>/);
	});

	test('gli importi usano il punto decimale e due cifre', () => {
		const out = xml();
		assert.match(out, /<ImponibileImporto>500\.00<\/ImponibileImporto>/);
		assert.match(out, /<Imposta>110\.00<\/Imposta>/);
		assert.match(out, /<AliquotaIVA>22\.00<\/AliquotaIVA>/);
		assert.match(out, /<ImportoTotaleDocumento>610\.00<\/ImportoTotaleDocumento>/);
		assert.ok(!out.includes(','), 'nessun importo deve usare la virgola');
	});

	test('il numero unisce progressivo ed esercizio', () => {
		assert.match(xml(), /<Numero>1\/2026<\/Numero>/);
	});

	test('gli elementi rispettano la sequenza dello schema', () => {
		const out = xml();
		const posizione = (t) => out.indexOf(`<${t}>`);
		// Header prima del body, e dentro la sede l'ordine imposto dall'XSD.
		assert.ok(posizione('FatturaElettronicaHeader') < posizione('FatturaElettronicaBody'));
		assert.ok(posizione('DatiTrasmissione') < posizione('CedentePrestatore'));
		assert.ok(posizione('CedentePrestatore') < posizione('CessionarioCommittente'));
		assert.ok(posizione('Indirizzo') < posizione('CAP'));
		assert.ok(posizione('CAP') < posizione('Comune'));
		assert.ok(posizione('Comune') < posizione('Provincia'));
		assert.ok(posizione('Provincia') < posizione('Nazione'));
		assert.ok(posizione('DatiGenerali') < posizione('DatiBeniServizi'));
		assert.ok(posizione('DettaglioLinee') < posizione('DatiRiepilogo'));
	});

	test('i caratteri speciali non rompono il file', () => {
		const out = costruisciXmlFattura({
			emittente,
			cliente: { ...cliente, ragione_sociale: 'Bar & Co. <Milano>' },
			fattura,
			trasmissione,
		});
		assert.match(out, /<Denominazione>Bar &amp; Co\. &lt;Milano&gt;<\/Denominazione>/);
	});

	test('una persona fisica va con nome e cognome, non con la denominazione', () => {
		const out = costruisciXmlFattura({
			emittente,
			cliente: { ...cliente, ragione_sociale: null, nome: 'Mario', cognome: 'Rossi' },
			fattura,
			trasmissione,
		});
		assert.match(out, /<Nome>Mario<\/Nome><Cognome>Rossi<\/Cognome>/);
		assert.ok(!out.includes('<Denominazione>Rossi Sport'), 'niente denominazione per una persona fisica');
	});
});

describe('il recapito del destinatario', () => {
	test('senza codice si usano i sette zeri e si indica la PEC', () => {
		const out = costruisciXmlFattura({
			emittente,
			cliente: { ...cliente, codice_destinatario: null, pec: 'rossi@pec.it' },
			fattura,
			trasmissione,
		});
		assert.match(out, new RegExp(`<CodiceDestinatario>${DESTINATARIO_SCONOSCIUTO}</CodiceDestinatario>`));
		assert.match(out, /<PECDestinatario>rossi@pec\.it<\/PECDestinatario>/);
	});

	test('con un codice valido la PEC non va indicata', () => {
		// Indicarle entrambe è un errore di tracciato, non una ridondanza innocua.
		const out = costruisciXmlFattura({
			emittente,
			cliente: { ...cliente, pec: 'rossi@pec.it' },
			fattura,
			trasmissione,
		});
		assert.ok(!out.includes('PECDestinatario'));
	});
});

describe('una Pubblica Amministrazione', () => {
	// Per un'ASD il caso concreto è la convenzione o il contributo di un Comune.
	const comune = {
		...cliente,
		ragione_sociale: 'Comune di Milano',
		pubblica_amministrazione: true,
		codice_destinatario: 'UF1234',
	};

	test('usa il tracciato FPA12, non quello dei privati', () => {
		const out = costruisciXmlFattura({ emittente, cliente: comune, fattura, trasmissione });
		assert.match(out, /<p:FatturaElettronica versione="FPA12"/);
		assert.match(out, /<FormatoTrasmissione>FPA12<\/FormatoTrasmissione>/);
		assert.match(out, /<CodiceDestinatario>UF1234<\/CodiceDestinatario>/);
	});

	test('il Codice Univoco Ufficio è di sei caratteri, non sette', () => {
		assert.deepEqual(datiMancantiCliente(comune), []);
		const settecaratteri = datiMancantiCliente({ ...comune, codice_destinatario: 'UF12345' });
		assert.ok(settecaratteri.some((m) => m.includes('sei caratteri') || m.includes('6 caratteri')));
	});

	test('senza codice ufficio non si può emettere: la PEC non è un ripiego valido', () => {
		const mancanti = datiMancantiCliente({ ...comune, codice_destinatario: null, pec: 'comune@pec.it' });
		assert.ok(mancanti.some((m) => m.includes('Codice Univoco Ufficio')));
	});

	test("con la scissione dei pagamenti l'IVA è dichiarata a carico dell'ente", () => {
		const out = costruisciXmlFattura({
			emittente,
			cliente: { ...comune, scissione_pagamenti: true },
			fattura,
			trasmissione,
		});
		assert.match(out, /<EsigibilitaIVA>S<\/EsigibilitaIVA>/);
	});

	test('senza scissione non compare nessuna esigibilità', () => {
		const out = costruisciXmlFattura({ emittente, cliente: comune, fattura, trasmissione });
		assert.ok(!out.includes('EsigibilitaIVA'));
	});
});

describe("l'aliquota a zero", () => {
	const senzaIva = { ...fattura, iva: 0, aliquota_iva: 0, totale: 500 };

	test('senza natura la fattura non si costruisce', () => {
		assert.throws(
			() => costruisciXmlFattura({ emittente, cliente, fattura: senzaIva, trasmissione }),
			/Natura dell'operazione/,
		);
	});

	test('con la natura indicata compare anche il riferimento normativo', () => {
		const out = costruisciXmlFattura({
			emittente,
			cliente,
			fattura: { ...senzaIva, natura_iva: 'N2.2' },
			trasmissione,
		});
		assert.match(out, /<Natura>N2\.2<\/Natura>/);
		assert.match(out, /<RiferimentoNormativo>/);
	});
});

describe('la diagnosi dei dati mancanti', () => {
	test('con i dati completi non segnala nulla', () => {
		assert.deepEqual(datiMancanti({ emittente, cliente, fattura }), []);
	});

	test('segnala il recapito assente, che è il motivo più comune di mancata consegna', () => {
		const mancanti = datiMancanti({
			emittente,
			cliente: { ...cliente, codice_destinatario: null, pec: null },
			fattura,
		});
		assert.ok(mancanti.some((m) => m.includes('Codice destinatario')));
	});

	test('segnala un CAP non valido invece di lasciarlo passare', () => {
		const mancanti = datiMancanti({ emittente, cliente: { ...cliente, indirizzo_cap: '2012' }, fattura });
		assert.ok(mancanti.some((m) => m.includes('CAP del cliente')));
	});

	test('segnala un codice di regime fiscale inventato', () => {
		const mancanti = datiMancanti({ emittente: { ...emittente, regime_fiscale_codice: 'RF99' }, cliente, fattura });
		assert.ok(mancanti.some((m) => m.includes('regime fiscale')));
	});

	test('elenca tutto quello che manca, non solo il primo problema', () => {
		const mancanti = datiMancanti({ emittente: {}, cliente: {}, fattura: {} });
		assert.ok(mancanti.length > 8, `attesi molti dati mancanti, trovati ${mancanti.length}`);
	});

	test("costruire una fattura incompleta solleva un errore invece di produrre un file scartabile", () => {
		assert.throws(() => costruisciXmlFattura({ emittente: {}, cliente, fattura, trasmissione }), /Partita IVA/);
	});
});

describe('il nome del file', () => {
	test('segue la convenzione paese + identificativo + progressivo', () => {
		assert.equal(nomeFileFattura('01234567891', '00001'), 'IT01234567891_00001.xml');
	});

	test('il progressivo è alfanumerico di cinque caratteri', () => {
		assert.equal(progressivoInvio(1), '00001');
		assert.equal(progressivoInvio(35), '0000Z');
		assert.equal(progressivoInvio(36), '00010');
		assert.equal(progressivoInvio(1000000).length, 5);
	});
});

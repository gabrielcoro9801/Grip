/**
 * Fattura elettronica: costruzione del file XML nel formato FatturaPA 1.2.2.
 *
 * Il PDF che l'applicazione genera oggi è un documento di cortesia: verso un soggetto con
 * partita IVA la fattura *è* questo file XML, e finché non viene trasmesso allo SdI la
 * fattura non è stata emessa. Qui si costruisce il file; la trasmissione è un passo a sé.
 *
 * Due avvertenze sul perché questo modulo è più severo di quanto sembri necessario:
 *
 * 1. **L'ordine degli elementi non è cosmetico.** Lo schema XSD dello SdI li dichiara come
 *    sequenza: un elemento giusto nel posto sbagliato fa scartare l'intera fattura. Per
 *    questo l'XML è costruito con funzioni che impongono l'ordine, non concatenando stringhe
 *    dove capita.
 * 2. **I dati mancanti si segnalano, non si indovinano.** Una fattura scartata dallo SdI si
 *    corregge e si ritrasmette; una fattura accettata con un dato inventato — un codice di
 *    regime fiscale, una natura IVA — è un errore fiscale che resta. `datiMancanti()` esiste
 *    per dire cosa manca *prima* di emettere.
 */

// Il tracciato ammette solo questi codici di regime. Per un'ASD in L. 398/1991 non esiste
// un codice dedicato: si usa RF18 ("Altro"), ma è una scelta da confermare col
// commercialista dell'ente, non un default che l'applicazione può decidere da sé.
export const REGIMI_FISCALI = {
	RF01: 'Ordinario',
	RF02: 'Contribuenti minimi',
	RF04: 'Agricoltura e attività connesse',
	RF05: 'Vendita sali e tabacchi',
	RF06: 'Commercio fiammiferi',
	RF07: 'Editoria',
	RF08: 'Gestione servizi telefonia pubblica',
	RF09: 'Rivendita documenti di trasporto pubblico',
	RF10: 'Intrattenimenti e giochi',
	RF11: 'Agenzie viaggi e turismo',
	RF12: 'Agriturismo',
	RF13: 'Vendite a domicilio',
	RF14: 'Rivendita beni usati, oggetti d’arte',
	RF15: 'Agenzie di vendite all’asta di oggetti d’arte',
	RF16: 'IVA per cassa P.A.',
	RF17: 'IVA per cassa',
	RF18: 'Altro (comprende la L. 398/1991)',
	RF19: 'Regime forfettario',
};

// Obbligatoria quando l'aliquota è zero: dice *perché* non c'è IVA. Sbagliarla è un errore
// fiscale, quindi l'applicazione non ne sceglie mai una al posto di chi emette.
export const NATURE = {
	N1: 'Escluse ex art. 15 DPR 633/72',
	'N2.1': 'Non soggette ad IVA ex artt. da 7 a 7-septies',
	'N2.2': 'Non soggette — altri casi (es. attività istituzionale ex art. 4)',
	'N3.5': 'Non imponibili a seguito di dichiarazione d’intento',
	'N4': 'Esenti ex art. 10 DPR 633/72',
	'N5': 'Regime del margine / IVA non esposta',
};

const PAESE = 'IT';
const FORMATO_PRIVATI = 'FPR12';
// Verso una Pubblica Amministrazione il tracciato è un altro, e il codice destinatario è
// il Codice Univoco Ufficio, di sei caratteri.
const FORMATO_PA = 'FPA12';
// Sette zeri: significa "recapito non noto". Lo SdI mette allora la fattura a disposizione
// nel cassetto fiscale del destinatario, oppure la consegna alla PEC se indicata.
export const DESTINATARIO_SCONOSCIUTO = '0000000';

function esc(valore) {
	return String(valore)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** Importo nel formato del tracciato: punto decimale, due cifre, mai notazione esponenziale. */
function importo(valore) {
	return Number(valore || 0).toFixed(2);
}

/** Il tracciato ha limiti di lunghezza per campo: troncare è meglio di farsi scartare. */
function testo(valore, max) {
	return String(valore ?? '').trim().slice(0, max);
}

/** Elemento con contenuto testuale; omesso del tutto se il valore è vuoto. */
function tag(nome, valore, { obbligatorio = false } = {}) {
	const v = valore ?? '';
	if (v === '' && !obbligatorio) return '';
	return `<${nome}>${esc(v)}</${nome}>`;
}

/** Elemento contenitore; omesso se non ha figli, così non restano nodi vuoti nell'XML. */
function blocco(nome, figli) {
	const corpo = figli.filter(Boolean).join('');
	if (!corpo) return '';
	return `<${nome}>${corpo}</${nome}>`;
}

function sede(indirizzo) {
	// L'ordine è quello dello schema: Indirizzo, NumeroCivico, CAP, Comune, Provincia, Nazione.
	return blocco('Sede', [
		tag('Indirizzo', testo(indirizzo?.via, 60), { obbligatorio: true }),
		tag('NumeroCivico', testo(indirizzo?.civico, 8)),
		tag('CAP', testo(indirizzo?.cap, 5), { obbligatorio: true }),
		tag('Comune', testo(indirizzo?.comune, 60), { obbligatorio: true }),
		tag('Provincia', testo(indirizzo?.provincia, 2).toUpperCase()),
		tag('Nazione', testo(indirizzo?.nazione || PAESE, 2).toUpperCase(), { obbligatorio: true }),
	]);
}

function idFiscaleIva(partitaIva) {
	if (!partitaIva) return '';
	return blocco('IdFiscaleIVA', [tag('IdPaese', PAESE, { obbligatorio: true }), tag('IdCodice', testo(partitaIva, 28), { obbligatorio: true })]);
}

/**
 * Nome del file come lo SdI lo vuole: paese + identificativo del trasmittente, underscore,
 * un progressivo alfanumerico univoco per quel trasmittente. Due file con lo stesso nome
 * vengono scartati come duplicati, anche a distanza di anni.
 */
export function nomeFileFattura(idTrasmittente, progressivoInvio) {
	return `${PAESE}${String(idTrasmittente).replace(/\s/g, '')}_${progressivoInvio}.xml`;
}

/**
 * Progressivo di invio a partire da un contatore numerico: cinque caratteri in base 36,
 * che è quanto il tracciato concede. Con cinque caratteri si arriva a oltre 60 milioni di
 * invii, ampiamente oltre la vita di un'associazione.
 */
export function progressivoInvio(contatore) {
	const base36 = Number(contatore).toString(36).toUpperCase();
	// Oltre 36^5 − 1 il progressivo non ci sta più in cinque caratteri: si tengono gli
	// ultimi, che è comunque un limite irraggiungibile per un'associazione.
	return base36.length > 5 ? base36.slice(-5) : base36.padStart(5, '0');
}

/**
 * Elenca in italiano i dati che mancano per emettere la fattura elettronica.
 *
 * Restituisce un array vuoto quando si può emettere. È volutamente separato dalla
 * costruzione dell'XML: serve a mostrare in anticipo cosa completare, invece di far
 * scoprire il problema da una fattura scartata giorni dopo.
 */
export function datiMancanti({ emittente, cliente, fattura }) {
	return [
		...datiMancantiEmittente(emittente),
		...datiMancantiCliente(cliente),
		...datiMancantiFattura(fattura),
	];
}

// Le tre verifiche sono esposte anche separate perché l'interfaccia le mostra dove i dati
// si compilano — l'anagrafica dell'ente, la scheda del cliente — e lì elencare quello che
// manca altrove sarebbe solo rumore.

/** Cosa manca all'associazione che emette. */
export function datiMancantiEmittente(emittente) {
	const mancanti = [];
	const chiedi = (condizione, messaggio) => { if (!condizione) mancanti.push(messaggio); };

	chiedi(emittente?.partita_iva, "Partita IVA dell'associazione");
	chiedi(emittente?.codice_fiscale, "Codice fiscale dell'associazione");
	chiedi(emittente?.ragione_sociale || emittente?.nome, "Denominazione dell'associazione");
	chiedi(
		emittente?.regime_fiscale_codice && REGIMI_FISCALI[emittente.regime_fiscale_codice],
		'Codice del regime fiscale (es. RF18 per la L. 398/1991) — da confermare col commercialista',
	);
	chiedi(emittente?.indirizzo_via, "Indirizzo della sede dell'associazione");
	chiedi(/^\d{5}$/.test(emittente?.indirizzo_cap || ''), 'CAP della sede (cinque cifre)');
	chiedi(emittente?.indirizzo_comune, 'Comune della sede');

	return mancanti;
}

/** Cosa manca al cliente intestatario. */
export function datiMancantiCliente(cliente) {
	const mancanti = [];
	const chiedi = (condizione, messaggio) => { if (!condizione) mancanti.push(messaggio); };

	chiedi(cliente?.ragione_sociale || cliente?.nome || cliente?.cognome, 'Denominazione o nome del cliente');
	chiedi(cliente?.partita_iva || cliente?.codice_fiscale, 'Partita IVA o codice fiscale del cliente');
	chiedi(cliente?.indirizzo_via, 'Indirizzo del cliente');
	chiedi(/^\d{5}$/.test(cliente?.indirizzo_cap || ''), 'CAP del cliente (cinque cifre)');
	chiedi(cliente?.indirizzo_comune, 'Comune del cliente');

	// Verso una PA il recapito non è opzionale: il Codice Univoco Ufficio è l'unico modo di
	// consegnare, non esiste il ripiego del cassetto fiscale.
	if (cliente?.pubblica_amministrazione) {
		chiedi(cliente?.codice_destinatario, 'Codice Univoco Ufficio della Pubblica Amministrazione (6 caratteri)');
		if (cliente?.codice_destinatario) {
			chiedi(
				/^[A-Za-z0-9]{6}$/.test(cliente.codice_destinatario),
				'Il Codice Univoco Ufficio deve essere di 6 caratteri alfanumerici',
			);
		}
	} else {
		// Il recapito è il dato che decide se la fattura arriva: senza, lo SdI non sa a chi
		// consegnarla. I sette zeri sono una risposta valida — la fattura finisce nel cassetto
		// fiscale del destinatario — ma deve essere una scelta, non una dimenticanza.
		chiedi(cliente?.codice_destinatario || cliente?.pec, 'Codice destinatario (7 caratteri) o PEC del cliente');
		if (cliente?.codice_destinatario) {
			chiedi(
				/^[A-Za-z0-9]{7}$/.test(cliente.codice_destinatario),
				'Il codice destinatario deve essere di 7 caratteri alfanumerici',
			);
		}
	}

	return mancanti;
}

/** Cosa manca al documento. */
export function datiMancantiFattura(fattura) {
	const mancanti = [];
	const chiedi = (condizione, messaggio) => { if (!condizione) mancanti.push(messaggio); };

	chiedi(fattura?.data_emissione, 'Data di emissione');
	chiedi(fattura?.numero_progressivo, 'Numero della fattura');
	chiedi(Number(fattura?.imponibile) > 0, 'Imponibile maggiore di zero');
	// Aliquota zero senza natura è la fattura scartata più comune.
	if (!(Number(fattura?.aliquota_iva) > 0)) {
		chiedi(
			fattura?.natura_iva && NATURE[fattura.natura_iva],
			"Natura dell'operazione: con aliquota IVA a zero il tracciato richiede il motivo (es. N2.2 per l'attività istituzionale)",
		);
	}

	return mancanti;
}

/**
 * Costruisce l'XML della fattura.
 *
 * Solleva un errore se mancano dati obbligatori: emettere un file incompleto significherebbe
 * farlo scartare dallo SdI, e nel frattempo il numero di fattura è stato consumato.
 */
export function costruisciXmlFattura({ emittente, cliente, fattura, trasmissione }) {
	const mancanti = datiMancanti({ emittente, cliente, fattura });
	if (mancanti.length) {
		throw new Error(`Non è possibile emettere la fattura elettronica: ${mancanti.join('; ')}.`);
	}

	const idTrasmittente = trasmissione?.id_trasmittente || emittente.partita_iva;
	const progressivo = trasmissione?.progressivo_invio;
	if (!progressivo) throw new Error('Manca il progressivo di invio.');

	const versoPa = Boolean(cliente.pubblica_amministrazione);
	const formato = versoPa ? FORMATO_PA : FORMATO_PRIVATI;
	const codiceDestinatario = cliente.codice_destinatario || DESTINATARIO_SCONOSCIUTO;
	const imponibile = Number(fattura.imponibile);
	const aliquota = Number(fattura.aliquota_iva) || 0;
	const imposta = Number(fattura.iva) || 0;
	const totale = Number(fattura.totale ?? imponibile + imposta);

	const datiTrasmissione = blocco('DatiTrasmissione', [
		blocco('IdTrasmittente', [tag('IdPaese', PAESE, { obbligatorio: true }), tag('IdCodice', testo(idTrasmittente, 28), { obbligatorio: true })]),
		tag('ProgressivoInvio', progressivo, { obbligatorio: true }),
		tag('FormatoTrasmissione', formato, { obbligatorio: true }),
		tag('CodiceDestinatario', codiceDestinatario.toUpperCase(), { obbligatorio: true }),
		// La PEC si indica solo quando non c'è un codice: indicarla insieme a un codice
		// valido è un errore di tracciato.
		codiceDestinatario === DESTINATARIO_SCONOSCIUTO ? tag('PECDestinatario', testo(cliente.pec, 256)) : '',
	]);

	const cedente = blocco('CedentePrestatore', [
		blocco('DatiAnagrafici', [
			idFiscaleIva(emittente.partita_iva),
			tag('CodiceFiscale', testo(emittente.codice_fiscale, 16)),
			blocco('Anagrafica', [tag('Denominazione', testo(emittente.ragione_sociale || emittente.nome, 80), { obbligatorio: true })]),
			tag('RegimeFiscale', emittente.regime_fiscale_codice, { obbligatorio: true }),
		]),
		sede({
			via: emittente.indirizzo_via,
			civico: emittente.indirizzo_civico,
			cap: emittente.indirizzo_cap,
			comune: emittente.indirizzo_comune,
			provincia: emittente.indirizzo_provincia,
			nazione: emittente.indirizzo_nazione,
		}),
	]);

	// Una persona fisica si identifica con nome e cognome, una società con la denominazione:
	// il tracciato ammette l'uno o l'altro, mai entrambi.
	const anagraficaCliente = cliente.ragione_sociale
		? blocco('Anagrafica', [tag('Denominazione', testo(cliente.ragione_sociale, 80), { obbligatorio: true })])
		: blocco('Anagrafica', [
			tag('Nome', testo(cliente.nome, 60), { obbligatorio: true }),
			tag('Cognome', testo(cliente.cognome, 60), { obbligatorio: true }),
		]);

	const cessionario = blocco('CessionarioCommittente', [
		blocco('DatiAnagrafici', [
			idFiscaleIva(cliente.partita_iva),
			tag('CodiceFiscale', testo(cliente.codice_fiscale, 16)),
			anagraficaCliente,
		]),
		sede({
			via: cliente.indirizzo_via,
			civico: cliente.indirizzo_civico,
			cap: cliente.indirizzo_cap,
			comune: cliente.indirizzo_comune,
			provincia: cliente.indirizzo_provincia,
			nazione: cliente.indirizzo_nazione,
		}),
	]);

	const header = blocco('FatturaElettronicaHeader', [datiTrasmissione, cedente, cessionario]);

	const numeroDocumento = `${fattura.numero_progressivo}/${fattura.esercizio_fiscale}`;
	const datiGenerali = blocco('DatiGenerali', [
		blocco('DatiGeneraliDocumento', [
			tag('TipoDocumento', 'TD01', { obbligatorio: true }),
			tag('Divisa', 'EUR', { obbligatorio: true }),
			tag('Data', String(fattura.data_emissione).slice(0, 10), { obbligatorio: true }),
			tag('Numero', testo(numeroDocumento, 20), { obbligatorio: true }),
			tag('ImportoTotaleDocumento', importo(totale)),
		]),
	]);

	const natura = aliquota > 0 ? '' : fattura.natura_iva;
	const dettaglio = blocco('DettaglioLinee', [
		tag('NumeroLinea', '1', { obbligatorio: true }),
		tag('Descrizione', testo(fattura.descrizione || 'Prestazione di servizi', 1000), { obbligatorio: true }),
		tag('PrezzoUnitario', importo(imponibile), { obbligatorio: true }),
		tag('PrezzoTotale', importo(imponibile), { obbligatorio: true }),
		tag('AliquotaIVA', importo(aliquota), { obbligatorio: true }),
		tag('Natura', natura),
	]);

	const riepilogo = blocco('DatiRiepilogo', [
		tag('AliquotaIVA', importo(aliquota), { obbligatorio: true }),
		tag('Natura', natura),
		tag('ImponibileImporto', importo(imponibile), { obbligatorio: true }),
		tag('Imposta', importo(imposta), { obbligatorio: true }),
		// Con aliquota a zero il tracciato vuole anche la norma che la giustifica.
		natura ? tag('RiferimentoNormativo', testo(fattura.riferimento_normativo || NATURE[natura], 100)) : '',
		// Scissione dei pagamenti: dice che l'IVA la versa il committente, non chi emette.
		// Va dichiarata nel documento, altrimenti l'importo atteso non torna a nessuno dei due.
		cliente.scissione_pagamenti ? tag('EsigibilitaIVA', 'S') : '',
	]);

	const body = blocco('FatturaElettronicaBody', [datiGenerali, blocco('DatiBeniServizi', [dettaglio, riepilogo])]);

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<p:FatturaElettronica versione="' + formato + '"',
		' xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"',
		' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
		' xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2',
		' http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2.2/Schema_del_file_xml_FatturaPA_versione_1.2.2.xsd">',
		header,
		body,
		'</p:FatturaElettronica>',
	].join('');
}

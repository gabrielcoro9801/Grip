/**
 * Costruzione delle righe di una scrittura in partita doppia.
 *
 * Questa parte era mescolata alla chiamata che salva la scrittura, e quindi non si poteva
 * verificare senza un database e un server accesi. È la logica più delicata
 * dell'applicazione — se sbaglia, produce una scrittura che quadra e che è sul conto
 * sbagliato — quindi vive qui da sola, come funzione pura: entrano dei numeri, escono delle
 * righe, e si può interrogare in un test.
 *
 * I conti si cercano per **ruolo** e mai per codice: vedi shared/contiSistema.js.
 */
import { contoPerRuolo } from './contiSistema.js';

/** Un centesimo: sotto questa soglia la differenza è arrotondamento, non sbilancio. */
const TOLLERANZA = 0.005;

/** Arrotonda al centesimo, che è la precisione con cui gli importi vengono conservati. */
export function centesimi(valore) {
	return Math.round((Number(valore) || 0) * 100) / 100;
}

/**
 * Scorpora l'IVA da un importo lordo.
 *
 * Gli importi vanno arrotondati **qui**, non lasciati alla banca dati: le colonne hanno due
 * decimali, e due valori che sommano esattamente al lordo prima dell'arrotondamento possono
 * non sommarci più dopo. Uno sbilancio di un centesimo in una scrittura è il genere di
 * errore che nessuno nota finché non torna il bilancio.
 */
export function scorporaIva(importoLordo, causale) {
	const lordo = centesimi(importoLordo);
	const aliquota = Number(causale?.aliquota_iva_default) || 0;
	if (!causale?.gestisce_iva || !aliquota) {
		return { imponibile: lordo, iva: 0, aliquota: 0 };
	}
	// L'IVA si calcola e si arrotonda per prima; l'imponibile è ciò che resta. Al contrario
	// — arrotondando l'imponibile — la somma delle due parti potrebbe non dare il lordo.
	const iva = centesimi(lordo - lordo / (1 + aliquota / 100));
	return { imponibile: centesimi(lordo - iva), iva, aliquota };
}

/** Somma di dare e avere, per verificare che una scrittura quadri. */
export function totaliRighe(righe) {
	const dare = centesimi((righe ?? []).reduce((s, r) => s + (Number(r.dare) || 0), 0));
	const avere = centesimi((righe ?? []).reduce((s, r) => s + (Number(r.avere) || 0), 0));
	return { dare, avere, quadra: Math.abs(dare - avere) < TOLLERANZA };
}

/**
 * Le righe di una registrazione generata da una causale operativa.
 *
 * @param {Object} p
 * @param {Object} p.causale causale operativa (porta i conti di contropartita e di credito/debito)
 * @param {number} p.importoLordo importo comprensivo di IVA
 * @param {Array}  p.conti piano dei conti dell'organizzazione
 * @param {boolean} p.aCredito se l'operazione non movimenta subito la liquidità
 * @param {'cassa'|'banca'} p.metodoLiquidita
 * @param {string} [p.controparteId]
 * @param {'cliente'|'fornitore'} [p.controparteTipo]
 * @param {{importo:number}} [p.ritenuta] ritenuta d'acconto sul compenso, se dovuta
 * @returns {{imponibile:number, iva:number, aliquota:number, righe:Array, statoPagamento:string}}
 */
export function costruisciRigheScrittura({
	causale,
	importoLordo,
	conti,
	aCredito = false,
	metodoLiquidita = 'cassa',
	controparteId,
	controparteTipo,
	ritenuta,
}) {
	const lordo = centesimi(importoLordo);
	if (!(lordo > 0)) throw new Error("L'importo della registrazione deve essere maggiore di zero.");

	const { imponibile, iva, aliquota } = scorporaIva(lordo, causale);

	const contoContropartita = (conti ?? []).find((c) => c.id === causale?.conto_contropartita_id);
	if (!contoContropartita) throw new Error('Conto contropartita non trovato.');

	const contoCreditoDebito = causale?.conto_credito_debito_id
		? (conti ?? []).find((c) => c.id === causale.conto_credito_debito_id)
		: null;
	if (aCredito && !contoCreditoDebito) {
		throw new Error('La causale non ha un conto di credito/debito: non può essere registrata a credito.');
	}

	const isEntrata = causale?.tipo === 'entrata';

	// Sui compensi ai professionisti una quota non va al fornitore ma all'erario. Il costo
	// resta intero — la ritenuta non è uno sconto — mentre il lato avere si divide fra chi
	// riceve davvero il denaro e l'erario, a cui lo si versa per conto suo.
	const importoRitenuta = centesimi(ritenuta?.importo > 0 ? ritenuta.importo : 0);
	if (importoRitenuta > lordo) {
		throw new Error("La ritenuta d'acconto non può superare l'importo del compenso.");
	}
	const daPagare = centesimi(lordo - importoRitenuta);

	// I conti di sistema si risolvono solo quando servono davvero: chiederli tutti in
	// anticipo farebbe fallire una registrazione senza IVA perché manca il conto dell'IVA.
	const liquidita = () => contoPerRuolo(conti, metodoLiquidita === 'banca' ? 'banca' : 'cassa');
	const ivaDebito = () => contoPerRuolo(conti, 'iva_debito');
	const erarioRitenute = () => contoPerRuolo(conti, 'erario_ritenute_autonomi');

	const righe = [];
	const contropartita = { controparte_tipo: controparteTipo, controparte_id: controparteId };
	const datiIva = iva > 0 ? { importo_iva: iva, aliquota_iva: aliquota } : {};

	if (!aCredito) {
		if (isEntrata) {
			righe.push({ conto_id: liquidita().id, dare: lordo, avere: 0 });
			righe.push({ conto_id: contoContropartita.id, dare: 0, avere: imponibile, ...contropartita });
			if (iva > 0) righe.push({ conto_id: ivaDebito().id, dare: 0, avere: iva, ...datiIva });
		} else {
			righe.push({ conto_id: contoContropartita.id, dare: lordo, avere: 0, ...contropartita, ...datiIva });
			righe.push({ conto_id: liquidita().id, dare: 0, avere: daPagare });
			if (importoRitenuta > 0) righe.push({ conto_id: erarioRitenute().id, dare: 0, avere: importoRitenuta });
		}
	} else {
		if (isEntrata) {
			righe.push({ conto_id: contoCreditoDebito.id, dare: lordo, avere: 0, ...contropartita });
			righe.push({ conto_id: contoContropartita.id, dare: 0, avere: imponibile });
			if (iva > 0) righe.push({ conto_id: ivaDebito().id, dare: 0, avere: iva, ...datiIva });
		} else {
			righe.push({ conto_id: contoContropartita.id, dare: lordo, avere: 0, ...datiIva });
			// Al fornitore si deve solo il netto: la ritenuta è già un debito verso l'erario,
			// che si versa con l'F24 indipendentemente da quando si paga il fornitore.
			righe.push({ conto_id: contoCreditoDebito.id, dare: 0, avere: daPagare, ...contropartita });
			if (importoRitenuta > 0) righe.push({ conto_id: erarioRitenute().id, dare: 0, avere: importoRitenuta });
		}
	}

	// Rete di sicurezza: una scrittura sbilanciata non deve nemmeno uscire da qui. Se questo
	// scatta è un errore di questo modulo, non dell'utente, e va visto subito.
	const totali = totaliRighe(righe);
	if (!totali.quadra) {
		throw new Error(
			`Errore interno: scrittura non quadrata (dare ${totali.dare.toFixed(2)}, avere ${totali.avere.toFixed(2)}).`,
		);
	}

	return {
		imponibile,
		iva,
		aliquota,
		righe,
		statoPagamento: aCredito ? (isEntrata ? 'da_incassare' : 'da_pagare') : 'saldata',
	};
}

/**
 * Le righe che saldano un credito o un debito ancora aperto: la liquidità si muove ora,
 * il credito o il debito si chiude.
 */
export function costruisciRigheSaldo({ contoCreditoDebitoId, importo, conti, metodoLiquidita, daIncassare }) {
	const valore = centesimi(importo);
	if (!(valore > 0)) throw new Error("L'importo del saldo deve essere maggiore di zero.");
	const liquidita = contoPerRuolo(conti, metodoLiquidita === 'banca' ? 'banca' : 'cassa');

	return daIncassare
		? [
			{ conto_id: liquidita.id, dare: valore, avere: 0 },
			{ conto_id: contoCreditoDebitoId, dare: 0, avere: valore },
		]
		: [
			{ conto_id: contoCreditoDebitoId, dare: valore, avere: 0 },
			{ conto_id: liquidita.id, dare: 0, avere: valore },
		];
}

/**
 * Le righe del pagamento di una rata di finanziamento: la quota capitale riduce il debito,
 * la quota interessi è un costo, e dalla liquidità esce la somma delle due.
 */
export function costruisciRigheRata({ quotaCapitale, quotaInteressi, conti, metodoLiquidita }) {
	const capitale = centesimi(quotaCapitale);
	const interessi = centesimi(quotaInteressi);
	const totale = centesimi(capitale + interessi);
	if (!(totale > 0)) throw new Error("L'importo della rata deve essere maggiore di zero.");

	const righe = [];
	if (capitale > 0) righe.push({ conto_id: contoPerRuolo(conti, 'debiti_banche').id, dare: capitale, avere: 0 });
	if (interessi > 0) righe.push({ conto_id: contoPerRuolo(conti, 'interessi_passivi').id, dare: interessi, avere: 0 });
	righe.push({
		conto_id: contoPerRuolo(conti, metodoLiquidita === 'banca' ? 'banca' : 'cassa').id,
		dare: 0,
		avere: totale,
	});
	return righe;
}

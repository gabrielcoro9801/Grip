/**
 * Come si classifica un conto, spiegato a chi non fa il commercialista.
 *
 * "Attivo / passivo / patrimonio netto / ricavo / costo" e "natura dare o avere" sono il
 * vocabolario giusto, ma chi apre il piano dei conti in un'associazione spesso non lo
 * conosce — e sbagliare la classificazione **non dà errore**: la registrazione si fa, quadra,
 * e il bilancio risulta storto. È il tipo di problema che si scopre a fine anno.
 *
 * Qui la domanda è in italiano corrente e la classificazione si ricava.
 */

/**
 * I tipi, con la domanda a cui rispondono e il lato in cui il conto aumenta.
 *
 * `naturaTipica` è ciò che vale quasi sempre, non una regola rigida: esistono i **fondi
 * rettificativi**, che stanno nell'attivo ma si sottraggono — il fondo ammortamento è il
 * caso classico, e nel piano dei conti predefinito c'è già. Imporre la natura renderebbe
 * impossibile crearli.
 */
export const TIPI_CONTO = {
	attivo: {
		label: 'Attivo',
		domanda: "Qualcosa che l'associazione possiede o le è dovuto",
		esempi: 'Cassa, conto corrente, attrezzature, crediti verso i soci',
		naturaTipica: 'dare',
	},
	passivo: {
		label: 'Passivo',
		domanda: "Qualcosa che l'associazione deve a qualcuno",
		esempi: 'Debiti verso fornitori, mutui, stipendi da pagare, IVA da versare',
		naturaTipica: 'avere',
	},
	patrimonio_netto: {
		label: 'Patrimonio netto',
		domanda: "Il patrimonio proprio dell'associazione",
		esempi: 'Fondo di dotazione, utili e perdite degli anni precedenti',
		naturaTipica: 'avere',
	},
	ricavo: {
		label: 'Ricavo',
		domanda: 'Denaro che entra per una prestazione o una quota',
		esempi: 'Quote associative, corsi, affitto sala, sponsorizzazioni',
		naturaTipica: 'avere',
	},
	costo: {
		label: 'Costo',
		domanda: "Denaro che esce per far funzionare l'associazione",
		esempi: 'Affitto, utenze, stipendi, forniture, interessi',
		naturaTipica: 'dare',
	},
};

export const NOMI_TIPI_CONTO = Object.keys(TIPI_CONTO);

/** La natura che ci si aspetta per quel tipo. */
export function naturaTipica(tipoConto) {
	return TIPI_CONTO[tipoConto]?.naturaTipica ?? 'dare';
}

/**
 * Un conto la cui natura è opposta a quella del suo tipo: invece di sommarsi al proprio
 * gruppo, lo rettifica in diminuzione. Raro e legittimo — il fondo ammortamento sta
 * nell'attivo ma riduce il valore dei beni.
 */
export function eRettificativo(tipoConto, natura) {
	if (!tipoConto || !natura) return false;
	return natura !== naturaTipica(tipoConto);
}

/**
 * Cosa succede a questo conto quando lo si movimenta, detto in italiano.
 *
 * È l'informazione che serve davvero per capire se la classificazione è giusta: "natura:
 * avere" non dice niente a nessuno, "un movimento in avere lo aumenta" sì.
 */
export function effettoDelMovimento(tipoConto, natura) {
	if (!natura) return null;
	const aumenta = natura === 'dare' ? 'dare' : 'avere';
	const diminuisce = natura === 'dare' ? 'avere' : 'dare';
	const base = `Un movimento in ${aumenta} aumenta questo conto, uno in ${diminuisce} lo diminuisce.`;
	if (!eRettificativo(tipoConto, natura)) return base;

	const gruppo = TIPI_CONTO[tipoConto]?.label?.toLowerCase() ?? tipoConto;
	return `${base} È un conto rettificativo: pur essendo classificato fra i conti di ${gruppo}, li riduce invece di aumentarli — come il fondo ammortamento.`;
}

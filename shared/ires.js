// Stima IRES per un'associazione in regime forfetario della legge 398/1991.
//
// In questo regime il reddito imponibile non si calcola per differenza fra ricavi e costi:
// si applica un coefficiente di redditività ai proventi commerciali, e i costi effettivi
// non contano. Le plusvalenze patrimoniali fanno eccezione e concorrono per intero.
//
// È una stima indicativa e va presentata come tale: non tiene conto di variazioni in
// aumento o diminuzione, perdite pregresse, agevolazioni, né delle verifiche che restano
// di competenza del commercialista.

/** Coefficiente di redditività sui proventi commerciali (art. 2 c.5 L. 398/1991). */
export const COEFFICIENTE_REDDITIVITA = 3;

/** Aliquota IRES ordinaria. */
export const ALIQUOTA_IRES = 24;

/**
 * @param {number} proventiCommerciali proventi dell'attività commerciale nel periodo
 * @param {number} plusvalenze plusvalenze patrimoniali del periodo
 */
export function stimaIres(proventiCommerciali, plusvalenze = 0) {
	const commerciali = Number(proventiCommerciali) || 0;
	const plus = Number(plusvalenze) || 0;

	// Il coefficiente si applica solo ai proventi commerciali; le plusvalenze entrano
	// nell'imponibile senza abbattimento.
	const redditoDaProventi = (commerciali * COEFFICIENTE_REDDITIVITA) / 100;
	const imponibile = redditoDaProventi + plus;
	const imposta = (imponibile * ALIQUOTA_IRES) / 100;

	return {
		proventiCommerciali: commerciali,
		plusvalenze: plus,
		redditoDaProventi: Math.round(redditoDaProventi * 100) / 100,
		imponibile: Math.round(imponibile * 100) / 100,
		imposta: Math.round(imposta * 100) / 100,
		coefficiente: COEFFICIENTE_REDDITIVITA,
		aliquota: ALIQUOTA_IRES,
	};
}

// Stima IRES per un'associazione in regime forfetario della legge 398/1991.
//
// In questo regime il reddito imponibile non si calcola per differenza fra ricavi e costi:
// si applica un coefficiente di redditività ai proventi commerciali, e i costi effettivi
// non contano. Le plusvalenze patrimoniali fanno eccezione e concorrono per intero.
//
// È una stima indicativa e va presentata come tale: non tiene conto di variazioni in
// aumento o diminuzione, perdite pregresse, agevolazioni, né delle verifiche che restano
// di competenza del commercialista.
//
// Aliquota e coefficiente **arrivano da fuori**, letti dai parametri fiscali per la data
// dell'esercizio: erano costanti, ma sono valori di legge che cambiano nel tempo, e
// ricalcolare un anno vecchio con l'aliquota di oggi darebbe un numero sbagliato che
// sembra giusto.

/**
 * @param {number} proventiCommerciali proventi dell'attività commerciale nel periodo
 * @param {number} plusvalenze plusvalenze patrimoniali del periodo
 * @param {{aliquota:number, coefficiente:number}} parametri valori in vigore nell'esercizio
 */
export function stimaIres(proventiCommerciali, plusvalenze = 0, parametri) {
	const aliquota = Number(parametri?.aliquota);
	const coefficiente = Number(parametri?.coefficiente);
	if (!Number.isFinite(aliquota) || !Number.isFinite(coefficiente)) {
		throw new Error(
			'Per stimare l\'IRES servono aliquota e coefficiente di redditività in vigore nell\'esercizio. ' +
			'Vanno letti dai parametri fiscali, non dati per noti.',
		);
	}

	const commerciali = Number(proventiCommerciali) || 0;
	const plus = Number(plusvalenze) || 0;

	// Il coefficiente si applica solo ai proventi commerciali; le plusvalenze entrano
	// nell'imponibile senza abbattimento.
	const redditoDaProventi = (commerciali * coefficiente) / 100;
	const imponibile = redditoDaProventi + plus;
	const imposta = (imponibile * aliquota) / 100;

	return {
		proventiCommerciali: commerciali,
		plusvalenze: plus,
		redditoDaProventi: Math.round(redditoDaProventi * 100) / 100,
		imponibile: Math.round(imponibile * 100) / 100,
		imposta: Math.round(imposta * 100) / 100,
		coefficiente,
		aliquota,
	};
}

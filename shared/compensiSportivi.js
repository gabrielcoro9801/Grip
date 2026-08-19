// Soglia di esenzione dei compensi sportivi dilettantistici.
//
// I compensi erogati a collaboratori sportivi non concorrono a formare reddito fino a una
// soglia annua, che è **cumulata fra tutti gli enti** per i quali la persona collabora.
// L'associazione non può conoscere quanto la persona ha percepito altrove: lo sa solo
// tramite l'autocertificazione che il collaboratore è tenuto a rilasciare.
//
// Da qui discende il punto pratico: senza autocertificazione il cumulo è per forza
// sottostimato, e un "sotto soglia" calcolato su dati parziali è peggio di nessuna
// informazione — dà per tranquillo qualcosa che non lo è.

export const SOGLIA_ESENZIONE = 15000;

/**
 * Posizione di un collaboratore rispetto alla soglia, tenendo conto del compenso che si
 * sta per erogare — non solo di quelli già liquidati.
 *
 * @param {Object} p
 * @param {number} p.giaLiquidato compensi già erogati dall'ente nell'anno
 * @param {number} p.autocertificatoAltriEnti quanto dichiarato percepito da altri enti
 * @param {number} p.compensoInCorso compenso che si sta per erogare (0 se nessuno)
 * @param {string|null} p.dataAutocertificazione data dell'autocertificazione, se raccolta
 */
export function posizioneSoglia({
	giaLiquidato = 0,
	autocertificatoAltriEnti = 0,
	compensoInCorso = 0,
	dataAutocertificazione = null,
} = {}) {
	const cumuloPrima = Number(giaLiquidato) + Number(autocertificatoAltriEnti);
	const cumuloDopo = cumuloPrima + Number(compensoInCorso);

	const eccedenza = Math.max(0, cumuloDopo - SOGLIA_ESENZIONE);
	const eccedenzaPrima = Math.max(0, cumuloPrima - SOGLIA_ESENZIONE);

	return {
		cumuloPrima: Math.round(cumuloPrima * 100) / 100,
		cumuloDopo: Math.round(cumuloDopo * 100) / 100,
		residuoDisponibile: Math.max(0, Math.round((SOGLIA_ESENZIONE - cumuloPrima) * 100) / 100),
		eccedenza: Math.round(eccedenza * 100) / 100,
		// La quota di questo specifico compenso che finisce oltre la soglia: è quella su cui
		// va valutata la tassazione, non l'eccedenza complessiva.
		eccedenzaDiQuestoCompenso: Math.round((eccedenza - eccedenzaPrima) * 100) / 100,
		giaOltreSoglia: cumuloPrima > SOGLIA_ESENZIONE,
		superaConQuestoCompenso: cumuloPrima <= SOGLIA_ESENZIONE && cumuloDopo > SOGLIA_ESENZIONE,
		// Senza autocertificazione il cumulo considera solo i compensi di questo ente:
		// il confronto con la soglia non è attendibile.
		autocertificazioneMancante: !dataAutocertificazione,
	};
}

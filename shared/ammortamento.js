// Piano di ammortamento alla francese: la rata resta costante per tutta la durata, mentre
// al suo interno la quota di interessi cala e quella di capitale cresce. È il metodo con cui
// sono costruiti quasi tutti i mutui e i finanziamenti bancari.
//
// Il piano è una proiezione, non un dato: si ricalcola dai parametri del finanziamento.
// Le rate diventano record veri solo quando vengono generate, una alla volta.

export const PERIODICITA = {
	mensile: { label: 'Mensile', rateAnno: 12, mesi: 1 },
	trimestrale: { label: 'Trimestrale', rateAnno: 4, mesi: 3 },
	semestrale: { label: 'Semestrale', rateAnno: 2, mesi: 6 },
	annuale: { label: 'Annuale', rateAnno: 1, mesi: 12 },
};

const arrotonda = (n) => Math.round(n * 100) / 100;

/** Aggiunge mesi a una data ISO (YYYY-MM-DD) senza dipendere da librerie esterne. */
function aggiungiMesi(dataIso, mesi) {
	const [anno, mese, giorno] = dataIso.split('-').map(Number);
	const d = new Date(Date.UTC(anno, mese - 1 + mesi, 1));
	// Se il giorno non esiste nel mese di arrivo (es. il 31 in un mese di 30), si usa
	// l'ultimo giorno disponibile, come fanno i piani di ammortamento reali.
	const ultimoGiorno = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
	d.setUTCDate(Math.min(giorno, ultimoGiorno));
	return d.toISOString().split('T')[0];
}

/**
 * Calcola il piano completo.
 *
 * @param {number} capitale importo erogato
 * @param {number} tassoAnnuo percentuale annua (es. 4.5)
 * @param {number} numeroRate numero totale di rate
 * @param {string} dataInizio data di erogazione (YYYY-MM-DD)
 * @param {string} periodicita chiave di PERIODICITA
 * @returns {Array<{numero_rata, data_scadenza, quota_capitale, quota_interessi, rata, capitale_residuo}>}
 */
export function calcolaPianoAmmortamento(capitale, tassoAnnuo, numeroRate, dataInizio, periodicita = 'mensile') {
	const cfg = PERIODICITA[periodicita] ?? PERIODICITA.mensile;
	const n = Math.max(0, Math.floor(numeroRate) || 0);
	if (!(capitale > 0) || n === 0) return [];

	const tassoPeriodo = (Number(tassoAnnuo) || 0) / 100 / cfg.rateAnno;

	// A tasso zero il capitale si divide semplicemente in parti uguali: la formula della
	// rata costante non è definita (dividerebbe per zero).
	const rata = tassoPeriodo === 0
		? capitale / n
		: (capitale * tassoPeriodo) / (1 - Math.pow(1 + tassoPeriodo, -n));

	const piano = [];
	let residuo = capitale;

	for (let k = 1; k <= n; k++) {
		const interessi = arrotonda(residuo * tassoPeriodo);
		// Sull'ultima rata si azzera il residuo invece di ricalcolarlo: gli arrotondamenti
		// centesimo per centesimo lascerebbero altrimenti qualche spicciolo di debito.
		const capitaleQuota = k === n ? arrotonda(residuo) : arrotonda(rata - interessi);
		residuo = arrotonda(residuo - capitaleQuota);

		piano.push({
			numero_rata: k,
			data_scadenza: aggiungiMesi(dataInizio, cfg.mesi * k),
			quota_capitale: capitaleQuota,
			quota_interessi: interessi,
			rata: arrotonda(capitaleQuota + interessi),
			capitale_residuo: residuo,
		});
	}

	return piano;
}

/** Totale degli interessi sull'intera durata: il costo del finanziamento. */
export function totaleInteressi(piano) {
	return arrotonda(piano.reduce((s, r) => s + r.quota_interessi, 0));
}

/**
 * Le lezioni dei corsi settimanali salvate un giorno prima, e come riconoscerle.
 *
 * Il gestionale generava le date nel browser partendo dalla mezzanotte locale e le scriveva
 * con `toISOString()`, cioè in UTC: in Italia la mezzanotte è ancora il giorno prima, e ogni
 * lezione di un evento settimanale finiva salvata esattamente un giorno prima di quella
 * chiesta. Il calendario del gestionale era sfalsato dello stesso giorno al contrario, e le
 * mostrava giuste; il portale soci, che usa la data vera, no.
 *
 * Il riconoscimento non guarda il giorno della settimana di una lezione da sola: un evento
 * del sabato **e** della domenica, salvato sfalsato, ha lezioni di venerdì e di sabato, e il
 * sabato sembrerebbe giusto. Si guarda l'evento intero: si ricalcolano le date che avrebbe
 * dovuto avere e si conta quante lezioni cadono su quelle, e quante su quelle stesse meno
 * un giorno. Vince la maggioranza; a pari merito non si tocca niente e si segnala.
 *
 * I conti sono tutti in UTC su date senza ora, quindi non dipendono dal fuso della macchina
 * né dalla lingua del database.
 */

const GIORNI = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const MASSIMO_GIORNI = 10000; // lo stesso tetto del generatore nel browser

const aUtc = (iso) => {
	const [a, m, g] = String(iso).slice(0, 10).split('-').map(Number);
	return new Date(Date.UTC(a, m - 1, g));
};
const aIso = (d) => d.toISOString().slice(0, 10);

/** La data `iso` spostata di `giorni`. */
export function spostaGiorni(iso, giorni) {
	const d = aUtc(iso);
	d.setUTCDate(d.getUTCDate() + giorni);
	return aIso(d);
}

/** Le date che un evento settimanale avrebbe dovuto generare: stessa regola del gestionale. */
export function dateGiuste(evento) {
	const giorni = new Set((evento.days_of_week ?? []).map((g) => GIORNI[g]).filter((g) => g !== undefined));
	if (!giorni.size || !evento.start_date) return [];

	const date = [];
	const corrente = aUtc(evento.start_date);
	const fine = evento.end_condition === 'by_date' && evento.end_date ? aUtc(evento.end_date) : null;
	const quante = evento.end_condition === 'by_count' ? Number(evento.occurrence_count) || 0 : Infinity;
	if (!fine && quante === Infinity) return [];

	for (let i = 0; i < MASSIMO_GIORNI; i++) {
		if (fine && corrente > fine) break;
		if (date.length >= quante) break;
		if (giorni.has(corrente.getUTCDay())) date.push(aIso(corrente));
		corrente.setUTCDate(corrente.getUTCDate() + 1);
	}
	return date;
}

/**
 * Cosa fare delle lezioni di un evento settimanale.
 *
 * @param evento  { days_of_week, start_date, end_condition, end_date, occurrence_count }
 * @param lezioni [{ id, date }]
 * @returns { esito: 'giusto' | 'sfalsato' | 'incerto', daSpostare: [{ id, da, a }], fuoriSchema: [{ id, date }] }
 */
export function esaminaEvento(evento, lezioni) {
	const giuste = new Set(dateGiuste(evento));
	const sfalsate = new Set([...giuste].map((d) => spostaGiorni(d, -1)));

	const dataDi = (l) => String(l.date).slice(0, 10);
	const suGiuste = lezioni.filter((l) => giuste.has(dataDi(l))).length;
	const suSfalsate = lezioni.filter((l) => sfalsate.has(dataDi(l))).length;

	if (suSfalsate === 0 || suSfalsate < suGiuste) return { esito: 'giusto', daSpostare: [], fuoriSchema: [] };
	if (suSfalsate === suGiuste) return { esito: 'incerto', daSpostare: [], fuoriSchema: [] };

	return {
		esito: 'sfalsato',
		daSpostare: lezioni
			.filter((l) => sfalsate.has(dataDi(l)))
			.map((l) => ({ id: l.id, da: dataDi(l), a: spostaGiorni(dataDi(l), 1) })),
		// Lezioni spostate a mano su un'altra data: non si indovina dove dovevano andare.
		fuoriSchema: lezioni.filter((l) => !sfalsate.has(dataDi(l))).map((l) => ({ id: l.id, date: dataDi(l) })),
	};
}

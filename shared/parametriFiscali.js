/**
 * Aliquote e soglie di legge, con la data da cui valgono.
 *
 * Erano costanti nel codice: `ALIQUOTA_IRES = 24`, `SOGLIA_ESENZIONE = 15000`. Il problema
 * non era che fossero fisse — sono legge, non preferenze dell'ente — ma che fossero
 * **senza data**. L'applicazione calcola anche numeri di esercizi passati: se fra due anni
 * l'aliquota cambia e si ricalcola la chiusura del 2026, con una costante si otterrebbe un
 * valore sbagliato, e sbagliato in modo silenzioso — sembrerebbe corretto.
 *
 * Ora il valore da applicare è quello **in vigore alla data dell'operazione**. Quando una
 * legge cambia un valore non si modifica la riga esistente: se ne aggiunge una nuova con la
 * propria decorrenza, e la precedente continua a valere per il passato.
 */

export const PARAMETRI = {
	aliquota_ires: {
		label: 'Aliquota IRES',
		unita: '%',
		descrizione: "Aliquota ordinaria dell'imposta sul reddito delle società.",
	},
	coefficiente_redditivita_398: {
		label: 'Coefficiente di redditività (L. 398/1991)',
		unita: '%',
		descrizione:
			'Quota dei proventi commerciali che forma il reddito imponibile nel regime forfetario. I costi effettivi non contano.',
	},
	soglia_compensi_sportivi: {
		label: 'Soglia di esenzione dei compensi sportivi',
		unita: '€',
		descrizione:
			'Fino a questo importo annuo i compensi ai collaboratori sportivi non formano reddito. È cumulata fra tutti gli enti per cui la persona collabora.',
	},
	aliquota_ritenuta_acconto: {
		label: "Aliquota della ritenuta d'acconto",
		unita: '%',
		descrizione:
			'Quota del compenso a un professionista che non gli viene pagata ma versata all\'erario per suo conto.',
	},
};

export const NOMI_PARAMETRI = Object.keys(PARAMETRI);

/**
 * Il valore di un parametro alla data indicata.
 *
 * @param {Array} righe righe di `parametri_fiscali`, con `chiave`, `valore`, `valido_dal`
 * @param {string} chiave
 * @param {string} data data di riferimento (YYYY-MM-DD); di norma la data di competenza
 * @returns {{valore:number, validoDal:string, note:string}|null}
 */
export function parametroAllaData(righe, chiave, data) {
	const giorno = String(data ?? '').slice(0, 10);
	const candidate = (righe ?? [])
		.filter((r) => r.chiave === chiave)
		.filter((r) => !giorno || String(r.valido_dal).slice(0, 10) <= giorno)
		// Fra più valori in vigore vale il più recente entro la data.
		.sort((a, b) => String(b.valido_dal).localeCompare(String(a.valido_dal)));

	const scelto = candidate[0];
	if (!scelto) return null;
	return {
		valore: Number(scelto.valore),
		validoDal: String(scelto.valido_dal).slice(0, 10),
		note: scelto.note ?? null,
	};
}

/**
 * Come `parametroAllaData`, ma restituisce il solo numero e solleva se non c'è.
 *
 * Un calcolo fiscale con un valore inventato è peggio di un calcolo che non parte: il primo
 * produce un numero plausibile che nessuno rimette in discussione.
 */
export function valoreAllaData(righe, chiave, data) {
	const trovato = parametroAllaData(righe, chiave, data);
	if (!trovato) {
		const label = PARAMETRI[chiave]?.label ?? chiave;
		throw new Error(
			`Non è noto il valore di "${label}" alla data ${String(data).slice(0, 10)}. ` +
			'Aggiungilo fra i parametri fiscali indicando da quando vale.',
		);
	}
	return trovato.valore;
}

/** Tutti i valori in vigore a una data, come oggetto chiave → numero. */
export function parametriAllaData(righe, data) {
	const out = {};
	for (const chiave of NOMI_PARAMETRI) {
		const trovato = parametroAllaData(righe, chiave, data);
		if (trovato) out[chiave] = trovato.valore;
	}
	return out;
}

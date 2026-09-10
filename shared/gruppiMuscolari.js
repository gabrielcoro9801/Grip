// Il catalogo dei gruppi muscolari.
//
// Vive in shared/ come i permessi, e per lo stesso motivo: il server valida su questo
// elenco e l'interfaccia ci costruisce i menu. Se ognuno avesse la sua copia, un gruppo
// aggiunto da una parte sarebbe rifiutato dall'altra.
//
// Il `codice` è quello che finisce in banca dati e non va più cambiato: rinominandolo si
// staccherebbero gli esercizi già catalogati dal loro gruppo. L'etichetta invece è solo
// quello che si legge a schermo, e si può correggere quando serve.

export const ZONE = {
	superiore: "Parte superiore",
	inferiore: "Parte inferiore",
	altro: "Altro",
};

export const GRUPPI_MUSCOLARI = [
	{ codice: "addominali", etichetta: "Addominali", zona: "superiore" },
	{ codice: "avambracci", etichetta: "Avambracci", zona: "superiore" },
	{ codice: "bicipiti", etichetta: "Bicipiti", zona: "superiore" },
	{ codice: "collo", etichetta: "Collo", zona: "superiore" },
	{ codice: "dorsali", etichetta: "Dorsali", zona: "superiore" },
	{ codice: "schiena_bassa", etichetta: "Parte bassa della schiena", zona: "superiore" },
	{ codice: "schiena_alta", etichetta: "Parte superiore della schiena", zona: "superiore" },
	{ codice: "petto", etichetta: "Petto", zona: "superiore" },
	{ codice: "spalle", etichetta: "Spalle", zona: "superiore" },
	{ codice: "trapezi", etichetta: "Trapezi", zona: "superiore" },
	{ codice: "tricipiti", etichetta: "Tricipiti", zona: "superiore" },

	{ codice: "abduttori", etichetta: "Abduttori", zona: "inferiore" },
	{ codice: "adduttori", etichetta: "Adduttori", zona: "inferiore" },
	{ codice: "femorali", etichetta: "Femorali", zona: "inferiore" },
	{ codice: "glutei", etichetta: "Glutei", zona: "inferiore" },
	{ codice: "polpacci", etichetta: "Polpacci", zona: "inferiore" },
	{ codice: "quadricipiti", etichetta: "Quadricipiti", zona: "inferiore" },

	{ codice: "cardio", etichetta: "Cardio", zona: "altro" },
	{ codice: "corpo_intero", etichetta: "Corpo intero", zona: "altro" },
	{ codice: "altro", etichetta: "Altro", zona: "altro" },
];

const PER_CODICE = new Map(GRUPPI_MUSCOLARI.map((g) => [g.codice, g]));

export const CODICI_GRUPPI = GRUPPI_MUSCOLARI.map((g) => g.codice);

export function gruppoEsiste(codice) {
	return PER_CODICE.has(codice);
}

/**
 * Come si legge un gruppo a schermo.
 *
 * Un codice non riconosciuto viene restituito così com'è invece di sparire: se una riga
 * vecchia è rimasta indietro rispetto al catalogo, è meglio vederla che vedere un vuoto
 * senza sapere perché.
 */
export function etichettaGruppo(codice) {
	if (!codice) return "";
	return PER_CODICE.get(codice)?.etichetta ?? codice;
}

/** I gruppi divisi per zona, nell'ordine in cui vanno mostrati. */
export function gruppiPerZona() {
	return Object.keys(ZONE).map((zona) => ({
		zona,
		etichetta: ZONE[zona],
		gruppi: GRUPPI_MUSCOLARI.filter((g) => g.zona === zona),
	}));
}

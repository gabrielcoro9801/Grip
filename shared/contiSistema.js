/**
 * I conti che il motore contabile deve saper trovare da sé.
 *
 * Il problema che questo modulo risolve: il codice cercava i conti per numero — `"2.1"` per
 * la cassa, `"4.1"` per i debiti verso fornitori — in una trentina di punti. Ma il piano dei
 * conti appartiene all'associazione e al suo commercialista, che la numerazione la vogliono
 * loro. Finché il motore dipende dal numero, il numero non si può cambiare: infatti
 * nell'interfaccia quei conti erano bloccati, senza matita né cestino.
 *
 * Qui il legame passa da un **ruolo**: il motore non chiede più "il conto 4.1" ma "il conto
 * che fa da debiti verso fornitori". Il numero torna a essere un'etichetta libera, e
 * rinumerare un conto non rompe niente — le scritture puntano all'identificativo, che non
 * cambia mai.
 */

/**
 * Catalogo dei ruoli. La descrizione non è documentazione interna: compare
 * nell'interfaccia dove si assegna il ruolo a un conto, ed è lì che si capisce se
 * l'assegnazione è quella giusta.
 */
export const RUOLI_SISTEMA = {
	cassa: {
		label: 'Cassa',
		descrizione: 'Il denaro contante. Movimentato da ogni incasso o pagamento per cassa.',
		tipoAtteso: 'attivo',
	},
	banca: {
		label: 'Banca c/c',
		descrizione: 'Il conto corrente. Movimentato da ogni incasso o pagamento tramite banca.',
		tipoAtteso: 'attivo',
	},
	iva_debito: {
		label: 'IVA a debito',
		descrizione: "L'IVA incassata dai clienti e dovuta all'erario.",
		tipoAtteso: 'passivo',
	},
	debiti_fornitori: {
		label: 'Debiti v/fornitori',
		descrizione: 'Quanto si deve ai fornitori per forniture già ricevute e non ancora pagate.',
		tipoAtteso: 'passivo',
	},
	debiti_banche: {
		label: 'Debiti v/banche',
		descrizione: 'Il capitale residuo dei finanziamenti. Si riduce a ogni rata pagata.',
		tipoAtteso: 'passivo',
	},
	interessi_passivi: {
		label: 'Interessi passivi',
		descrizione: 'La quota interessi delle rate di finanziamento.',
		tipoAtteso: 'costo',
	},
	erario_ritenute_autonomi: {
		label: 'Erario c/ritenute lavoro autonomo',
		descrizione: "La ritenuta d'acconto trattenuta ai professionisti e da versare con F24.",
		tipoAtteso: 'passivo',
	},
	utili_a_nuovo: {
		label: 'Utili/perdite a nuovo',
		descrizione: "Dove confluisce il risultato dell'esercizio alla chiusura.",
		tipoAtteso: 'patrimonio_netto',
	},
	plusvalenze: {
		label: 'Plusvalenze da cessione',
		descrizione: 'Il guadagno quando un bene viene venduto sopra il suo valore residuo.',
		tipoAtteso: 'ricavo',
	},
	minusvalenze: {
		label: 'Minusvalenze da cessione',
		descrizione: 'La perdita quando un bene viene venduto sotto il suo valore residuo.',
		tipoAtteso: 'costo',
	},

	// --- Cedolino. Sono otto conti distinti perché il costo del personale non è una voce
	// sola: parte va al dipendente, parte all'erario, parte agli enti, parte resta
	// accantonata in azienda.
	salari: {
		label: 'Salari e stipendi',
		descrizione: 'La retribuzione lorda, che è il costo prima di ogni trattenuta.',
		tipoAtteso: 'costo',
	},
	oneri_sociali: {
		label: 'Oneri sociali',
		descrizione: "I contributi a carico dell'ente, che non compaiono in busta paga ma sono un costo.",
		tipoAtteso: 'costo',
	},
	accantonamento_tfr: {
		label: 'Accantonamento TFR',
		descrizione: 'La quota di trattamento di fine rapporto maturata nel periodo.',
		tipoAtteso: 'costo',
	},
	dipendenti_retribuzioni: {
		label: 'Dipendenti c/retribuzioni',
		descrizione: 'Il netto da pagare al dipendente, finché non viene effettivamente versato.',
		tipoAtteso: 'passivo',
	},
	erario_ritenute_dipendenti: {
		label: 'Erario c/ritenute dipendenti',
		descrizione: "L'IRPEF trattenuta in busta paga e da versare con F24.",
		tipoAtteso: 'passivo',
	},
	inps: {
		label: 'INPS c/contributi',
		descrizione: 'I contributi previdenziali dovuti, sia quota dipendente sia quota ente.',
		tipoAtteso: 'passivo',
	},
	fondo_tfr: {
		label: 'Fondo TFR',
		descrizione: 'Il TFR accantonato e non ancora liquidato: un debito verso il dipendente.',
		tipoAtteso: 'passivo',
	},
	terzi_trattenute: {
		label: 'Terzi c/trattenute',
		descrizione: 'Trattenute destinate a soggetti terzi, come una cessione del quinto.',
		tipoAtteso: 'passivo',
	},
};

export const NOMI_RUOLI = Object.keys(RUOLI_SISTEMA);

/**
 * Corrispondenza fra i codici del piano dei conti predefinito e i ruoli.
 *
 * Serve in due momenti e in nessun altro: quando si semina un piano dei conti nuovo, e
 * nella migrazione che assegna i ruoli ai piani già esistenti. Da lì in poi il legame vive
 * in banca dati, e il codice può cambiare liberamente.
 */
export const RUOLO_PER_CODICE_PREDEFINITO = {
	'2.1': 'cassa',
	'2.2': 'banca',
	'4.1': 'debiti_fornitori',
	'4.2': 'debiti_banche',
	'4.3': 'iva_debito',
	'4.4': 'dipendenti_retribuzioni',
	'4.5': 'erario_ritenute_dipendenti',
	'4.6': 'inps',
	'4.7': 'fondo_tfr',
	'4.9': 'terzi_trattenute',
	'4.10': 'erario_ritenute_autonomi',
	'5.2': 'utili_a_nuovo',
	'6.7': 'plusvalenze',
	'7.5': 'interessi_passivi',
	'7.6': 'salari',
	'7.9': 'minusvalenze',
	'7.10': 'oneri_sociali',
	'7.11': 'accantonamento_tfr',
};

/**
 * Errore sollevato quando un ruolo non ha un conto assegnato.
 *
 * È una classe a sé perché va distinto da un errore qualsiasi: significa che il piano dei
 * conti è incompleto, e il messaggio deve dire *quale* ruolo manca — non "impossibile
 * registrare".
 */
export class ContoDiSistemaMancante extends Error {
	constructor(ruolo) {
		const descrizione = RUOLI_SISTEMA[ruolo];
		super(
			descrizione
				? `Nessun conto è assegnato al ruolo "${descrizione.label}". Assegnalo dal piano dei conti prima di registrare.`
				: `Ruolo di sistema sconosciuto: ${ruolo}`,
		);
		this.name = 'ContoDiSistemaMancante';
		this.ruolo = ruolo;
	}
}

/**
 * Il conto che ricopre un ruolo, fra quelli dell'organizzazione.
 * Solleva se non c'è: una scrittura senza il conto giusto non va costruita a metà.
 */
export function contoPerRuolo(conti, ruolo) {
	const conto = trovaContoPerRuolo(conti, ruolo);
	if (!conto) throw new ContoDiSistemaMancante(ruolo);
	return conto;
}

/** Come `contoPerRuolo` ma restituisce null invece di sollevare: per chi sta solo guardando. */
export function trovaContoPerRuolo(conti, ruolo) {
	return (conti ?? []).find((c) => c.ruolo_sistema === ruolo) ?? null;
}

/**
 * I ruoli senza un conto assegnato.
 * L'interfaccia lo usa per avvisare *prima* che qualcuno provi a registrare: un piano dei
 * conti incompleto si scopre altrimenti al primo cedolino, a fine mese.
 */
export function ruoliScoperti(conti) {
	return NOMI_RUOLI.filter((ruolo) => !trovaContoPerRuolo(conti, ruolo));
}

/**
 * Segnala i conti a cui è stato assegnato un ruolo che non si accorda con il loro tipo —
 * per esempio la cassa messa su un conto di costo. Non è un blocco: il piano dei conti di
 * un ente può avere classificazioni legittime che qui non prevediamo. È un avviso, perché
 * un errore di questo genere produce un bilancio sbagliato senza dare errori.
 */
export function ruoliIncoerenti(conti) {
	return (conti ?? [])
		.filter((c) => c.ruolo_sistema && RUOLI_SISTEMA[c.ruolo_sistema])
		.filter((c) => c.tipo_conto && c.tipo_conto !== RUOLI_SISTEMA[c.ruolo_sistema].tipoAtteso)
		.map((c) => ({
			conto: c,
			ruolo: c.ruolo_sistema,
			tipoAtteso: RUOLI_SISTEMA[c.ruolo_sistema].tipoAtteso,
		}));
}

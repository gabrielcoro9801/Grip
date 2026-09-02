/**
 * Natura fiscale di una registrazione: a quale attività dell'ente si riferisce, agli occhi
 * del fisco.
 *
 * Un'ASD/SSD che fa anche attività commerciale deve poter separare, conto per conto, cosa
 * appartiene all'una e cosa all'altra — è la base su cui si calcolano IRES e la eventuale
 * contabilità separata. "Promiscua" copre ciò che serve a entrambe (e va ripartito con un
 * criterio, non sommato d'ufficio a una delle due) e "plusvalenza_patrimoniale" copre la
 * vendita di beni strumentali, che segue regole proprie.
 *
 * Non ogni scrittura ha bisogno di dichiararla: le scritture tecniche (chiusura esercizio,
 * saldi, rate di prestito, compensi PT) non movimentano un conto di ricavo o di costo, quindi
 * non c'è nulla da attribuire. Le altre la richiedono solo se toccano davvero un conto
 * economico — una scrittura che muove solo cassa e un conto patrimoniale, per esempio, non
 * ne ha bisogno.
 *
 * Questa è logica pura, senza I/O: entrano tipo di origine, righe e piano dei conti, esce un
 * booleano o un messaggio d'errore. Il chiamante (una rotta HTTP) decide cosa farne.
 */
import { TIPI_CONTO } from './tipiConto.js';

/** I quattro valori ammessi, nell'ordine in cui compaiono nel CHECK del database. */
export const NATURE_FISCALI = ['istituzionale', 'commerciale', 'promiscua', 'plusvalenza_patrimoniale'];

/**
 * Origini tecniche che non richiedono mai una natura fiscale, anche quando le loro righe
 * toccano un conto di ricavo o di costo (la chiusura d'esercizio, per definizione, li tocca
 * tutti). Questo elenco ha la priorità su qualunque altro criterio.
 */
export const ORIGINI_SENZA_NATURA_FISCALE = new Set(['chiusura_esercizio', 'saldo', 'rata_prestito', 'compenso_pt']);

// I conti su cui la natura fiscale ha un senso da attribuire: quelli che finiscono a conto
// economico. Il nome dei due tipi si prende da shared/tipiConto.js invece di riscriverlo,
// così un domani in cui quel vocabolario cambiasse le chiavi il collegamento non si
// romperebbe in silenzio.
const TIPI_CONTO_ECONOMICI = ['ricavo', 'costo'].filter((tipo) => TIPI_CONTO[tipo]);

/** Un conto di ricavo o di costo. */
function eContoEconomico(tipoConto) {
	return TIPI_CONTO_ECONOMICI.includes(tipoConto);
}

/**
 * Se questa registrazione deve indicare una natura fiscale.
 *
 * @param {Object} p
 * @param {string} p.tipoOrigine
 * @param {Array<{conto_id: string}>} p.righe
 * @param {Object<string, {tipo_conto: string}>} p.contiPerId piano dei conti indicizzato per id
 * @returns {boolean}
 */
export function naturaFiscaleRichiesta({ tipoOrigine, righe, contiPerId }) {
	if (ORIGINI_SENZA_NATURA_FISCALE.has(tipoOrigine)) return false;
	return (righe ?? []).some((r) => {
		const conto = contiPerId?.[r.conto_id];
		return conto && eContoEconomico(conto.tipo_conto);
	});
}

/**
 * Il messaggio d'errore da mostrare, o null se la natura fiscale va bene così com'è.
 *
 * Due controlli distinti: un valore fuori dai quattro ammessi è sempre un errore, a
 * prescindere da cosa movimenta la scrittura — non deve arrivare al database a scoprirlo
 * lui col CHECK. L'assenza del valore è un errore solo quando la registrazione tocca un
 * conto economico.
 */
export function erroreNaturaFiscale({ tipoOrigine, naturaFiscale, righe, contiPerId }) {
	if (naturaFiscale != null && !NATURE_FISCALI.includes(naturaFiscale)) {
		return `"${naturaFiscale}" non è una natura fiscale valida: dev'essere una fra ${NATURE_FISCALI.join(', ')}.`;
	}
	if (!naturaFiscale && naturaFiscaleRichiesta({ tipoOrigine, righe, contiPerId })) {
		return 'Indicare la natura fiscale: la registrazione movimenta un conto di ricavo o di costo.';
	}
	return null;
}

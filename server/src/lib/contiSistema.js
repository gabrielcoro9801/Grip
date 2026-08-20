// Risoluzione dei conti di sistema lato server.
//
// Il catalogo dei ruoli è in shared/contiSistema.js, condiviso con l'interfaccia. Qui c'è
// solo la parte che serve al server: leggere il piano dei conti di un'organizzazione e
// tradurre i ruoli in identificativi.
//
// Il messaggio d'errore è la ragione per cui questo modulo esiste invece di una `find()`
// sparsa: quando un conto manca, chi legge deve sapere *quale compito* è scoperto — non
// che "manca il conto 4.6", che non dice niente a chi ha rinumerato il piano a modo suo.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chartOfAccounts } from '../db/schema/index.js';
import { RUOLI_SISTEMA } from '../../../shared/contiSistema.js';

/** Il piano dei conti dell'organizzazione, in forma snake_case come lo usa shared/. */
export async function caricaConti(organizationId) {
	const righe = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.organizationId, organizationId));
	return righe.map((c) => ({ ...c, ruolo_sistema: c.ruoloSistema, tipo_conto: c.tipoConto }));
}

/**
 * Mappa ruolo → conto per i ruoli richiesti.
 * Se qualcuno manca restituisce l'elenco dei mancanti invece di sollevare: chi chiama è una
 * rotta HTTP e deve poter rispondere 400 con un messaggio utile, non 500.
 *
 * @returns {{conti: Object<string, Object>, mancanti: string[], errore: string|null}}
 */
export function risolviRuoli(pianoDeiConti, ruoliRichiesti) {
	const conti = {};
    const mancanti = [];

	for (const ruolo of ruoliRichiesti) {
		const conto = pianoDeiConti.find((c) => c.ruolo_sistema === ruolo);
		if (conto) conti[ruolo] = conto;
		else mancanti.push(ruolo);
	}

	const errore = mancanti.length
		? `Nel piano dei conti mancano dei conti con un compito assegnato: ${mancanti
			.map((r) => RUOLI_SISTEMA[r]?.label ?? r)
			.join(', ')}. Assegnali dal piano dei conti prima di procedere.`
		: null;

	return { conti, mancanti, errore };
}

/** Scorciatoia: carica il piano dei conti e risolve i ruoli in un colpo solo. */
export async function contiPerRuoli(organizationId, ruoliRichiesti) {
	const piano = await caricaConti(organizationId);
	return { piano, ...risolviRuoli(piano, ruoliRichiesti) };
}

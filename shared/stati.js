// La regola comune a tipi di abbonamento e sale: tre stati, e "annullato" è per sempre.
//
// Era scritta due volte, quasi uguale, in `abbonamenti.js` e in `sale.js`. Quello che cambia
// fra le due è solo come si chiama la cosa nei messaggi; la regola resta una.

/**
 * Perché qualcosa con gli stati attivo / sospeso / annullato non può passare a `nuovo`, o null.
 *
 * @param {object} messaggi
 * @param {(v: string) => boolean} messaggi.valido se `nuovo` è uno degli stati previsti
 * @param {string} messaggi.nonValido il rifiuto per uno stato che non esiste
 * @param {string} messaggi.definitivo il rifiuto per chi prova a riattivare un annullato
 */
export function motivoCambioStato(attuale, nuovo, { valido, nonValido, definitivo }) {
	if (!valido(nuovo)) return nonValido;
	if (attuale === 'annullato' && nuovo !== 'annullato') return definitivo;
	return null;
}

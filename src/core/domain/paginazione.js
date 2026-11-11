// La paginazione degli elenchi: quante pagine, quale si vede, e «da–a di tot».
//
// Una pagina fuori misura (oltre l'ultima, zero, non un numero) diventa la più vicina che esiste:
// un indirizzo vecchio o un filtro che ha ristretto l'elenco non lasciano una pagina vuota.

/**
 * I numeri della pagina, dal solo totale: serve anche quando l'elenco lo conta il server.
 * @returns {{ pagina: number, pagine: number, da: number, a: number, totale: number }}
 */
export function numeriPagina(totale, pagina, perPagina) {
	const tot = Math.max(0, Math.floor(Number(totale) || 0));
	const per = Math.max(1, Math.floor(Number(perPagina) || 1));
	const pagine = Math.max(1, Math.ceil(tot / per));
	const richiesta = Math.floor(Number(pagina));
	const p = Number.isFinite(richiesta) ? Math.min(Math.max(1, richiesta), pagine) : 1;
	return { pagina: p, pagine, totale: tot, da: tot ? (p - 1) * per + 1 : 0, a: Math.min(p * per, tot) };
}

/**
 * La pagina di un elenco: le sue righe e i numeri per il paginatore.
 * @template T
 * @param {T[]} elenco
 * @returns {{ righe: T[], pagina: number, pagine: number, da: number, a: number, totale: number }}
 */
export function paginaDi(elenco, pagina, perPagina) {
	const numeri = numeriPagina(elenco.length, pagina, perPagina);
	return { ...numeri, righe: numeri.totale ? elenco.slice(numeri.da - 1, numeri.a) : [] };
}

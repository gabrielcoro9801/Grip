// Ritenuta d'acconto sui pagamenti ai fornitori.
//
// La ritenuta è dovuta quando si paga un compenso a un professionista persona fisica:
// una quota dell'importo non va al professionista ma versata all'erario per suo conto.
// Non è dovuta verso le società, né verso chi applica il regime forfettario.
//
// Regola condivisa fra interfaccia e server perché la stessa domanda si pone in più punti
// (anagrafica fornitore, registrazione del pagamento, ciclo acquisti): duplicarla
// significherebbe poterla correggere in un posto e dimenticarla in un altro.

export const TIPI_SOGGETTO = {
	societa: { label: 'Società', descrizione: 'S.r.l., S.p.A., cooperativa, associazione' },
	professionista: { label: 'Professionista (persona fisica)', descrizione: 'Con partita IVA propria' },
	ditta_individuale: { label: 'Ditta individuale', descrizione: 'Impresa non professionale' },
	altro: { label: 'Altro', descrizione: 'Ente pubblico, soggetto estero, altro' },
};

// L'aliquota ordinaria non è più una costante: è un valore di legge, letto dai parametri
// fiscali per la data del pagamento. Resta comunque prevalente quella indicata sul singolo
// fornitore, perché alcune categorie hanno aliquote proprie.

/** La ritenuta è dovuta solo ai professionisti persona fisica fuori dal regime forfettario. */
export function ritenutaDovuta(fornitore) {
	if (!fornitore) return false;
	if (fornitore.tipo_soggetto !== 'professionista') return false;
	return !fornitore.regime_forfettario;
}

/**
 * Scompone un compenso lordo nelle sue due parti: quanto incassa il professionista e
 * quanto resta da versare all'erario. Il costo per l'associazione resta l'importo lordo:
 * la ritenuta non è uno sconto, è una parte del compenso trattenuta e girata altrove.
 */
export function calcolaRitenuta(fornitore, importoLordo, aliquotaOrdinaria) {
	if (!ritenutaDovuta(fornitore)) {
		return { ritenuta: 0, netto: importoLordo, aliquota: 0 };
	}
	const aliquota = Number(fornitore.aliquota_ritenuta) || Number(aliquotaOrdinaria);
	if (!Number.isFinite(aliquota) || aliquota <= 0) {
		throw new Error(
			"Non è nota l'aliquota della ritenuta d'acconto: indicala sul fornitore o fra i parametri fiscali.",
		);
	}
	const ritenuta = Math.round(importoLordo * aliquota) / 100;
	return { ritenuta, netto: importoLordo - ritenuta, aliquota };
}

/** Motivo per cui la ritenuta non si applica, da mostrare all'utente. */
export function motivoEsenzione(fornitore) {
	if (!fornitore?.tipo_soggetto) return 'Tipo di soggetto non indicato.';
	if (fornitore.regime_forfettario) return 'In regime forfettario: nessuna ritenuta.';
	if (fornitore.tipo_soggetto === 'societa') return 'Società: nessuna ritenuta.';
	if (fornitore.tipo_soggetto === 'ditta_individuale') return 'Ditta individuale: nessuna ritenuta sui corrispettivi d\'impresa.';
	return 'Nessuna ritenuta.';
}

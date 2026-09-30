import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts } from '../db/schema/index.js';

/**
 * Come si butta fuori qualcuno che è già dentro.
 *
 * Un token firmato vale finché non scade, e il server non ha modo di fermarlo: è la natura
 * dei token autoconsistenti. Finché le sessioni duravano dodici ore il problema era
 * contenuto — un telefono rubato restava dentro fino a sera. Con le sessioni del portale a
 * trenta giorni non lo è più, e "cambia la password" non basterebbe: la vecchia sessione
 * continuerebbe a funzionare per un mese.
 *
 * La soluzione più semplice che funziona davvero è un numero sull'account, copiato dentro
 * al token al momento dell'accesso. Alzarlo di uno rende invalide, all'istante, tutte le
 * sessioni di quell'account — su tutti i dispositivi. Non serve tenere un elenco dei token
 * emessi, che andrebbe conservato, consultato a ogni richiesta e ripulito.
 *
 * Il costo è una lettura per richiesta autenticata. Su un gestionale di palestra è
 * irrilevante, e comprarsi la revocabilità a quel prezzo è un affare — anche perché i token
 * dei soci non li rilegge nessun altro: `/api/auth/me` li rileggeva già.
 */

/**
 * Lo stato della sessione di chi presenta il token.
 *
 * @returns {{ revocata: boolean, passwordDaCambiare: boolean }}
 */
export async function statoSessione(claims) {
	if (!claims?.sub) return { revocata: true, passwordDaCambiare: false };

	const [account] = await db
		.select({
			versione: staffAccounts.tokenVersion,
			attivo: staffAccounts.attivo,
			ruolo: staffAccounts.ruolo,
			passwordDaCambiare: staffAccounts.passwordDaCambiare,
		})
		.from(staffAccounts)
		.where(eq(staffAccounts.id, claims.sub))
		.limit(1);

	// Account sparito o disattivato: la sessione non vale più, senza aspettare la scadenza.
	if (!account || !account.attivo) return { revocata: true, passwordDaCambiare: false };

	// Il ruolo sta nel token e le rotte lo leggono da lì: un utente declassato da
	// amministratore a reception conservava i poteri di prima fino alla scadenza, dodici ore.
	// Se il ruolo è cambiato, la sessione non vale più e si rientra con quello nuovo.
	if (claims.ruolo !== account.ruolo) return { revocata: true, passwordDaCambiare: false };

	// I token emessi prima che questa colonna esistesse non hanno `tv`. Trattarli come
	// validi è voluto: il rilascio non deve buttare fuori chi è già connesso. Alla prossima
	// revoca o al prossimo accesso il numero c'è, e da lì in poi il controllo è pieno.
	const revocata = claims.tv !== undefined && claims.tv !== account.versione;
	return { revocata, passwordDaCambiare: account.passwordDaCambiare };
}

/** Vera se il token presentato appartiene a una sessione che è stata invalidata. */
export async function sessioneRevocata(claims) {
	return (await statoSessione(claims)).revocata;
}

/**
 * Invalida tutte le sessioni di un account.
 *
 * Da chiamare quando la password cambia — chi conosceva la vecchia non deve restare dentro —
 * e ovunque si voglia dire "esci da tutti i dispositivi".
 */
export async function revocaSessioniDi(accountId) {
	await db
		.update(staffAccounts)
		.set({ tokenVersion: sql`${staffAccounts.tokenVersion} + 1` })
		.where(eq(staffAccounts.id, accountId));
}

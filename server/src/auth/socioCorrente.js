import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts } from '../db/schema/index.js';

/**
 * Qual è il socio dietro a un account.
 *
 * **Si rilegge dal database e non dal token.** È la regola più importante di tutto il
 * confine del portale, e la ragione è semplice: il token è firmato all'accesso e vale ore.
 * Se il collegamento fra account e anagrafica venisse dal token, toglierlo non avrebbe
 * effetto finché quel token non scade — cioè la revoca sarebbe una formalità. Rileggendolo,
 * il primo tentativo dopo la revoca riceve 403.
 *
 * Questa lettura esisteva in tre copie identiche — `routes/entities.js`, `routes/qr.js`,
 * `routes/prenotazioni.js` — e il guaio delle tre copie non è la ripetizione: è che il
 * giorno in cui una delle tre cambia, le altre due restano indietro e nessuno se ne accorge,
 * perché continuano a funzionare. Un confine di sicurezza è esattamente il posto in cui non
 * si vuole quel rischio.
 *
 * @returns {Promise<string|null>} l'id del socio, oppure null se l'account non è collegato.
 */
export async function socioDiAccount(accountId) {
	const [account] = await db
		.select({ memberId: staffAccounts.linkedMemberId })
		.from(staffAccounts)
		.where(eq(staffAccounts.id, accountId))
		.limit(1);
	return account?.memberId ?? null;
}

/**
 * Come sopra, ma risponde da sé se qualcosa non torna.
 *
 * Restituisce l'id del socio, oppure `null` **dopo aver già inviato la risposta di errore**:
 * chi la chiama deve solo fermarsi.
 *
 *   const idSocio = await esigiSocio(request, reply);
 *   if (!idSocio) return;
 */
export async function esigiSocio(request, reply) {
	const idSocio = await socioDiAccount(request.utente?.sub ?? request.user?.sub);
	if (!idSocio) {
		reply.code(403).send({ error: 'Account non collegato a un socio.' });
		return null;
	}
	return idSocio;
}

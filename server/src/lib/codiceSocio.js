// Il codice socio: sei cifre, progressivo, mai due volte lo stesso.
//
// Stava dentro la trasformazione in scrittura di `Member` in entities/hooks.js. Ora un socio
// nasce anche convertendo un lead (routes/lead.js), e ricopiare lì la query avrebbe
// significato due numerazioni che un giorno partono da massimi diversi.
//
// Dalla migrazione 0029 il codice è obbligatorio e univoco (la chiave con cui la palestra
// riconosce un socio, accanto all'id tecnico): nessuna strada può più creare un socio senza.
import { asc, eq, sql } from 'drizzle-orm';
import { members, numberingCounters, organizations } from '../db/schema/index.js';
import { nextNumber } from './numbering.js';

/**
 * L'ente che tiene il contatore dei codici socio.
 *
 * I soci non appartengono a un ente nel database, ma il contatore sì. Prima il modulo mandava
 * `organization_id` solo se l'aveva già caricato, e la trasformazione di un lead prendeva
 * "un ente qualsiasi": con due enti, due contatori, e un socio poteva nascere senza codice.
 * Si usa l'ente che il contatore ce l'ha già; se nessuno, il primo creato.
 */
export async function enteDellaNumerazione(tx) {
	const [conContatore] = await tx
		.select({ id: numberingCounters.organizationId })
		.from(numberingCounters)
		.where(eq(numberingCounters.scope, 'codice_socio'))
		.limit(1);
	if (conContatore) return conContatore.id;
	const [primo] = await tx.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdDate)).limit(1);
	if (!primo) throw new Error('Nessun ente configurato: impossibile assegnare il codice socio.');
	return primo.id;
}

/**
 * @param {Object} tx transazione Drizzle, o il db
 * @returns {Promise<string>} es. "000042"
 */
export async function assegnaCodiceSocio(tx) {
	const numero = await nextNumber(
		tx, await enteDellaNumerazione(tx), 'codice_socio',
		sql`SELECT MAX(CAST(NULLIF(regexp_replace(codice_socio, '\\D', '', 'g'), '') AS INTEGER)) FROM ${members}`,
	);
	return String(numero).padStart(6, '0');
}

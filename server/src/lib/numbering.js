// Assegnazione dei numeri progressivi.
//
// Ogni numerazione dell'applicazione — protocolli, fatture, ricevute, codici socio — deve
// essere progressiva e senza duplicati. Calcolarla leggendo il massimo esistente e
// sommando uno sembra funzionare finché a usare il sistema è una persona sola: due
// operazioni simultanee leggono lo stesso massimo e ottengono lo stesso numero.
//
// Qui il numero viene dal contatore, incrementato con un UPDATE che blocca la riga. Il
// primo numero per un ambito riparte dal massimo già presente, così i contatori restano
// coerenti con i dati creati prima della loro introduzione.
import { sql } from 'drizzle-orm';
import { numberingCounters } from '../db/schema/index.js';

/**
 * @param {Object} tx transazione Drizzle (o il db, se non serve atomicità con altro)
 * @param {string} organizationId
 * @param {string} scope ambito della numerazione: 'journal_entry', 'invoice_2026', …
 * @param {import('drizzle-orm').SQL} valoreIniziale query che calcola il massimo esistente
 */
export async function nextNumber(tx, organizationId, scope, valoreIniziale) {
	const result = await tx.execute(sql`
		INSERT INTO ${numberingCounters} (organization_id, scope, value)
		VALUES (${organizationId}, ${scope}, COALESCE((${valoreIniziale}), 0) + 1)
		ON CONFLICT (organization_id, scope)
		DO UPDATE SET value = ${numberingCounters}.value + 1
		RETURNING value
	`);
	return result.rows[0].value;
}

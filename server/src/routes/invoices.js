// Emissione fatture verso clienti terzi.
//
// Il numero di fattura è assegnato dal server, dentro la stessa transazione che crea il
// documento. Su una fattura questo conta più che altrove: la numerazione dev'essere
// progressiva e senza salti né duplicati per esercizio, ed è uno dei primi elementi che
// un controllo verifica. Calcolarla leggendo il massimo esistente, come si faceva per le
// ricevute, con due emissioni simultanee produrrebbe due fatture con lo stesso numero.
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoices, numberingCounters } from '../db/schema/index.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { registerPgErrorHandler } from './errorHandler.js';

// La numerazione delle fatture riparte da 1 ogni esercizio, quindi il contatore è
// per anno oltre che per organizzazione.
const scopeFatture = (anno) => `invoice_${anno}`;

async function nextInvoiceNumber(tx, organizationId, esercizio) {
	const result = await tx.execute(sql`
		INSERT INTO ${numberingCounters} (organization_id, scope, value)
		VALUES (
			${organizationId},
			${scopeFatture(esercizio)},
			COALESCE((
				SELECT MAX(numero_progressivo) FROM ${invoices}
				WHERE organization_id = ${organizationId} AND esercizio_fiscale = ${esercizio}
			), 0) + 1
		)
		ON CONFLICT (organization_id, scope)
		DO UPDATE SET value = ${numberingCounters}.value + 1
		RETURNING value
	`);
	return result.rows[0].value;
}

export default async function invoiceRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (user.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
	});

	// POST /api/invoices — crea la fattura assegnandole il numero progressivo.
	fastify.post('/api/invoices', async (request, reply) => {
		const body = request.body ?? {};
		if (!body.organization_id) return reply.code(400).send({ error: 'organization_id è obbligatorio.' });
		if (!body.cliente_id) return reply.code(400).send({ error: 'Indicare il cliente intestatario.' });
		if (!body.data_emissione) return reply.code(400).send({ error: 'Indicare la data di emissione.' });

		const esercizio = Number(body.esercizio_fiscale) || new Date(body.data_emissione).getFullYear();

		const creata = await db.transaction(async (tx) => {
			// Un numero inviato dal client verrebbe da una lettura ormai obsoleta.
			const { numero_progressivo: _ignorato, ...campi } = body;
			const numero = await nextInvoiceNumber(tx, body.organization_id, esercizio);

			const [row] = await tx
				.insert(invoices)
				.values({
					...translateToJs(invoices, campi),
					numeroProgressivo: numero,
					esercizioFiscale: esercizio,
				})
				.returning();

			return row;
		});

		reply.code(201);
		return translateToSnakeCase(invoices, creata);
	});
}

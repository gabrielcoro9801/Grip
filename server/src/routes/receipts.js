// Emissione delle ricevute.
//
// Il numero è assegnato dal server dentro una transazione, come per le fatture: una
// ricevuta è un documento fiscale, e due ricevute con lo stesso numero sono un problema
// che si scopre solo davanti a un controllo.
//
// Ci sono due momenti in cui una ricevuta prende il numero, e per questo due endpoint:
// quando nasce già emessa (incasso saldato subito) e quando una bozza viene emessa perché
// il credito è stato incassato.
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { receipts } from '../db/schema/index.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { nextNumber } from '../lib/numbering.js';
import { registerPgErrorHandler } from './errorHandler.js';

// La numerazione riparte da 1 a ogni esercizio.
const scopeRicevute = (anno) => `receipt_${anno}`;

const massimoEsistente = (organizationId, esercizio) => sql`
	SELECT MAX(numero_progressivo) FROM ${receipts}
	WHERE organization_id = ${organizationId} AND esercizio_fiscale = ${esercizio}
`;

export default async function receiptRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		if (user.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
	});

	// POST /api/receipts — ricevuta già emessa, con numero assegnato.
	fastify.post('/api/receipts', async (request, reply) => {
		const body = request.body ?? {};
		if (!body.organization_id) return reply.code(400).send({ error: 'organization_id è obbligatorio.' });

		const esercizio = Number(body.esercizio_fiscale)
			|| new Date(body.data_emissione || Date.now()).getFullYear();

		const creata = await db.transaction(async (tx) => {
			// Un numero inviato dal client verrebbe da una lettura ormai superata.
			const { numero_progressivo: _ignorato, ...campi } = body;
			const numero = await nextNumber(
				tx, body.organization_id, scopeRicevute(esercizio),
				massimoEsistente(body.organization_id, esercizio),
			);
			const [row] = await tx
				.insert(receipts)
				.values({
					...translateToJs(receipts, campi),
					numeroProgressivo: numero,
					esercizioFiscale: esercizio,
				})
				.returning();
			return row;
		});

		reply.code(201);
		return translateToSnakeCase(receipts, creata);
	});

	// PUT /api/receipts/:id/issue — assegna il numero a una bozza che viene emessa.
	fastify.put('/api/receipts/:id/issue', async (request, reply) => {
		const body = request.body ?? {};

		const [bozza] = await db.select().from(receipts).where(eq(receipts.id, request.params.id)).limit(1);
		if (!bozza) return reply.code(404).send({ error: 'Ricevuta non trovata.' });
		// Una ricevuta già emessa ha già consumato il suo numero: rinumerarla creerebbe un
		// salto nella sequenza e due documenti con numeri diversi per lo stesso incasso.
		if (bozza.numeroProgressivo) {
			return reply.code(400).send({ error: 'Questa ricevuta ha già un numero: è già stata emessa.' });
		}

		const esercizio = Number(body.esercizio_fiscale)
			|| Number(bozza.esercizioFiscale)
			|| new Date(body.data_emissione || bozza.dataEmissione || Date.now()).getFullYear();

		const emessa = await db.transaction(async (tx) => {
			const numero = await nextNumber(
				tx, bozza.organizationId, scopeRicevute(esercizio),
				massimoEsistente(bozza.organizationId, esercizio),
			);
			const { numero_progressivo: _ignorato, ...campi } = body;
			const [row] = await tx
				.update(receipts)
				.set({
					...translateToJs(receipts, campi),
					numeroProgressivo: numero,
					esercizioFiscale: esercizio,
					stato: 'emessa',
				})
				.where(eq(receipts.id, bozza.id))
				.returning();
			return row;
		});

		return translateToSnakeCase(receipts, emessa);
	});
}

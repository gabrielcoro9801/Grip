// Predisposizione della contabilità di un'organizzazione.
//
// Esiste come endpoint, e non solo dentro lo script di seed, perché serve anche quando
// l'organizzazione c'è già ma la sua contabilità no — è il caso di ogni installazione fatta
// prima che questo passaggio si spostasse lato server.
//
// È idempotente: chiamarlo due volte non duplica niente.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { organizations } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { bootstrapContabilita } from '../lib/bootstrapContabilita.js';
import { registerPgErrorHandler } from './errorHandler.js';

export default async function organizationRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		// Creare il piano dei conti di un ente non è un'operazione da area cliente, né da
		// chiunque passi di lì: prima la faceva il browser di chiunque fosse autenticato.
		if (user.ruolo !== 'admin') {
			return reply.code(403).send({ error: 'Solo un amministratore può predisporre la contabilità.' });
		}
	});

	// POST /api/organizations/:id/bootstrap-contabilita
	fastify.post('/api/organizations/:id/bootstrap-contabilita', async (request, reply) => {
		const [ente] = await db.select().from(organizations).where(eq(organizations.id, request.params.id)).limit(1);
		if (!ente) return reply.code(404).send({ error: 'Organizzazione non trovata.' });

		const esito = await bootstrapContabilita(ente.id);
		return {
			conti_creati: esito.contiCreati,
			causali_create: esito.causaliCreate,
			aliquota_iva_applicata: esito.aliquotaIva,
		};
	});
}

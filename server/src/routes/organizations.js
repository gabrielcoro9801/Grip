// Predisposizione dei ruoli di un'organizzazione.
//
// Esiste come endpoint, e non solo dentro lo script di seed, perché serve anche quando
// l'organizzazione c'è già ma i suoi ruoli no — è il caso di ogni installazione fatta
// prima che questo passaggio si spostasse lato server.
//
// È idempotente: chiamarlo due volte non duplica niente.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { organizations } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { bootstrapRuoli } from '../lib/ruoli.js';
import { registerPgErrorHandler } from './errorHandler.js';

export default async function organizationRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const user = getUserFromRequest(request);
		if (!user) return reply.code(401).send({ error: 'Non autenticato.' });
		// Creare i ruoli di un ente non è un'operazione da area cliente, né da chiunque
		// passi di lì: prima la faceva il browser di chiunque fosse autenticato.
		if (user.ruolo !== 'admin') {
			return reply.code(403).send({ error: 'Solo un amministratore può predisporre i ruoli.' });
		}
	});

	// POST /api/organizations/:id/bootstrap-ruoli
	fastify.post('/api/organizations/:id/bootstrap-ruoli', async (request, reply) => {
		const [ente] = await db.select().from(organizations).where(eq(organizations.id, request.params.id)).limit(1);
		if (!ente) return reply.code(404).send({ error: 'Organizzazione non trovata.' });

		return { ruoli_creati: await bootstrapRuoli(ente.id) };
	});
}

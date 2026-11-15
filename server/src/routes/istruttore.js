// Gli istruttori sono gli account con la spunta «Istruttore» (Utenti e ruoli). Questa rotta
// li elenca per scegliere chi tiene un corso: la aprono tutti gli utenti dello staff, come il
// catalogo dei corsi. Il socio li vede già nel corso, dal portale.
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { registerPgErrorHandler } from './errorHandler.js';

export default async function istruttoriRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (utente.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
		request.utente = utente;
	});

	/** GET /api/istruttori → { elenco: [{ id, full_name, attivo }] } */
	fastify.get('/api/istruttori', async () => {
		const righe = await db.select({ id: staffAccounts.id, full_name: staffAccounts.nome, attivo: staffAccounts.attivo })
			.from(staffAccounts)
			.where(eq(staffAccounts.istruttore, true))
			.orderBy(asc(staffAccounts.nome));
		return { elenco: righe };
	});
}

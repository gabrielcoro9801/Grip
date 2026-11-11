// Da fare: gli avvisi aperti, l'Archivio di quelli chiusi, e le chiusure a mano.
//
// Rinnova, Non rinnova e Carica documento non passano di qui: usano la vendita, l'archiviazione
// del socio e il caricamento di sempre, e l'allineamento successivo chiude l'avviso con l'esito
// giusto (lib/avvisi.js).
//
// Chi può: chi vede i soci legge, chi li modifica chiude e ripristina. Il socio mai.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { tipoAvviso } from '../../../shared/daFare.js';
import { situazioni } from '../lib/segnali.js';
import { allinea, leggi, chiudi, ripristina } from '../lib/avvisi.js';
import { registerPgErrorHandler } from './errorHandler.js';

const VISTE = ['aperti', 'archivio'];

export default async function avvisiRoutes(fastify) {
	// Un id che non è un uuid diventa un 400 leggibile, e gli errori di lib/avvisi.js (404, 400) passano così come sono.
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		const azione = request.method === 'GET' ? 'view' : 'edit';
		if (utente.ruolo === 'member' || !canAccess(utente.ruolo, 'crm_members', azione)) {
			return reply.code(403).send({ error: 'Non consentito.' });
		}
		request.utente = utente;
	});

	const autore = async (request) => {
		const [a] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		return { id: request.utente.sub, nome: a?.nome ?? '' };
	};

	/**
	 * GET /api/avvisi?vista=aperti|archivio&tipo=<tipo>
	 * → { oggi, soglie, conteggi: { in_scadenza, scaduto, frequenza, documento, compleanno }, avvisi, archiviati? }
	 *
	 * Prima di leggere allinea la tabella al motore. `conteggi`: gli aperti per tipo, i numeri
	 * della barra. In archivio le ultime 200 chiusure, e `archiviati`: i chiusi per tipo.
	 */
	fastify.get('/api/avvisi', async (request, reply) => {
		const { vista = 'aperti', tipo = null } = request.query ?? {};
		if (!VISTE.includes(vista)) return reply.code(400).send({ error: 'Vista non valida.' });
		if (tipo && !tipoAvviso(tipo)) return reply.code(400).send({ error: 'Tipo di avviso non valido.' });
		const { oggi, soglie, persone } = await situazioni();
		await allinea(db, persone, oggi, soglie);
		return { oggi, soglie, ...(await leggi({ vista, tipo, soglie })) };
	});

	/**
	 * POST /api/avvisi/:id/chiudi { esito } → { avviso }
	 * `esito`: nascosto, contattato (solo la frequenza), auguri_fatti (solo i compleanni).
	 */
	fastify.post('/api/avvisi/:id/chiudi', async (request) => {
		const esito = request.body?.esito;
		return { avviso: await chiudi(request.params.id, esito, await autore(request)) };
	});

	/** POST /api/avvisi/:id/ripristina → { avviso }: solo per un avviso nascosto. */
	fastify.post('/api/avvisi/:id/ripristina', async (request) => ({ avviso: await ripristina(request.params.id) }));
}

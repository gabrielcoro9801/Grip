// L'uso delle sale, per la pagina che le gestisce.
//
// Il cestino di ogni sala fa una cosa diversa a seconda di quanto è stata usata — elimina,
// annulla, o niente — e la pagina lo decideva sugli elenchi che aveva in memoria: le lezioni
// da tre mesi fa in avanti, prima addirittura le ultime cinquecento. Una sala con un passato
// fuori da quella finestra risultava mai usata, e la conferma prometteva un'eliminazione che il
// server poi rifiutava. Il conto lo fa il server sull'intero calendario (lib/sale.js).
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity } from '../auth/authorize.js';
import { usoDelleSale } from '../lib/sale.js';

export default async function saleRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (!canReadEntity(utente.ruolo, 'Room')) return reply.code(403).send({ error: 'Non consentito.' });
	});

	// GET /api/sale/uso → { [idSala]: { eventi, lezioni, occupata_da_qui } }
	fastify.get('/api/sale/uso', async () => {
		const uso = await usoDelleSale();
		return Object.fromEntries([...uso].map(([id, u]) => [id, { eventi: u.eventi, lezioni: u.lezioni, occupata_da_qui: u.occupataDaQui }]));
	});
}

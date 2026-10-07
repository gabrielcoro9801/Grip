// Le prenotazioni fisse viste dal gestionale: la reception le attiva per conto del socio, le
// vede nella sua scheda e le termina. Le regole stanno in lib/prenotazioniFisse.js; il socio passa
// dal portale (routes/member).
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity, canWriteEntity } from '../auth/authorize.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { creaFissa, terminaFissa, elencoFisse } from '../lib/prenotazioniFisse.js';

export default async function prenotazioniFisseRoutes(fastify) {
	registerPgErrorHandler(fastify);

	// Le stesse regole delle prenotazioni: le legge chi legge le prenotazioni, le cambia chi le
	// cambia. Il socio usa il portale.
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (utente.ruolo === 'member') return reply.code(403).send({ error: 'Le prenotazioni fisse si gestiscono dal portale.' });
		const permesso = request.method === 'GET' ? canReadEntity(utente.ruolo, 'Booking') : canWriteEntity(utente.ruolo, 'Booking');
		if (!permesso) return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
		request.utente = utente;
	});

	/** GET /api/prenotazioni-fisse?member_id&event_id → { fisse } (le attive). */
	fastify.get('/api/prenotazioni-fisse', async (request) => {
		const fisse = await elencoFisse({ memberId: request.query?.member_id || null, eventId: request.query?.event_id || null });
		return { fisse };
	});

	/** POST /api/prenotazioni-fisse { member_id, event_id, giorni? } → { fissa, prenotate, in_attesa, senza_abbonamento } */
	fastify.post('/api/prenotazioni-fisse', async (request, reply) => {
		const { member_id: memberId, event_id: eventId, giorni } = request.body ?? {};
		if (!memberId || !eventId) return reply.code(400).send({ error: 'Indica il socio e la serie.' });
		const [socio] = await db.select({ nome: members.fullName }).from(members).where(eq(members.id, memberId)).limit(1);
		if (!socio) return reply.code(404).send({ error: 'Socio inesistente.' });
		const [chi] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		const esito = await creaFissa({ memberId, eventId, giorni, creataDa: chi?.nome ?? '' });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'create', entitaTipo: 'booking', entitaNome: socio.nome, entitaId: esito.fissa.id,
			dettagli: `Prenotazione fissa attivata: ${esito.esito.prenotate} lezioni prenotate, ${esito.esito.inAttesa} in lista d'attesa, ${esito.esito.scoperte} senza abbonamento`,
		}, request.log);
		reply.code(201);
		return { fissa: esito.fissa, prenotate: esito.esito.prenotate, in_attesa: esito.esito.inAttesa, senza_abbonamento: esito.esito.scoperte };
	});

	/** DELETE /api/prenotazioni-fisse/:id → { disdette, rimaste }. Lo staff disdice anche oltre il termine. */
	fastify.delete('/api/prenotazioni-fisse/:id', async (request, reply) => {
		const esito = await terminaFissa({ fissaId: request.params.id });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'delete', entitaTipo: 'booking', entitaNome: 'Prenotazione fissa', entitaId: request.params.id,
			dettagli: `Prenotazione fissa terminata: ${esito.disdette} prenotazioni future disdette`,
		}, request.log);
		return esito;
	});
}

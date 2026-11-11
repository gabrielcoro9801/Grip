// Le prenotazioni fisse viste dal gestionale: la reception le crea per conto del socio, da una
// data a un'altra, le vede nella scheda del socio e nelle sessioni, ne cambia il periodo e le
// cancella. Le regole stanno in lib/prenotazioniFisse.js; il socio passa dal portale (routes/member).
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members, staffAccounts, prenotazioniFisse } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity, canWriteEntity } from '../auth/authorize.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { creaFissa, modificaFissa, terminaFissa, elencoFisse } from '../lib/prenotazioniFisse.js';

const dataIt = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const periodo = (f) => (f.al ? `dal ${dataIt(f.dal)} al ${dataIt(f.al)}` : `dal ${dataIt(f.dal)}, senza fine`);

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

	const nomeSocio = async (memberId) => {
		const [socio] = await db.select({ nome: members.fullName }).from(members).where(eq(members.id, memberId)).limit(1);
		return socio?.nome ?? 'Prenotazione fissa';
	};

	/**
	 * GET /api/prenotazioni-fisse?member_id&event_id → { fisse } (quelle in corso)
	 * Ogni fissa: id, member_id, event_id, dal, al, socio, codice_socio, corso, giorno, inizio, fine…
	 */
	fastify.get('/api/prenotazioni-fisse', async (request) => {
		const fisse = await elencoFisse({ memberId: request.query?.member_id || null, eventId: request.query?.event_id || null });
		return { fisse };
	});

	/**
	 * POST /api/prenotazioni-fisse { member_id, event_id, dal?, al | numero }
	 *   → 201 { fissa, prenotate, in_attesa, senza_abbonamento }
	 * `dal` manca = da oggi. «Per N lezioni» (`numero`) si salva come data: quella dell'N-esima.
	 */
	fastify.post('/api/prenotazioni-fisse', async (request, reply) => {
		const { member_id: memberId, event_id: eventId, dal, al, numero } = request.body ?? {};
		if (!memberId || !eventId) return reply.code(400).send({ error: 'Indica il socio e la sessione.' });
		const [socio] = await db.select({ nome: members.fullName }).from(members).where(eq(members.id, memberId)).limit(1);
		if (!socio) return reply.code(404).send({ error: 'Socio inesistente.' });
		const [chi] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		const esito = await creaFissa({ memberId, eventId, dal, al, numero, creataDa: chi?.nome ?? '' });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'create', entitaTipo: 'booking', entitaNome: socio.nome, entitaId: esito.fissa.id,
			dettagli: `Prenotazione fissa ${periodo(esito.fissa)}: ${esito.esito.prenotate} lezioni prenotate, ${esito.esito.inAttesa} in lista d'attesa, ${esito.esito.scoperte} senza abbonamento`,
		}, request.log);
		reply.code(201);
		return { fissa: esito.fissa, prenotate: esito.esito.prenotate, in_attesa: esito.esito.inAttesa, senza_abbonamento: esito.esito.scoperte };
	});

	/**
	 * PUT /api/prenotazioni-fisse/:id { dal?, al | numero }
	 *   → { fissa, prenotate, in_attesa, senza_abbonamento, disdette }
	 * Prenota i giorni aggiunti e disdice quelli tolti; quelli in mezzo restano come sono.
	 */
	fastify.put('/api/prenotazioni-fisse/:id', async (request, reply) => {
		const { dal, al, numero } = request.body ?? {};
		const esito = await modificaFissa({ fissaId: request.params.id, dal, al, numero });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'booking', entitaNome: await nomeSocio(esito.fissa.memberId), entitaId: esito.fissa.id,
			dettagli: `Prenotazione fissa ora ${periodo(esito.fissa)}: ${esito.esito.prenotate + esito.esito.inAttesa} lezioni prenotate, ${esito.disdette} disdette`,
		}, request.log);
		return {
			fissa: esito.fissa, prenotate: esito.esito.prenotate, in_attesa: esito.esito.inAttesa,
			senza_abbonamento: esito.esito.scoperte, disdette: esito.disdette,
		};
	});

	/** Termina la fissa da `dal` (oggi, se manca) e registra. */
	const termina = async (request, reply, dal) => {
		const [fissa] = await db.select({ memberId: prenotazioniFisse.memberId }).from(prenotazioniFisse)
			.where(eq(prenotazioniFisse.id, request.params.id)).limit(1);
		const esito = await terminaFissa({ fissaId: request.params.id, dal });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		await registra(request.utente, {
			tipoAzione: 'delete', entitaTipo: 'booking', entitaNome: await nomeSocio(fissa.memberId), entitaId: request.params.id,
			dettagli: `Prenotazione fissa cancellata${dal ? ` dal ${dataIt(dal)}` : ' da oggi'}: ${esito.disdette} prenotazioni disdette`,
		}, request.log);
		return esito;
	};

	/** POST /api/prenotazioni-fisse/:id/termina { dal? } → { disdette, rimaste }. Lo staff disdice anche oltre il termine. */
	fastify.post('/api/prenotazioni-fisse/:id/termina', (request, reply) => termina(request, reply, request.body?.dal || null));

	/** DELETE /api/prenotazioni-fisse/:id → { disdette, rimaste }: come terminare da oggi. */
	fastify.delete('/api/prenotazioni-fisse/:id', (request, reply) => termina(request, reply, null));
}

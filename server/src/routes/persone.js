// La storia di una persona vista dalla segreteria: il diario (contatti, iscrizione, note) e i
// consensi alle comunicazioni promozionali.
//
// Il diario lo scrivono il lavoro sui contatti (routes/lead.js) e, qui, le note; i consensi li
// dà il socio dal portale (routes/member) o li registra la reception da un modulo firmato.
//
// Chi può: il diario è lavoro della segreteria, non anagrafica. Lo legge chi vede i soci o i
// contatti — non chi apre i nomi dei soci solo per il calendario o per gli account.
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { persone, attivita, consensi, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { NOTA_DIARIO_MASSIMO } from '../../../shared/lead.js';
import { consensiAttuali, tipoConsensoValido } from '../../../shared/consensi.js';

const puoSu = (ruolo, azione) => canAccess(ruolo, 'crm_members', azione) || canAccess(ruolo, 'crm_leads', azione);

/** I consensi attuali di una persona, letti dal registro. */
export async function consensiDi(personaId, conn = db) {
	const righe = await conn.select({ tipo: consensi.tipo, valore: consensi.valore, fonte: consensi.fonte, created_date: consensi.createdDate })
		.from(consensi).where(eq(consensi.personaId, personaId));
	return consensiAttuali(righe);
}

export default async function personeRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (utente.ruolo === 'member') return reply.code(403).send({ error: 'Non consentito.' });
		request.utente = utente;
	});

	const esistente = async (request, reply) => {
		const [persona] = await db.select({ id: persone.id }).from(persone).where(eq(persone.id, request.params.id)).limit(1);
		if (!persona) return reply.code(404).send({ error: 'Persona non trovata.' });
	};
	const leggere = async (request, reply) => {
		if (!puoSu(request.utente.ruolo, 'view')) return reply.code(403).send({ error: 'Non consentito.' });
		return esistente(request, reply);
	};
	const scrivere = async (request, reply) => {
		if (!puoSu(request.utente.ruolo, 'edit')) return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
		return esistente(request, reply);
	};

	const nomeAutore = async (request) => {
		const [autore] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		return autore?.nome ?? '';
	};

	/** GET /api/persone/:id/diario → { attivita, consensi }: il diario dal più vecchio, i consensi di oggi. */
	fastify.get('/api/persone/:id/diario', { preHandler: leggere }, async (request) => {
		const righe = await db.select().from(attivita)
			.where(eq(attivita.personaId, request.params.id))
			.orderBy(asc(attivita.createdDate));
		return {
			attivita: righe.map((r) => translateToSnakeCase(attivita, r)),
			consensi: await consensiDi(request.params.id),
		};
	});

	/** POST /api/persone/:id/note { nota } → 201 { attivita }: una nota nel diario. */
	fastify.post('/api/persone/:id/note', { preHandler: scrivere }, async (request, reply) => {
		const nota = String(request.body?.nota ?? '').trim();
		if (!nota) return reply.code(400).send({ error: 'Scrivi la nota.' });
		if (nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		const [riga] = await db.insert(attivita).values({
			personaId: request.params.id, tipo: 'nota', nota, autoreId: request.utente.sub, autoreNome: await nomeAutore(request),
		}).returning();
		reply.code(201);
		return { attivita: translateToSnakeCase(attivita, riga) };
	});

	/**
	 * POST /api/persone/:id/consensi { tipo, valore } → { consensi }
	 *
	 * Un consenso raccolto dalla reception, su un modulo firmato. Si aggiunge al registro: il
	 * valore di prima resta nello storico.
	 */
	fastify.post('/api/persone/:id/consensi', { preHandler: scrivere }, async (request, reply) => {
		const { tipo, valore } = request.body ?? {};
		if (!tipoConsensoValido(tipo)) return reply.code(400).send({ error: 'Tipo di consenso non valido.' });
		if (typeof valore !== 'boolean') return reply.code(400).send({ error: 'Indica se il consenso è dato o tolto.' });
		await db.insert(consensi).values({
			personaId: request.params.id, tipo, valore, fonte: 'reception', autoreNome: await nomeAutore(request),
		});
		return { consensi: await consensiDi(request.params.id) };
	});
}

// La storia di una persona vista dalla segreteria: il diario (contatti, iscrizione, note).
//
// Il diario lo scrivono, qui, le note e i "Fatto" di Da fare (e le rotte dei soci). Qui sta anche la ricerca globale (Ctrl+K). I consensi promozionali raccolti in
// reception con il modulo firmato sono usciti a novembre 2026 (docs/piani/portale.md): il
// registro resta, e il socio li revoca dal portale.
//
// Chi può: il diario è lavoro della segreteria, non anagrafica. Lo legge chi vede i soci — non chi apre i nomi dei soci solo per il calendario o per gli account.
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { persone, attivita, staffAccounts, members } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { NOTA_DIARIO_MASSIMO, CANALI_CONTATTO, esitoContattoValido } from '../../../shared/diario.js';
import { situazioni } from '../lib/segnali.js';
import { normalizzaTelefono } from '../../../shared/anagrafica.js';

const puoSu = (ruolo, azione) => canAccess(ruolo, 'crm_members', azione);


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

	/**
	 * GET /api/persone/cerca?q= → { risultati: [{ persona_id, nome, telefono, socio_id, codice_socio, tipo }] }
	 *
	 * La ricerca di Ctrl+K: per nome (le parole in qualunque ordine), telefono (solo le cifre,
	 * così "347 123 4567" trova "+393471234567"), codice fiscale o codice socio. La usa chi vede i soci.
	 */
	fastify.get('/api/persone/cerca', async (request, reply) => {
		const ruolo = request.utente.ruolo;
		if (!canAccess(ruolo, 'crm_members', 'view')) return reply.code(403).send({ error: 'Non consentito.' });
		const testo = String(request.query?.q ?? '').trim().slice(0, 80);
		if (testo.length < 2) return { risultati: [] };

		const simile = (colonna, pezzo) => sql`${colonna} ILIKE ${`%${pezzo.replace(/[\\%_]/g, '\\$&')}%`}`;
		const parole = testo.split(/\s+/);
		const cifre = (normalizzaTelefono(testo) ?? testo).replace(/\D/g, '');
		const righe = await db.select({
			persona_id: persone.id, nome: persone.fullName, telefono: persone.telefono,
			socio_id: members.id, codice_socio: members.codiceSocio, archiviato_il: members.archiviatoIl,
		})
			.from(persone)
			.innerJoin(members, eq(members.personaId, persone.id))
			.where(
				or(
					and(...parole.map((p) => simile(persone.fullName, p))),
					cifre.length >= 4 ? sql`regexp_replace(coalesce(${persone.telefono}, ''), '\\D', '', 'g') LIKE ${`%${cifre}%`}` : undefined,
					sql`upper(${members.codiceFiscale}) = ${testo.toUpperCase()}`,
					eq(members.codiceSocio, testo),
				),
			)
			.orderBy(asc(persone.fullName))
			.limit(10);
		return {
			risultati: righe.map(({ archiviato_il: archiviato, ...r }) => ({
				...r, tipo: archiviato ? 'ex_socio' : 'socio',
			})),
		};
	});

	const nomeAutore = async (request) => {
		const [autore] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		return autore?.nome ?? '';
	};

	/** GET /api/persone/:id/diario → { attivita }: il diario dal più vecchio. I consensi hanno la loro rotta. */
	fastify.get('/api/persone/:id/diario', { preHandler: leggere }, async (request) => {
		const righe = await db.select().from(attivita)
			.where(eq(attivita.personaId, request.params.id))
			.orderBy(asc(attivita.createdDate));
		return {
			attivita: righe.map((r) => translateToSnakeCase(attivita, r)),
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
	 * POST /api/persone/:id/contatti { canale, segnali: [codice] (o segnale), esito?, nota? } → 201 { attivita }
	 *
	 * Il "Fatto" di Da fare (di persona, chiamato, messaggio, email) o del bancone (salutato, rinnovo
	 * proposto): una riga nel diario, che per qualche giorno nasconde **quel** segnale e solo lui
	 * (shared/segnali.js). Il segnale dev'essere uno di quelli che la persona ha adesso: lo dice il
	 * motore, non il client. È anche ciò che permette al giro di contare chi, contattato perché
	 * assente, è poi tornato (giro.js).
	 */
	fastify.post('/api/persone/:id/contatti', { preHandler: scrivere }, async (request, reply) => {
		const { canale } = request.body ?? {};
		// Uno o più segnali: una riga di Da fare può averne due della stessa linea (assente e no-show).
		const segnali = [...new Set([request.body?.segnali ?? request.body?.segnale].flat().filter(Boolean))];
		const esito = request.body?.esito ?? 'fatto';
		const nota = String(request.body?.nota ?? '').trim() || null;
		if (!CANALI_CONTATTO.some((c) => c.valore === canale)) return reply.code(400).send({ error: "Indica come l'hai contattato." });
		if (!esitoContattoValido(esito)) return reply.code(400).send({ error: "Indica com'è andata." });
		if (nota && nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		const [situazione] = (await situazioni({ personaId: request.params.id })).persone;
		const attuali = (situazione?.segnali ?? []).filter((s) => s.pubblico === 'staff' || s.pubblico === 'bancone').map((s) => s.codice);
		if (!segnali.length || segnali.some((s) => !attuali.includes(s))) {
			return reply.code(400).send({ error: "Questa cosa da fare non c'è più: ricarica la pagina." });
		}
		const [riga] = await db.insert(attivita).values({
			personaId: request.params.id, tipo: 'contatto', canale, esito, nota, autoreId: request.utente.sub, autoreNome: await nomeAutore(request),
			riferimento: { segnali },
		}).returning();
		reply.code(201);
		return { attivita: translateToSnakeCase(attivita, riga) };
	});
}

// La storia di una persona vista dalla segreteria: il diario (contatti, iscrizione, note) e i
// consensi alle comunicazioni promozionali.
//
// Il diario lo scrivono il lavoro sui contatti (routes/lead.js) e, qui, le note, i contatti con
// i soci e i rimandi di Oggi; i consensi li dà il socio dal portale (routes/member) o li
// registra la reception da un modulo firmato. Qui sta anche la ricerca globale (Ctrl+K).
//
// Chi può: il diario è lavoro della segreteria, non anagrafica. Lo legge chi vede i soci o i
// contatti — non chi apre i nomi dei soci solo per il calendario o per gli account.
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { persone, attivita, consensi, staffAccounts, members, trattative } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { NOTA_DIARIO_MASSIMO, CANALI_CONTATTO, STATI_APERTI, esitoContattoValido } from '../../../shared/lead.js';
import { RIMANDO_MASSIMO_GIORNI } from '../../../shared/segnali.js';
import { consensiAttuali, tipoConsensoValido } from '../../../shared/consensi.js';
import { normalizzaTelefono } from '../../../shared/anagrafica.js';
import { oggiIso, spostaGiorni } from '../../../shared/giorni.js';

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

	/**
	 * GET /api/persone/cerca?q= → { risultati: [{ persona_id, nome, telefono, socio_id, codice_socio, trattativa_aperta_id, tipo }] }
	 *
	 * La ricerca di Ctrl+K: per nome (le parole in qualunque ordine), telefono (solo le cifre,
	 * così "347 123 4567" trova "+393471234567"), codice fiscale o codice socio. Ognuno trova
	 * solo quello che vede: i soci chi vede i soci, i contatti chi vede i contatti.
	 */
	fastify.get('/api/persone/cerca', async (request, reply) => {
		const ruolo = request.utente.ruolo;
		const vedeSoci = canAccess(ruolo, 'crm_members', 'view');
		const vedeLead = canAccess(ruolo, 'crm_leads', 'view');
		if (!vedeSoci && !vedeLead) return reply.code(403).send({ error: 'Non consentito.' });
		const testo = String(request.query?.q ?? '').trim().slice(0, 80);
		if (testo.length < 2) return { risultati: [] };

		const simile = (colonna, pezzo) => sql`${colonna} ILIKE ${`%${pezzo.replace(/[\\%_]/g, '\\$&')}%`}`;
		const parole = testo.split(/\s+/);
		const cifre = (normalizzaTelefono(testo) ?? testo).replace(/\D/g, '');
		const righe = await db.select({
			persona_id: persone.id, nome: persone.fullName, telefono: persone.telefono,
			socio_id: members.id, codice_socio: members.codiceSocio, archiviato_il: members.archiviatoIl,
			trattativa_aperta_id: trattative.id,
		})
			.from(persone)
			.leftJoin(members, eq(members.personaId, persone.id))
			.leftJoin(trattative, and(eq(trattative.personaId, persone.id), inArray(trattative.stato, STATI_APERTI)))
			.where(and(
				or(
					and(...parole.map((p) => simile(persone.fullName, p))),
					cifre.length >= 4 ? sql`regexp_replace(coalesce(${persone.telefono}, ''), '\\D', '', 'g') LIKE ${`%${cifre}%`}` : undefined,
					sql`upper(${members.codiceFiscale}) = ${testo.toUpperCase()}`,
					eq(members.codiceSocio, testo),
				),
				vedeSoci ? undefined : isNull(members.id),
				vedeLead ? undefined : isNotNull(members.id),
			))
			.orderBy(asc(persone.fullName))
			.limit(10);
		return {
			risultati: righe.map(({ archiviato_il: archiviato, ...r }) => ({
				...r, tipo: r.socio_id ? (archiviato ? 'ex_socio' : 'socio') : r.trattativa_aperta_id ? 'contatto_aperto' : 'contatto',
			})),
		};
	});

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
	 * POST /api/persone/:id/contatti { canale, esito, nota? } → 201 { attivita }
	 *
	 * Un contatto con un socio — una telefonata da Oggi, il rinnovo proposto al bancone. Finisce
	 * nel diario, e per qualche giorno i suoi segnali non si ripropongono (shared/segnali.js).
	 * Il contatto con un lead passa invece dalle azioni del lead, che ne cambiano lo stato.
	 */
	fastify.post('/api/persone/:id/contatti', { preHandler: scrivere }, async (request, reply) => {
		const { canale, esito } = request.body ?? {};
		const nota = String(request.body?.nota ?? '').trim() || null;
		if (!CANALI_CONTATTO.some((c) => c.valore === canale)) return reply.code(400).send({ error: "Indica come l'hai contattato." });
		if (!esitoContattoValido(esito)) return reply.code(400).send({ error: "Indica com'è andata." });
		if (nota && nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		const [riga] = await db.insert(attivita).values({
			personaId: request.params.id, tipo: 'contatto', canale, esito, nota, autoreId: request.utente.sub, autoreNome: await nomeAutore(request),
		}).returning();
		reply.code(201);
		return { attivita: translateToSnakeCase(attivita, riga) };
	});

	/**
	 * POST /api/persone/:id/rimanda { giorni, nota? } → 201 { attivita }
	 *
	 * "Ci penso dopo": i segnali della persona spariscono da Oggi fino a quel giorno. È una riga
	 * del diario, non un compito: chi apre la scheda vede chi ha rimandato e fino a quando.
	 */
	fastify.post('/api/persone/:id/rimanda', { preHandler: scrivere }, async (request, reply) => {
		const giorni = Number(request.body?.giorni);
		const nota = String(request.body?.nota ?? '').trim() || null;
		if (!Number.isInteger(giorni) || giorni < 1 || giorni > RIMANDO_MASSIMO_GIORNI) {
			return reply.code(400).send({ error: `Si rimanda da 1 a ${RIMANDO_MASSIMO_GIORNI} giorni.` });
		}
		if (nota && nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		const [riga] = await db.insert(attivita).values({
			personaId: request.params.id, tipo: 'rimando', esito: spostaGiorni(oggiIso(), giorni), nota,
			autoreId: request.utente.sub, autoreNome: await nomeAutore(request),
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

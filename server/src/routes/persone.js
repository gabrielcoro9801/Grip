// La storia di una persona vista dalla segreteria: il diario (contatti, iscrizione, note) e i
// consensi alle comunicazioni promozionali.
//
// Il diario lo scrivono il lavoro sui contatti (routes/lead.js) e, qui, le note e i "Fatto" di
// Da fare; i consensi li dà il socio dal portale (routes/member) o li
// registra la reception da un modulo firmato. Qui sta anche la ricerca globale (Ctrl+K).
//
// Chi può: il diario è lavoro della segreteria, non anagrafica. Lo legge chi vede i soci o i
// contatti — non chi apre i nomi dei soci solo per il calendario o per gli account.
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { persone, attivita, consensi, staffAccounts, members, trattative, memberDocuments } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { NOTA_DIARIO_MASSIMO, CANALI_CONTATTO, STATI_APERTI, esitoContattoValido } from '../../../shared/lead.js';
import { situazioni } from '../lib/segnali.js';
import { tipoConsensoValido, TIPI_CONSENSO } from '../../../shared/consensi.js';
import { consensiDi, righeConsensi } from '../lib/consensi.js';
import { registra } from '../lib/registro.js';
import { normalizzaTelefono } from '../../../shared/anagrafica.js';

const puoSu = (ruolo, azione) => canAccess(ruolo, 'crm_members', azione) || canAccess(ruolo, 'crm_leads', azione);


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
	 * assente, è poi tornato (giro.js). Il contatto con un lead passa dalle azioni del lead.
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

	/**
	 * GET /api/persone/:id/consensi → { consensi, storico }
	 *
	 * I consensi di oggi e tutto il registro, dal più recente: chi, quando, da dove, con quale
	 * modulo — è la prova da mostrare se qualcuno chiede.
	 */
	fastify.get('/api/persone/:id/consensi', { preHandler: leggere }, async (request) => {
		const righe = await righeConsensi([request.params.id]);
		return {
			consensi: await consensiDi(request.params.id),
			storico: righe.reverse().map(({ persona_id: _p, ...r }) => r),
		};
	});

	/**
	 * POST /api/persone/:id/consensi { tipi: [tipo], valore, documento_id?, nota?, atteso: { [tipo]: il|null } } → { consensi }
	 *
	 * La reception registra un consenso — solo con il modulo firmato già caricato fra i documenti
	 * del socio (tipo `consenso_marketing`): senza, non c'è la prova, e il consenso non vale — o
	 * la sua revoca, con il motivo ("l'ha chiesto per email il 10/10"). Si aggiunge al registro: il
	 * valore di prima resta nello storico.
	 *
	 * Il socio sceglie anche dal portale, nello stesso registro. `atteso` è quello che la scheda
	 * mostrava: se nel frattempo il socio ha cambiato idea, 409, e si rilegge prima di decidere al
	 * posto suo. Solo chi modifica i soci: chi segue i lead non tocca i consensi dei soci.
	 */
	fastify.post('/api/persone/:id/consensi', { preHandler: scrivere }, async (request, reply) => {
		if (!canAccess(request.utente.ruolo, 'crm_members', 'edit')) return reply.code(403).send({ error: 'I consensi li registra chi gestisce i soci.' });
		const { valore, atteso = {} } = request.body ?? {};
		const tipi = [...new Set(Array.isArray(request.body?.tipi) ? request.body.tipi : [request.body?.tipo].filter(Boolean))];
		const nota = String(request.body?.nota ?? '').trim() || null;
		if (!tipi.length || tipi.some((t) => !tipoConsensoValido(t))) return reply.code(400).send({ error: 'Scegli per quali comunicazioni.' });
		if (typeof valore !== 'boolean') return reply.code(400).send({ error: 'Indica se il consenso è dato o tolto.' });
		if (nota && nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		if (!valore && !nota) return reply.code(400).send({ error: 'Scrivi perché si toglie: es. «l\'ha chiesto per email il 10/10».' });

		let documentoId = null;
		if (valore) {
			const [doc] = request.body?.documento_id ? await db.select({ id: memberDocuments.id })
				.from(memberDocuments).innerJoin(members, eq(members.id, memberDocuments.memberId))
				.where(and(
					eq(memberDocuments.id, request.body.documento_id), eq(memberDocuments.documentType, 'consenso_marketing'),
					eq(members.personaId, request.params.id),
				)).limit(1) : [];
			if (!doc) return reply.code(400).send({ error: 'Serve il modulo firmato: caricalo fra i documenti del socio (tipo «Consenso comunicazioni promozionali»), poi sceglilo qui.' });
			documentoId = doc.id;
		}

		const istante = (d) => (d ? new Date(d).getTime() : null);
		const ora = await consensiDi(request.params.id);
		if (tipi.some((t) => istante(ora[t].il) !== istante(atteso[t] ?? null))) {
			return reply.code(409).send({ error: 'Nel frattempo il socio ha cambiato le sue scelte dal portale: rileggile prima di registrare.', consensi: ora });
		}

		const autoreNome = await nomeAutore(request);
		await db.insert(consensi).values(tipi.map((tipo) => ({
			personaId: request.params.id, tipo, valore, fonte: 'reception', autoreNome, documentoId, nota,
		})));
		const etichette = tipi.map((t) => TIPI_CONSENSO.find((x) => x.valore === t).etichetta).join(', ');
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'consensi', entitaId: request.params.id,
			dettagli: `${valore ? 'Consenso registrato con modulo firmato' : 'Consenso tolto'}: ${etichette}${nota ? ` (${nota})` : ''}`,
		}, request.log);
		return { consensi: await consensiDi(request.params.id) };
	});
}

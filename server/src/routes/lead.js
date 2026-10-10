// Il lavoro sui contatti (i lead): registrarli, le azioni che ne cambiano lo stato, il loro
// diario, l'iscrizione a socio, e quanto è usato ogni canale.
//
// Un lead è una trattativa (`trattative`) di una persona (`persone`): la persona resta, con il
// suo diario, anche quando la trattativa si chiude o quando diventa socia. Persona e trattativa
// nascono e cambiano insieme, per questo passano da qui e non dall'endpoint generico. Lo stato
// (shared/lead.js) lo cambiano solo le azioni, ognuna in una transazione che aggiorna la
// trattativa e ne scrive il diario.
//
// Le risposte hanno la forma di sempre — un lead con nome, recapiti e stato in una riga — così
// le schermate non devono sapere che sotto ci sono due tabelle.
import { and, asc, count, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { trattative, persone, members, attivita, staffAccounts, canaliContatto } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity, canWriteEntity } from '../auth/authorize.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { anagraficaSocio, rifiuta, telefonoNormalizzato } from '../entities/hooks.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import { soglieEnte } from '../lib/impostazioni.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { oggiIso } from '../../../shared/abbonamenti.js';
import { registra } from '../lib/registro.js';
import { sessoValido, normalizzaTelefono } from '../../../shared/anagrafica.js';
import {
	applicaAzione, contaFiltriLead, statoLead, descriviAttivita, motivoLeadIncompleto, NOTE_LEAD_MASSIMO, STATI_APERTI,
} from '../../../shared/lead.js';

// Le azioni con cui si lavora un lead, e cosa prendono dal corpo della richiesta.
const AZIONI = {
	contatto: (c) => ({ tipo: 'contatto', canale: c.canale, esito: c.esito }),
	richiamo: (c) => ({ tipo: 'richiamo', data: c.data }),
	chiudi: (c) => ({ tipo: 'chiudi', motivo: c.motivo, nota: c.nota }),
	riapri: () => ({ tipo: 'riapri' }),
};

// Quello che la finestra di iscrizione può scrivere sul socio. Il codice socio e le date di
// sistema restano fuori: il codice lo assegna il contatore.
const CAMPI_SOCIO = [
	'nome', 'cognome', 'sesso', 'codice_fiscale', 'email', 'phone', 'date_of_birth', 'address',
	'emergency_contact_name', 'emergency_contact_phone', 'gdpr_consent', 'notes',
];

// I campi della persona e quelli della trattativa che si scrivono registrando o correggendo un lead.
const CAMPI_PERSONA = ['nome', 'cognome', 'telefono', 'email', 'sesso', 'anno_nascita', 'note'];
const CAMPI_TRATTATIVA = ['data_contatto', 'canale_id', 'interesse_categoria_id', 'assegnata_a_id'];

const presente = (corpo, campo) => Object.prototype.hasOwnProperty.call(corpo, campo);
const vuotoANull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);

/** Un lead come lo vedono le schermate: trattativa e persona in una riga, e se la persona è socia. */
const colonneLead = {
	id: trattative.id, persona_id: trattative.personaId,
	nome: persone.nome, cognome: persone.cognome, telefono: persone.telefono, email: persone.email,
	sesso: persone.sesso, anno_nascita: persone.annoNascita, note: persone.nota,
	data_contatto: trattative.dataContatto, canale_id: trattative.canaleId,
	stato: trattative.stato, stato_dal: trattative.statoDal, tentativi_senza_risposta: trattative.tentativiSenzaRisposta,
	ultimo_contatto_il: trattative.ultimoContattoIl, ultima_risposta_il: trattative.ultimaRispostaIl,
	richiamare_il: trattative.richiamareIl, motivo_chiusura: trattative.motivoChiusura,
	assegnata_a_id: trattative.assegnataAId, interesse_categoria_id: trattative.interesseCategoriaId,
	created_date: trattative.createdDate,
	// Chi ha già una scheda da socio (anche archiviata): i suoi dati si cambiano da lì.
	socio_id: members.id, socio_archiviato_il: members.archiviatoIl,
};

const selezionaLead = (conn = db) => conn.select(colonneLead).from(trattative)
	.innerJoin(persone, eq(trattative.personaId, persone.id))
	.leftJoin(members, eq(members.personaId, persone.id));

async function leadDi(id, conn = db) {
	const [riga] = await selezionaLead(conn).where(eq(trattative.id, id)).limit(1);
	return riga ?? null;
}

async function nomeAutore(request) {
	const [autore] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
	return autore?.nome ?? '';
}

/**
 * I campi della persona dal corpo di una richiesta, puliti: vuoti a null, telefono normalizzato.
 * Rifiuta quello che non va (sesso, anno, nota troppo lunga).
 */
function campiPersona(corpo) {
	const campi = {};
	for (const campo of CAMPI_PERSONA.filter((c) => presente(corpo, c))) {
		const valore = vuotoANull(corpo[campo]);
		campi[campo] = typeof valore === 'string' ? valore.trim() : valore;
	}
	if (presente(campi, 'telefono')) campi.telefono = telefonoNormalizzato(campi.telefono);
	if (campi.sesso && !sessoValido(campi.sesso)) throw rifiuta('Sesso non valido: M, F o Altro.');
	if (campi.anno_nascita !== undefined && campi.anno_nascita !== null) {
		const anno = Number(campi.anno_nascita);
		if (!Number.isInteger(anno) || anno < 1900 || anno > Number(oggiIso().slice(0, 4))) throw rifiuta("L'anno di nascita non è valido.");
		campi.anno_nascita = anno;
	}
	if (campi.note && campi.note.length > NOTE_LEAD_MASSIMO) throw rifiuta(`Le note stanno in ${NOTE_LEAD_MASSIMO} caratteri.`);
	return campi;
}

function campiTrattativa(corpo) {
	return Object.fromEntries(CAMPI_TRATTATIVA.filter((c) => presente(corpo, c)).map((c) => [c, vuotoANull(corpo[c])]));
}

const personaInColonne = ({ note, ...campi }) => ({ ...campi, ...(note !== undefined ? { nota: note } : {}) });
const nomeDi = (lead) => `${lead.nome} ${lead.cognome ?? ''}`.trim();

export default async function leadRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		request.utente = utente;
	});

	// L'iscrizione tocca due aree: chiude un contatto e crea (o riattiva) un socio. Serve poterle
	// scrivere entrambe, altrimenti la reception che gestisce i contatti ma non i soci potrebbe
	// creare soci passando di qui. Il socio non ha nessuna delle due, per costruzione.
	const puoTrasformare = async (request, reply) => {
		if (!canWriteEntity(request.utente.ruolo, 'Lead') || !canWriteEntity(request.utente.ruolo, 'Member')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
		}
	};

	const puoLeggere = async (request, reply) => {
		if (!canReadEntity(request.utente.ruolo, 'Lead')) return reply.code(403).send({ error: 'Non consentito.' });
	};
	const puoLavorare = async (request, reply) => {
		if (!canWriteEntity(request.utente.ruolo, 'Lead')) return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
	};

	/**
	 * GET /api/lead/lavoro → { leads, conteggi, soglie }
	 *
	 * I lead con il loro stato, quanti ce ne sono per ogni filtro rapido, e le soglie della
	 * palestra con cui sono contati (la pagina filtra con le stesse). Le trattative già iscritte
	 * non sono lead. Non scrive niente: la chiusura dei *non raggiungibili*, che girava qui alla
	 * lettura, ora la fa il giro quotidiano (src/giro.js).
	 */
	fastify.get('/api/lead/lavoro', { preHandler: puoLeggere }, async () => {
		const oggi = oggiIso();
		const soglie = (await soglieEnte()).lead;
		const righe = await selezionaLead().where(ne(trattative.stato, 'iscritto')).orderBy(desc(trattative.dataContatto));
		return { leads: righe, conteggi: contaFiltriLead(righe, oggi, soglie), soglie };
	});

	/**
	 * GET /api/lead/andamento → { righe, canali }
	 *
	 * Le righe di Andamento: una per trattativa, con dove è finita — aperta, persa, o iscritta
	 * (le conversioni). Escono solo i campi che servono ai conti: niente nomi, niente recapiti.
	 */
	fastify.get('/api/lead/andamento', { preHandler: puoLeggere }, async () => {
		const [righe, elencoCanali] = await Promise.all([
			db.select({
				data: trattative.dataContatto, canale: trattative.canaleId, sesso: persone.sesso, nascita: persone.annoNascita,
				stato: trattative.stato, statoDal: trattative.statoDal, motivo: trattative.motivoChiusura,
			}).from(trattative).innerJoin(persone, eq(trattative.personaId, persone.id)),
			db.select({ id: canaliContatto.id, nome: canaliContatto.nome, attivo: canaliContatto.attivo }).from(canaliContatto),
		]);
		return {
			righe: righe.map((t) => {
				const esito = t.stato === 'iscritto' ? 'socio' : statoLead(t.stato).aperto ? 'aperto' : 'perso';
				return {
					data_contatto: t.data, canale_id: t.canale, sesso: t.sesso, anno_nascita: t.nascita, esito,
					motivo: esito !== 'perso' ? null : (t.stato === 'non_raggiungibile' ? 'non_raggiungibile' : t.motivo),
					socio_dal: esito === 'socio' ? t.statoDal : null,
				};
			}),
			canali: elencoCanali,
		};
	});

	/**
	 * GET /api/lead/doppioni?telefono=&email=&escludi= → { doppioni }
	 *
	 * Le persone già note con lo stesso telefono o la stessa email: mentre si registra un
	 * contatto, la reception vede che è già socio, un ex socio, o un contatto aperto, e lo collega
	 * invece di crearne un secondo. Escono solo il nome e che cosa è: chi registra i contatti ha
	 * già in mano quel numero, ma non legge per forza le schede dei soci.
	 */
	fastify.get('/api/lead/doppioni', { preHandler: puoLeggere }, async (request) => {
		const telefono = normalizzaTelefono(request.query?.telefono);
		const email = String(request.query?.email ?? '').trim().toLowerCase();
		if (!telefono && !email) return { doppioni: [] };
		const righe = await db.select({
			persona_id: persone.id, nome: persone.fullName, socio_id: members.id, archiviato_il: members.archiviatoIl,
			trattativa_aperta_id: trattative.id,
		})
			.from(persone)
			.leftJoin(members, eq(members.personaId, persone.id))
			.leftJoin(trattative, and(eq(trattative.personaId, persone.id), inArray(trattative.stato, STATI_APERTI)))
			.where(and(
				or(telefono ? eq(persone.telefono, telefono) : undefined, email ? eq(sql`lower(${persone.email})`, email) : undefined),
				request.query?.escludi ? ne(persone.id, request.query.escludi) : undefined,
			))
			.limit(5);
		return {
			doppioni: righe.map((r) => ({
				persona_id: r.persona_id, nome: r.nome, trattativa_aperta_id: r.trattativa_aperta_id,
				tipo: r.socio_id ? (r.archiviato_il ? 'ex_socio' : 'socio') : r.trattativa_aperta_id ? 'contatto_aperto' : 'contatto',
			})),
		};
	});

	/**
	 * POST /api/lead → 201 { lead }
	 *
	 *   { nome, cognome?, telefono?, email?, sesso?, anno_nascita?, note?, data_contatto, canale_id, interesse_categoria_id? }
	 *   { persona_id, data_contatto, canale_id, … }  — una persona già nota (un ex socio, un
	 *     contatto chiuso) che torna: le si apre una trattativa nuova, senza toccarne i dati.
	 */
	fastify.post('/api/lead', { preHandler: puoLavorare }, async (request, reply) => {
		const corpo = request.body ?? {};
		const trattativa = campiTrattativa(corpo);
		let personaId = corpo.persona_id ?? null;
		let campi = null;
		if (personaId) {
			// I recapiti la persona li ha già: qui servono solo canale e giorno.
			const motivo = motivoLeadIncompleto({ nome: '-', email: '-', ...trattativa });
			if (motivo) return reply.code(400).send({ error: motivo });
			const [persona] = await db.select({ id: persone.id }).from(persone).where(eq(persone.id, personaId)).limit(1);
			if (!persona) return reply.code(404).send({ error: 'La persona non esiste più.' });
		} else {
			campi = campiPersona(corpo);
			const motivo = motivoLeadIncompleto({ ...campi, ...trattativa });
			if (motivo) return reply.code(400).send({ error: motivo });
		}

		const id = await db.transaction(async (tx) => {
			if (campi) [{ id: personaId }] = await tx.insert(persone).values(translateToJs(persone, personaInColonne(campi))).returning({ id: persone.id });
			const [creata] = await tx.insert(trattative)
				.values({ ...translateToJs(trattative, trattativa), personaId })
				.returning({ id: trattative.id });
			return creata.id;
		});
		const lead = await leadDi(id);
		await registra(request.utente, {
			tipoAzione: 'create', entitaTipo: 'lead', entitaNome: nomeDi(lead), entitaId: id,
			dettagli: campi ? 'Contatto registrato' : 'Contatto registrato su una persona già nota',
		}, request.log);
		reply.code(201);
		return { lead };
	});

	/**
	 * PUT /api/lead/:id → { lead }
	 *
	 * Corregge i dati del contatto e della trattativa. Lo stato no: lo cambiano le azioni. Di chi
	 * ha una scheda da socio i dati si correggono da lì (il socio è la loro fonte, e la persona ne
	 * è una copia): qui si cambia solo la trattativa.
	 */
	fastify.put('/api/lead/:id', { preHandler: puoLavorare }, async (request, reply) => {
		const corpo = request.body ?? {};
		const prima = await leadDi(request.params.id);
		if (!prima) return reply.code(404).send({ error: 'Il contatto non esiste più.' });
		const campi = campiPersona(corpo);
		const trattativa = campiTrattativa(corpo);
		if (prima.socio_id && Object.keys(campi).length) {
			return reply.code(400).send({ error: 'Questa persona ha una scheda da socio: i suoi dati si cambiano da lì.' });
		}
		const motivo = motivoLeadIncompleto({ ...prima, ...campi, ...trattativa });
		if (motivo) return reply.code(400).send({ error: motivo });

		await db.transaction(async (tx) => {
			if (Object.keys(campi).length) {
				await tx.update(persone).set({ ...translateToJs(persone, personaInColonne(campi)), updatedDate: new Date() }).where(eq(persone.id, prima.persona_id));
			}
			if (Object.keys(trattativa).length) {
				await tx.update(trattative).set({ ...translateToJs(trattative, trattativa), updatedDate: new Date() }).where(eq(trattative.id, prima.id));
			}
		});
		return { lead: await leadDi(prima.id) };
	});

	/**
	 * DELETE /api/lead/:id → 204
	 *
	 * Un contatto registrato per errore. Sparisce la trattativa; la persona solo se non le resta
	 * altro — né una scheda da socio, né altre trattative — e con lei il suo diario.
	 */
	fastify.delete('/api/lead/:id', { preHandler: puoLavorare }, async (request, reply) => {
		const lead = await leadDi(request.params.id);
		if (!lead) return reply.code(404).send({ error: 'Il contatto non esiste più.' });
		await db.transaction(async (tx) => {
			await tx.delete(trattative).where(eq(trattative.id, lead.id));
			const [{ altre }] = await tx.select({ altre: count() }).from(trattative).where(eq(trattative.personaId, lead.persona_id));
			if (!lead.socio_id && Number(altre) === 0) await tx.delete(persone).where(eq(persone.id, lead.persona_id));
		});
		await registra(request.utente, {
			tipoAzione: 'delete', entitaTipo: 'lead', entitaNome: nomeDi(lead), entitaId: lead.id, dettagli: 'Contatto eliminato',
		}, request.log);
		return reply.code(204).send();
	});

	/**
	 * GET /api/lead/:id/attivita → { attivita }: il diario della persona, dal più vecchio. È
	 * tutta la sua storia, anche quella delle trattative di prima: chi richiama dopo un anno
	 * ritrova cosa si era detto.
	 */
	fastify.get('/api/lead/:id/attivita', { preHandler: puoLeggere }, async (request, reply) => {
		const [trattativa] = await db.select({ personaId: trattative.personaId }).from(trattative).where(eq(trattative.id, request.params.id)).limit(1);
		if (!trattativa) return reply.code(404).send({ error: 'Il contatto non esiste più.' });
		const righe = await db.select().from(attivita)
			.where(eq(attivita.personaId, trattativa.personaId))
			.orderBy(asc(attivita.createdDate));
		return { attivita: righe.map((r) => translateToSnakeCase(attivita, r)) };
	});

	/**
	 * POST /api/lead/:id/:azione  (contatto | richiamo | chiudi | riapri) → { lead }
	 *
	 *   contatto { canale, esito: 'risposto' | 'nessuna_risposta', nota? }
	 *   richiamo { data, nota? }
	 *   chiudi   { motivo, nota? }
	 *   riapri   { nota? }
	 *
	 * Le regole — da quale stato a quale, cosa serve — stanno in `applicaAzione` (shared/lead.js).
	 */
	fastify.post('/api/lead/:id/:azione', { preHandler: puoLavorare }, async (request, reply) => {
		const leggi = AZIONI[request.params.azione];
		if (!leggi) return reply.code(404).send({ error: 'Azione sconosciuta.' });
		const corpo = request.body ?? {};
		const nota = String(corpo.nota ?? '').trim() || null;
		if (nota && nota.length > NOTE_LEAD_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTE_LEAD_MASSIMO} caratteri.` });

		const autoreNome = await nomeAutore(request);
		const esito = await db.transaction(async (tx) => {
			const [riga] = await tx.select().from(trattative).where(eq(trattative.id, request.params.id)).limit(1).for('update');
			if (!riga) return { errore: 404, messaggio: 'Il contatto non esiste più.' };
			const risultato = applicaAzione(translateToSnakeCase(trattative, riga), { ...leggi(corpo), nota }, oggiIso());
			if (risultato.errore) return { errore: 400, messaggio: risultato.errore };

			await tx.update(trattative)
				.set({ ...translateToJs(trattative, risultato.campi), updatedDate: new Date() })
				.where(eq(trattative.id, riga.id));
			await tx.insert(attivita).values({
				personaId: riga.personaId, trattativaId: riga.id, ...translateToJs(attivita, risultato.attivita), nota,
				autoreId: request.utente.sub, autoreNome,
			});
			return { attivita: risultato.attivita };
		});
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });

		const lead = await leadDi(request.params.id);
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'lead', entitaNome: nomeDi(lead), entitaId: lead.id,
			dettagli: `${descriviAttivita(esito.attivita)} → ${statoLead(lead.stato).etichetta}`,
		}, request.log);
		return { lead };
	});

	/**
	 * GET /api/lead/canali/uso → { [idCanale]: { contatti, soci } }
	 *
	 * Un canale si elimina solo se non lo cita nessuna trattativa: né un contatto, né un socio
	 * che da lì è arrivato. Escono solo dei numeri.
	 */
	fastify.get('/api/lead/canali/uso', async (request, reply) => {
		if (!canReadEntity(request.utente.ruolo, 'CanaleContatto')) return reply.code(403).send({ error: 'Non consentito.' });
		const righe = await db.select({ id: trattative.canaleId, stato: trattative.stato, n: count() })
			.from(trattative).groupBy(trattative.canaleId, trattative.stato);
		const uso = {};
		for (const r of righe) {
			uso[r.id] ??= { contatti: 0, soci: 0 };
			uso[r.id][r.stato === 'iscritto' ? 'soci' : 'contatti'] += Number(r.n);
		}
		return uso;
	});

	/**
	 * POST /api/lead/:id/trasforma  { nome, cognome, sesso, codice_fiscale, … } → 201 { member, riattivato }
	 *
	 * Il contatto si iscrive. Il corpo è l'anagrafica del socio così come la finestra l'ha
	 * completata: vale la stessa regola del modulo dei soci (`anagraficaSocio`), CF obbligatorio
	 * compreso. Se la persona era già stata socia (un ex socio che torna) si riattiva la sua
	 * scheda, con il suo codice e la sua storia; altrimenti nasce un socio nuovo sulla persona.
	 * In entrambi i casi la trattativa si chiude come *iscritto* e il diario resta.
	 */
	fastify.post('/api/lead/:id/trasforma', { preHandler: puoTrasformare }, async (request, reply) => {
		const corpo = Object.fromEntries(
			CAMPI_SOCIO.filter((c) => c in (request.body ?? {})).map((c) => [c, request.body[c]])
		);
		const anagrafica = anagraficaSocio(corpo, { creazione: true });
		if (anagrafica.gdpr_consent === true) anagrafica.gdpr_consent_date = oggiIso();
		const autoreNome = await nomeAutore(request);

		const esito = await db.transaction(async (tx) => {
			const [trattativa] = await tx.select().from(trattative).where(eq(trattative.id, request.params.id)).limit(1).for('update');
			// Già iscritto — da un collega, o da un doppio clic — oppure eliminato.
			if (!trattativa || trattativa.stato === 'iscritto') return null;

			const [giaSocio] = await tx.select({ id: members.id }).from(members)
				.where(eq(members.personaId, trattativa.personaId)).limit(1).for('update');
			let socio;
			if (giaSocio) {
				[socio] = await tx.update(members)
					.set({ ...translateToJs(members, anagrafica), archiviatoIl: null, updatedDate: new Date() })
					.where(eq(members.id, giaSocio.id))
					.returning();
			} else {
				[socio] = await tx.insert(members)
					.values({ ...translateToJs(members, anagrafica), codiceSocio: await assegnaCodiceSocio(tx), personaId: trattativa.personaId })
					.returning();
			}
			await tx.update(trattative)
				.set({ stato: 'iscritto', statoDal: oggiIso(), richiamareIl: null, updatedDate: new Date() })
				.where(eq(trattative.id, trattativa.id));
			await tx.insert(attivita).values({
				personaId: trattativa.personaId, trattativaId: trattativa.id, tipo: 'iscrizione',
				esito: giaSocio ? 'riattivato' : 'nuovo', autoreId: request.utente.sub, autoreNome,
			});
			return { socio, riattivato: Boolean(giaSocio) };
		});

		if (!esito) return reply.code(404).send({ error: 'Il contatto non esiste più: forse è già stato iscritto.' });
		await registra(request.utente, {
			tipoAzione: esito.riattivato ? 'activate' : 'create', entitaTipo: 'member', entitaNome: esito.socio.fullName, entitaId: esito.socio.id,
			dettagli: esito.riattivato ? 'Tornato socio da un contatto (lead)' : 'Socio nato da un contatto (lead)',
		}, request.log);
		reply.code(201);
		return { member: translateToSnakeCase(members, esito.socio), riattivato: esito.riattivato };
	});
}

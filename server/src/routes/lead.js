// Il lavoro sui lead: le azioni che ne cambiano lo stato, il loro diario, la trasformazione in
// socio, e quanto è usato ogni canale.
//
// Lo stato di un lead (shared/lead.js) non si scrive dall'endpoint generico: lo cambiano solo le
// azioni qui sotto, ognuna in una transazione che aggiorna il lead e ne scrive il diario.
//
// L'anagrafica dei lead si scrive dall'endpoint generico come ogni altra. La trasformazione no:
// sono due scritture che devono succedere insieme — nasce il socio, sparisce il contatto — e
// fatte dal browser in due chiamate basterebbe che la seconda fallisca per avere la stessa
// persona due volte, una da socio e una da contatto ancora da richiamare.
import { and, asc, count, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, members, leadAttivita, staffAccounts, canaliContatto } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity, canWriteEntity } from '../auth/authorize.js';
import { translateToJs, translateToSnakeCase, translateManyToSnakeCase } from '../entities/columnMaps.js';
import { anagraficaSocio } from '../entities/hooks.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { oggiIso } from '../../../shared/abbonamenti.js';
import { registra } from '../lib/registro.js';
import { spostaGiorni } from '../../../shared/giorni.js';
import {
	applicaAzione, contaFiltriLead, SOGLIE_LEAD, statoLead, etichettaCanaleContatto, etichettaMotivoChiusura,
	NOTE_LEAD_MASSIMO,
} from '../../../shared/lead.js';

const AUTORE_SISTEMA = 'Sistema';

// Le azioni con cui si lavora un lead, e cosa prendono dal corpo della richiesta.
const AZIONI = {
	contatto: (c) => ({ tipo: 'contatto', canale: c.canale, esito: c.esito }),
	richiamo: (c) => ({ tipo: 'richiamo', data: c.data }),
	chiudi: (c) => ({ tipo: 'chiudi', motivo: c.motivo, nota: c.nota }),
	riapri: () => ({ tipo: 'riapri' }),
};

/** Una riga del registro per un'azione: "Contattato via Telefono: non ha risposto". */
function descriviAzione(attivita) {
	switch (attivita.tipo) {
		case 'tentativo': return `Contattato via ${etichettaCanaleContatto(attivita.canale)}: non ha risposto`;
		case 'risposta': return `Contattato via ${etichettaCanaleContatto(attivita.canale)}: ha risposto`;
		case 'richiamo': return `Da richiamare il ${attivita.esito}`;
		case 'chiusura': return `Non interessato: ${etichettaMotivoChiusura(attivita.esito)}`;
		case 'riapertura': return 'Riaperto';
		default: return attivita.tipo;
	}
}

// Quello che la finestra di trasformazione può scrivere sul socio. Il codice socio, i consensi
// marketing e le date di sistema restano fuori: il codice lo assegna il contatore, e il
// consenso marketing lo darà il socio stesso dal portale.
const CAMPI_SOCIO = [
	'nome', 'cognome', 'sesso', 'codice_fiscale', 'email', 'phone', 'date_of_birth', 'address',
	'emergency_contact_name', 'emergency_contact_phone', 'gdpr_consent', 'notes',
];

export default async function leadRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		request.utente = utente;
	});

	// Si toccano due aree: si cancella un lead e si crea un socio. Serve poterle scrivere
	// entrambe, altrimenti la reception che gestisce i contatti ma non i soci potrebbe
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
	 * GET /api/lead/lavoro → { leads, conteggi }
	 *
	 * I lead con il loro stato, e quanti ce ne sono per ogni filtro rapido. Prima di rispondere
	 * chiude come *non raggiungibili* quelli che hanno superato le soglie (troppi tentativi di
	 * fila senza risposta, e l'ultimo abbastanza lontano): è il primo automatismo, e gira qui —
	 * alla lettura — invece che in un processo programmato che prima o poi non parte. È
	 * idempotente: un lead già chiuso non rientra nella condizione.
	 */
	fastify.get('/api/lead/lavoro', { preHandler: puoLeggere }, async () => {
		const oggi = oggiIso();
		const limite = spostaGiorni(oggi, -SOGLIE_LEAD.nonRaggiungibileGiorni);
		await db.transaction(async (tx) => {
			const chiusi = await tx.update(leads)
				.set({ stato: 'non_raggiungibile', statoDal: oggi, updatedDate: new Date() })
				.where(and(
					eq(leads.stato, 'in_attesa'),
					gte(leads.tentativiSenzaRisposta, SOGLIE_LEAD.tentativiMassimi),
					lte(leads.ultimoContattoIl, limite),
				))
				.returning({ id: leads.id, tentativi: leads.tentativiSenzaRisposta });
			if (chiusi.length) {
				await tx.insert(leadAttivita).values(chiusi.map((l) => ({
					leadId: l.id, tipo: 'stato_automatico', esito: 'non_raggiungibile', autoreNome: AUTORE_SISTEMA,
					nota: `${l.tentativi} tentativi senza risposta, l'ultimo da almeno ${SOGLIE_LEAD.nonRaggiungibileGiorni} giorni`,
				})));
			}
		});
		const righe = translateManyToSnakeCase(leads, await db.select().from(leads).orderBy(desc(leads.dataContatto)));
		return { leads: righe, conteggi: contaFiltriLead(righe, oggi) };
	});

	/**
	 * GET /api/lead/andamento → { righe, canali }
	 *
	 * Le righe di Andamento: una per persona che ci ha contattato, con dove è finita. I lead sono
	 * aperti o persi; i soci nati da un contatto (che hanno canale e giorno del primo contatto)
	 * sono le conversioni. Escono solo i campi che servono ai conti — niente nomi, niente
	 * recapiti: chi guarda i lead non legge per forza l'anagrafica dei soci.
	 */
	fastify.get('/api/lead/andamento', { preHandler: puoLeggere }, async () => {
		const [contatti, soci, elencoCanali] = await Promise.all([
			db.select({
				data: leads.dataContatto, canale: leads.canaleId, sesso: leads.sesso, nascita: leads.annoNascita,
				stato: leads.stato, motivo: leads.motivoChiusura,
			}).from(leads),
			db.select({
				data: members.leadDataContatto, canale: members.leadCanaleId, sesso: members.sesso,
				nascita: members.dateOfBirth, dal: members.createdDate,
			}).from(members).where(isNotNull(members.leadCanaleId)),
			db.select({ id: canaliContatto.id, nome: canaliContatto.nome, attivo: canaliContatto.attivo }).from(canaliContatto),
		]);
		const righe = [
			...contatti.map((l) => {
				const aperto = statoLead(l.stato).aperto;
				return {
					data_contatto: l.data, canale_id: l.canale, sesso: l.sesso, anno_nascita: l.nascita,
					esito: aperto ? 'aperto' : 'perso',
					motivo: aperto ? null : (l.stato === 'non_raggiungibile' ? 'non_raggiungibile' : l.motivo),
					socio_dal: null,
				};
			}),
			...soci.filter((s) => s.data).map((s) => ({
				data_contatto: s.data, canale_id: s.canale, sesso: s.sesso,
				anno_nascita: s.nascita ? Number(String(s.nascita).slice(0, 4)) : null,
				esito: 'socio', motivo: null, socio_dal: new Date(s.dal).toISOString().slice(0, 10),
			})),
		];
		return { righe, canali: elencoCanali };
	});

	/** GET /api/lead/:id/attivita → { attivita }: il diario, dal più vecchio. */
	fastify.get('/api/lead/:id/attivita', { preHandler: puoLeggere }, async (request) => {
		const righe = await db.select().from(leadAttivita)
			.where(eq(leadAttivita.leadId, request.params.id))
			.orderBy(asc(leadAttivita.createdDate));
		return { attivita: translateManyToSnakeCase(leadAttivita, righe) };
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

		const [autore] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		const esito = await db.transaction(async (tx) => {
			const [riga] = await tx.select().from(leads).where(eq(leads.id, request.params.id)).limit(1).for('update');
			if (!riga) return { errore: 404, messaggio: 'Il contatto non esiste più.' };
			const lead = translateToSnakeCase(leads, riga);
			const risultato = applicaAzione(lead, { ...leggi(corpo), nota }, oggiIso());
			if (risultato.errore) return { errore: 400, messaggio: risultato.errore };

			const [aggiornato] = await tx.update(leads)
				.set({ ...translateToJs(leads, risultato.campi), updatedDate: new Date() })
				.where(eq(leads.id, riga.id))
				.returning();
			await tx.insert(leadAttivita).values({
				leadId: riga.id, ...translateToJs(leadAttivita, risultato.attivita), nota,
				autoreId: request.utente.sub, autoreNome: autore?.nome ?? '',
			});
			return { lead: translateToSnakeCase(leads, aggiornato), attivita: risultato.attivita, nome: riga.nome, cognome: riga.cognome };
		});
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });

		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'lead', entitaNome: `${esito.nome} ${esito.cognome}`, entitaId: esito.lead.id,
			dettagli: `${descriviAzione(esito.attivita)} → ${statoLead(esito.lead.stato).etichetta}`,
		}, request.log);
		return { lead: esito.lead };
	});

	/**
	 * GET /api/lead/canali/uso → { [idCanale]: { contatti, soci } }
	 *
	 * Un canale si elimina solo se non lo cita nessuno: né un contatto, né un socio che da lì è
	 * arrivato. I contatti la pagina potrebbe contarli da sé, i soci no — chi gestisce i lead
	 * non legge per forza l'anagrafica dei soci — e comunque qui escono solo dei numeri.
	 */
	fastify.get('/api/lead/canali/uso', async (request, reply) => {
		if (!canReadEntity(request.utente.ruolo, 'CanaleContatto')) return reply.code(403).send({ error: 'Non consentito.' });
		const [perContatti, perSoci] = await Promise.all([
			db.select({ id: leads.canaleId, n: count() }).from(leads).groupBy(leads.canaleId),
			db.select({ id: members.leadCanaleId, n: count() }).from(members)
				.where(isNotNull(members.leadCanaleId)).groupBy(members.leadCanaleId),
		]);
		const uso = {};
		const voce = (id) => (uso[id] ??= { contatti: 0, soci: 0 });
		for (const r of perContatti) voce(r.id).contatti = Number(r.n);
		for (const r of perSoci) voce(r.id).soci = Number(r.n);
		return uso;
	});

	/**
	 * POST /api/lead/:id/trasforma  { nome, cognome, sesso, codice_fiscale, … }
	 *
	 * Il corpo è l'anagrafica del socio così come la finestra l'ha completata, non il lead:
	 * nome e cognome si possono correggere passando, e il codice fiscale il lead non ce l'ha.
	 * Vale la stessa regola del modulo dei soci (`anagraficaSocio`), CF obbligatorio compreso.
	 */
	fastify.post('/api/lead/:id/trasforma', { preHandler: puoTrasformare }, async (request, reply) => {
		const corpo = Object.fromEntries(
			CAMPI_SOCIO.filter((c) => c in (request.body ?? {})).map((c) => [c, request.body[c]])
		);
		const anagrafica = anagraficaSocio(corpo, { creazione: true });
		if (anagrafica.gdpr_consent === true) anagrafica.gdpr_consent_date = oggiIso();

		const socio = await db.transaction(async (tx) => {
			const [lead] = await tx.select().from(leads).where(eq(leads.id, request.params.id)).limit(1).for('update');
			// Già trasformato — da un collega, o da un doppio clic — oppure cancellato.
			if (!lead) return null;

			const codiceSocio = await assegnaCodiceSocio(tx);

			// Il socio ricorda da dove è arrivato: il lead sta per sparire, e con lui l'unica
			// traccia di quale canale porta iscritti (vedi Andamento).
			const [creato] = await tx
				.insert(members)
				.values({
					...translateToJs(members, anagrafica), codiceSocio,
					leadCanaleId: lead.canaleId, leadDataContatto: lead.dataContatto,
				})
				.returning();
			await tx.delete(leads).where(eq(leads.id, lead.id));
			return creato;
		});

		if (!socio) return reply.code(404).send({ error: 'Il contatto non esiste più: forse è già stato trasformato.' });
		await registra(getUserFromRequest(request), {
			tipoAzione: 'create', entitaTipo: 'member', entitaNome: socio.fullName, entitaId: socio.id,
			dettagli: 'Socio nato da un contatto (lead)',
		}, request.log);
		reply.code(201);
		return { member: translateToSnakeCase(members, socio) };
	});
}

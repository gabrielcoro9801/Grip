// Un lead diventa socio, e quanto è usato ogni canale.
//
// L'anagrafica dei lead si scrive dall'endpoint generico come ogni altra. La trasformazione no:
// sono due scritture che devono succedere insieme — nasce il socio, sparisce il contatto — e
// fatte dal browser in due chiamate basterebbe che la seconda fallisca per avere la stessa
// persona due volte, una da socio e una da contatto ancora da richiamare.
import { count, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, members } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canReadEntity, canWriteEntity } from '../auth/authorize.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { anagraficaSocio } from '../entities/hooks.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { oggiIso } from '../../../shared/abbonamenti.js';
import { registra } from '../lib/registro.js';

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

// Le cose che succedono a un lead: una nota, un passaggio di stato, una prova, l'iscrizione.
//
// L'anagrafica del lead si scrive dall'endpoint generico come ogni altra. Queste no, e per la
// stessa ragione delle prenotazioni: non sono una riga da salvare, sono un fatto con delle
// conseguenze. Prenotare una prova occupa un posto in sala, cambia lo stato del lead e ne
// allunga la cronologia; iscriverlo crea un socio, gli dà un codice e gli passa le
// prenotazioni. Fatte dal browser in tre chiamate, basterebbe che la seconda fallisca per
// avere un lead "iscritto" senza nessun socio, o una prova in sala che nessuno sa di chi è.
// Qui ogni operazione è una transazione: o succede tutto, o niente.
import { eq, and, ne, gte, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { leads, leadAttivita, members, bookings, sessions, events, courses, organizations, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { prenota, disdici } from '../lib/prenotazioni.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import {
	transizioneConsentita, puoPrenotareProva, puoConvertire, statoDopoEsito,
	motivoValido, etichettaStato, etichettaMotivo, TIPI_ATTIVITA_MANUALI,
} from '../../../shared/lead.js';

const oggi = () => new Date().toISOString().slice(0, 10);

/** Un esito da restituire senza scrivere niente: dentro una transazione, la annulla. */
class Rifiuto extends Error {
	constructor(codice, messaggio, extra = {}) {
		super(messaggio);
		this.codice = codice;
		this.extra = extra;
	}
}

async function leadBloccato(tx, id) {
	const [lead] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1).for('update');
	if (!lead) throw new Rifiuto(404, 'Lead inesistente.');
	return lead;
}

async function annota(tx, leadId, tipo, testo, autore) {
	await tx.insert(leadAttivita).values({ leadId, tipo, testo, autoreId: autore.id, autoreNome: autore.nome });
}

async function cambiaStato(tx, lead, stato, extra = {}) {
	const [aggiornato] = await tx
		.update(leads)
		.set({ stato, ...extra, updatedDate: new Date() })
		.where(eq(leads.id, lead.id))
		.returning();
	return aggiornato;
}

const comeLead = (riga) => translateToSnakeCase(leads, riga);

/** "Yoga, 18/09 alle 09:00" */
async function descriviLezione(tx, sessionId) {
	const [r] = await tx
		.select({ data: sessions.date, inizio: sessions.startTime, corso: courses.name })
		.from(sessions)
		.innerJoin(events, eq(sessions.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.where(eq(sessions.id, sessionId))
		.limit(1);
	if (!r) return 'lezione';
	const [, m, g] = String(r.data).split('-');
	return `${r.corso}, ${g}/${m} alle ${String(r.inizio).slice(0, 5)}`;
}

export default async function leadRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		// Tutte le rotte qui scrivono: serve il permesso di modificare i lead. Il socio non ce
		// l'ha mai, per costruzione della matrice.
		if (!canWriteEntity(utente.ruolo, 'Lead')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa modifica.' });
		}
		// L'autore della cronologia si legge dall'account, non dal corpo della richiesta.
		const [account] = await db
			.select({ id: staffAccounts.id, nome: staffAccounts.nome })
			.from(staffAccounts)
			.where(eq(staffAccounts.id, utente.sub))
			.limit(1);
		request.autore = { id: account?.id ?? null, nome: account?.nome ?? '' };
	});

	// Traduce i rifiuti in risposte; il resto va al gestore degli errori del database.
	async function esegui(reply, operazione) {
		try {
			return await db.transaction(operazione);
		} catch (errore) {
			if (errore instanceof Rifiuto) {
				return reply.code(errore.codice).send({ error: errore.message, ...errore.extra });
			}
			throw errore;
		}
	}

	/** Una nota, una chiamata fatta, un incontro. */
	fastify.post('/api/lead/:id/attivita', async (request, reply) => {
		const tipo = request.body?.tipo;
		const testo = String(request.body?.testo ?? '').trim();
		if (!TIPI_ATTIVITA_MANUALI.includes(tipo)) return reply.code(400).send({ error: 'Tipo di attività non valido.' });
		if (!testo) return reply.code(400).send({ error: 'Scrivi cosa è successo.' });

		return esegui(reply, async (tx) => {
			const lead = await leadBloccato(tx, request.params.id);
			await annota(tx, lead.id, tipo, testo, request.autore);
			reply.code(201);
			return { ok: true };
		});
	});

	/** Un passaggio di stato fatto a mano: contattato, proposta, perso. */
	fastify.post('/api/lead/:id/stato', async (request, reply) => {
		const { stato, motivo_perdita: motivo = null } = request.body ?? {};

		return esegui(reply, async (tx) => {
			const lead = await leadBloccato(tx, request.params.id);
			if (!transizioneConsentita(lead.stato, stato)) {
				throw new Rifiuto(400, `Da "${etichettaStato(lead.stato)}" non si passa a "${etichettaStato(stato)}".`);
			}
			if (stato === 'perso' && !motivoValido(motivo)) {
				throw new Rifiuto(400, 'Indica perché il contatto si è perso.');
			}

			const aggiornato = await cambiaStato(tx, lead, stato, {
				motivoPerdita: stato === 'perso' ? motivo : null,
				// Un contatto perso non si richiama: lasciargli la prossima azione lo terrebbe
				// fra quelli da ricontattare.
				...(stato === 'perso' ? { prossimaAzioneIl: null, prossimaAzioneNota: null } : {}),
			});
			const testo = `${etichettaStato(lead.stato)} → ${etichettaStato(stato)}${stato === 'perso' ? ` (${etichettaMotivo(motivo)})` : ''}`;
			await annota(tx, lead.id, 'cambio_stato', testo, request.autore);
			return { lead: comeLead(aggiornato) };
		});
	});

	/** Prenota una prova in una lezione vera: occupa un posto come qualsiasi prenotazione. */
	fastify.post('/api/lead/:id/prova', async (request, reply) => {
		const sessionId = request.body?.session_id;
		if (!sessionId) return reply.code(400).send({ error: 'Manca la lezione.' });

		return esegui(reply, async (tx) => {
			const lead = await leadBloccato(tx, request.params.id);
			if (!puoPrenotareProva(lead.stato)) {
				throw new Rifiuto(400, `A un lead "${etichettaStato(lead.stato)}" non si prenota una prova.`);
			}

			const esito = await prenota({ sessionId, leadId: lead.id }, tx);
			if (esito.errore) throw new Rifiuto(esito.errore, esito.messaggio);

			const aggiornato = await cambiaStato(tx, lead, 'prova_prenotata');
			const attesa = esito.creata.status === 'waitlisted' ? ` — in lista d'attesa (${esito.creata.waitlistPosition}°)` : '';
			await annota(tx, lead.id, 'prova', `Prova prenotata: ${await descriviLezione(tx, sessionId)}${attesa}`, request.autore);

			reply.code(201);
			return { booking: translateToSnakeCase(bookings, esito.creata), lead: comeLead(aggiornato) };
		});
	});

	/**
	 * Disdice una prova.
	 *
	 * Libera il posto con la stessa regola di ogni disdetta (chi è in lista d'attesa sale), e
	 * se era l'ultima prova in programma il lead torna a "contattato": restare in "prova
	 * prenotata" senza nessuna prova lo terrebbe fuori da chi va richiamato.
	 */
	fastify.post('/api/lead/:id/prova/:bookingId/disdici', async (request, reply) => {
		return esegui(reply, async (tx) => {
			const lead = await leadBloccato(tx, request.params.id);
			const [prova] = await tx
				.select({ id: bookings.id, sessionId: bookings.sessionId, status: bookings.status })
				.from(bookings)
				.where(and(eq(bookings.id, request.params.bookingId), eq(bookings.leadId, lead.id)))
				.limit(1);
			if (!prova) throw new Rifiuto(404, 'Prova inesistente.');
			if (prova.status === 'cancelled') throw new Rifiuto(400, 'La prova era già disdetta.');

			const esito = await disdici({ bookingId: prova.id }, tx);
			if (esito.errore) throw new Rifiuto(esito.errore, esito.messaggio);

			const [altra] = await tx
				.select({ id: bookings.id })
				.from(bookings)
				.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
				.where(and(eq(bookings.leadId, lead.id), ne(bookings.status, 'cancelled'), gte(sessions.date, oggi())))
				.limit(1);
			const aggiornato = lead.stato === 'prova_prenotata' && !altra
				? await cambiaStato(tx, lead, 'contattato')
				: lead;

			await annota(tx, lead.id, 'prova', `Prova disdetta: ${await descriviLezione(tx, prova.sessionId)}`, request.autore);
			return { lead: comeLead(aggiornato), promosso: Boolean(esito.promossa) };
		});
	});

	/**
	 * Se la persona si è presentata alla prova.
	 *
	 * Lo stato del lead segue l'esito solo se è ancora nella fase della prova: a chi ha già
	 * ricevuto una proposta, segnare in ritardo la presenza a una prova vecchia non deve
	 * farlo tornare indietro.
	 */
	fastify.post('/api/lead/:id/prova/:bookingId/esito', async (request, reply) => {
		const presenza = request.body?.presenza;
		const nuovoStato = statoDopoEsito(presenza);
		if (!nuovoStato) return reply.code(400).send({ error: 'Indica se la persona era presente o assente.' });

		return esegui(reply, async (tx) => {
			const lead = await leadBloccato(tx, request.params.id);
			const [prova] = await tx
				.select({ booking: bookings, data: sessions.date })
				.from(bookings)
				.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
				.where(and(eq(bookings.id, request.params.bookingId), eq(bookings.leadId, lead.id)))
				.limit(1)
				.for('update', { of: bookings });
			if (!prova) throw new Rifiuto(404, 'Prova inesistente.');
			if (prova.booking.status === 'cancelled') throw new Rifiuto(400, 'La prova è stata disdetta.');
			if (String(prova.data) > oggi()) throw new Rifiuto(400, 'La prova non c\'è ancora stata.');

			await tx.update(bookings).set({ presenza }).where(eq(bookings.id, prova.booking.id));

			const segue = presenza === 'presente'
				? ['nuovo', 'contattato', 'prova_prenotata'].includes(lead.stato)
				: lead.stato === 'prova_prenotata';
			const aggiornato = segue ? await cambiaStato(tx, lead, nuovoStato) : lead;

			const lezione = await descriviLezione(tx, prova.booking.sessionId);
			await annota(tx, lead.id, 'prova', `${presenza === 'presente' ? 'Presente' : 'Assente'} alla prova: ${lezione}`, request.autore);
			return { lead: comeLead(aggiornato), presenza };
		});
	});

	/**
	 * Il lead diventa socio.
	 *
	 * Le prove già passate restano al lead: sono la storia di come è arrivato, e la
	 * conversione prova → socio si calcola da lì. Le prenotazioni future passano al socio,
	 * perché da domani in sala ci viene lui — e nel portale deve vederle come sue.
	 */
	fastify.post('/api/lead/:id/converti', async (request, reply) => {
		return esegui(reply, async (tx) => {
			const lead = await leadBloccato(tx, request.params.id);
			if (lead.stato === 'iscritto') {
				throw new Rifiuto(409, 'Questo lead è già diventato socio.', { member_id: lead.convertitoMemberId });
			}
			if (!puoConvertire(lead.stato)) throw new Rifiuto(400, 'Questo lead non si può convertire.');

			const [ente] = await tx.select({ id: organizations.id }).from(organizations).limit(1);
			const codiceSocio = ente ? await assegnaCodiceSocio(tx, ente.id) : null;

			const [socio] = await tx
				.insert(members)
				.values({
					fullName: lead.fullName,
					email: lead.email,
					phone: lead.phone,
					gdprConsent: lead.consensoPrivacy,
					gdprConsentDate: lead.consensoPrivacyData,
					consensoMarketing: lead.consensoMarketing,
					consensoMarketingData: lead.consensoMarketingData,
					codiceSocio,
					notes: lead.obiettivo ? `Obiettivo dichiarato: ${lead.obiettivo}` : null,
				})
				.returning();

			const future = await tx
				.select({ id: bookings.id })
				.from(bookings)
				.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
				.where(and(eq(bookings.leadId, lead.id), ne(bookings.status, 'cancelled'), gte(sessions.date, oggi())));
			if (future.length) {
				await tx
					.update(bookings)
					.set({ memberId: socio.id, leadId: null, memberName: socio.fullName })
					.where(inArray(bookings.id, future.map((f) => f.id)));
			}

			const aggiornato = await cambiaStato(tx, lead, 'iscritto', {
				convertitoMemberId: socio.id,
				convertitoIl: new Date(),
				motivoPerdita: null,
				prossimaAzioneIl: null,
				prossimaAzioneNota: null,
			});
			const spostate = future.length ? ` — ${future.length} prenotazion${future.length === 1 ? 'e passata' : 'i passate'} al socio` : '';
			await annota(
				tx, lead.id, 'cambio_stato',
				`${etichettaStato(lead.stato)} → Iscritto${codiceSocio ? ` (socio ${codiceSocio})` : ''}${spostate}`,
				request.autore,
			);

			reply.code(201);
			return {
				member: translateToSnakeCase(members, socio),
				lead: comeLead(aggiornato),
				prenotazioni_spostate: future.length,
			};
		});
	});
}

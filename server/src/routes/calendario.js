// Togliere lezioni dal calendario e cambiare la data fine di una serie.
//
// Non passano dall'endpoint generico perché sono operazioni su molte righe insieme — lezioni,
// prenotazioni, evento, avvisi ai soci — che devono riuscire tutte o nessuna. Le regole stanno
// in lib/calendario.js; qui si decide *quali* lezioni toccare.
//
// Ogni rotta accetta `anteprima: true`: fa gli stessi conti e non scrive niente, così la finestra
// può dire "8 lezioni, 2 con prenotati: 5 soci riceveranno un avviso" prima della conferma.
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { events, sessions, courses, rooms } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { conSaleBloccate } from '../lib/sale.js';
import { dateGiuste } from '../lib/dateSettimanali.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import {
	giornoDellaSettimana, daTenere, pianoRimozione, contiRimozione, applicaRimozione, descriviConti, hhmm,
} from '../lib/calendario.js';
import { oggiIso, eUnGiorno, lezioneFinita } from '../../../shared/giorni.js';
import { applicaFisse } from '../lib/prenotazioniFisse.js';
import { motivoSalaNonPrenotabile, dataIt } from '../../../shared/sale.js';

// Lo stesso tetto della creazione (EventFormDialog): una serie allungata di colpo di due anni è
// quasi sempre una data sbagliata.
const MASSIMO_LEZIONI_NUOVE = 104;

class Rifiuto extends Error {
	constructor(codice, messaggio) { super(messaggio); this.codice = codice; }
}

export default async function calendarioRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (!canWriteEntity(utente.ruolo, 'Session') || !canWriteEntity(utente.ruolo, 'Event')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente di modificare il calendario.' });
		}
		request.utente = utente;
	});

	const rispondi = async (reply, lavoro) => {
		try {
			return await lavoro();
		} catch (err) {
			if (err instanceof Rifiuto) return reply.code(err.codice).send({ error: err.message });
			throw err;
		}
	};

	/**
	 * POST /api/calendario/elimina
	 *   { lezione_id, ambito: 'lezione' | 'serie', giorni?: ['Monday', …], anteprima? }
	 * → { eliminate, annullate, soci_avvisati, evento_eliminato }
	 *
	 * Come la modifica: la lezione cliccata, oppure tutta la serie da oggi in poi, e di una serie
	 * settimanale solo nei giorni scelti. Se all'evento non resta nessuna lezione, sparisce anche
	 * lui; se si è tolta la serie in tutti i suoi giorni, la sua data fine diventa l'ultima lezione
	 * rimasta, così il riepilogo e un'eventuale proroga ripartono da lì.
	 */
	fastify.post('/api/calendario/elimina', (request, reply) => rispondi(reply, async () => {
		const { lezione_id: idLezione, ambito, giorni, anteprima } = request.body ?? {};
		if (!['lezione', 'serie'].includes(ambito)) throw new Rifiuto(400, 'Scegli se eliminare la lezione o la serie.');

		const esito = await db.transaction(async (tx) => {
			const [lezione] = idLezione
				? await tx.select().from(sessions).where(eq(sessions.id, idLezione)).limit(1)
				: [];
			if (!lezione) throw new Rifiuto(404, 'La lezione non esiste più: forse è già stata eliminata.');
			const [evento] = await tx.select().from(events).where(eq(events.id, lezione.eventId)).limit(1).for('update');
			const [corso] = await tx.select({ nome: courses.name }).from(courses).where(eq(courses.id, evento.courseId)).limit(1);
			const nomeCorso = corso?.nome ?? 'corso';

			const giorniSerie = evento.recurrenceType === 'weekly' ? (evento.daysOfWeek ?? []) : [];
			const filtro = ambito === 'serie' && evento.recurrenceType === 'weekly' && Array.isArray(giorni) && giorni.length
				? new Set(giorni) : null;
			const tuttiIGiorni = !filtro || giorniSerie.every((g) => filtro.has(g));

			let bersaglio;
			if (ambito === 'lezione') {
				if (lezione.status !== 'active') throw new Rifiuto(400, 'La lezione è già annullata.');
				if (lezioneFinita({ date: lezione.date, end_time: lezione.endTime })) {
					throw new Rifiuto(400, 'La lezione è già finita: resta nello storico.');
				}
				bersaglio = [lezione];
			} else {
				const daOggi = await tx.select().from(sessions)
					.where(and(eq(sessions.eventId, evento.id), eq(sessions.status, 'active'), gte(sessions.date, oggiIso())));
				bersaglio = daOggi.filter(daTenere).filter((l) => !filtro || filtro.has(giornoDellaSettimana(l.date)));
				if (!bersaglio.length) throw new Rifiuto(400, 'Nella serie non ci sono lezioni da togliere da oggi in poi.');
			}

			const piano = await pianoRimozione(tx, bersaglio);
			const conti = contiRimozione(piano);
			if (anteprima) return { conti, evento_eliminato: false };

			await applicaRimozione(tx, piano, nomeCorso);

			const rimaste = await tx.select({ date: sessions.date, status: sessions.status }).from(sessions)
				.where(eq(sessions.eventId, evento.id));
			let eventoEliminato = false;
			if (rimaste.length === 0) {
				await tx.delete(events).where(eq(events.id, evento.id));
				eventoEliminato = true;
			} else if (ambito === 'serie' && evento.recurrenceType === 'weekly' && tuttiIGiorni) {
				const ultima = rimaste.filter((r) => r.status === 'active').map((r) => r.date).sort().pop();
				if (ultima) {
					await tx.update(events)
						.set({ endCondition: 'by_date', endDate: ultima, occurrenceCount: null })
						.where(eq(events.id, evento.id));
				}
			}
			return { conti, evento_eliminato: eventoEliminato, evento, nomeCorso, lezione };
		});

		if (!anteprima) {
			const cosa = ambito === 'lezione'
				? `Lezione del ${dataIt(esito.lezione.date)} alle ${hhmm(esito.lezione.startTime)}`
				: 'Serie da oggi in poi';
			await registra(request.utente, {
				tipoAzione: 'delete', entitaTipo: 'event', entitaNome: esito.nomeCorso, entitaId: esito.evento.id,
				dettagli: `${cosa}: ${descriviConti(esito.conti)}${esito.evento_eliminato ? '; evento rimosso dal calendario' : ''}`,
			}, request.log);
		}
		return { ...esito.conti, evento_eliminato: esito.evento_eliminato };
	}));

	/**
	 * POST /api/calendario/eventi/:id/data-fine
	 *   { end_date, salta?: ['2026-11-03', …], anteprima? }
	 * → { aggiunte, eliminate, annullate, soci_avvisati }
	 *   in anteprima anche { nuove: [date], saltate_sala: [{ date, motivo }], modello }
	 *
	 * Spostarla avanti genera le lezioni mancanti col modello dell'evento (sala, orari, capienza);
	 * spostarla indietro toglie quelle oltre la nuova data con le regole di sempre. Una serie
	 * contata a occorrenze diventa "fino a una data".
	 *
	 * Le sovrapposizioni con altre lezioni le controlla la finestra, come in creazione, e manda
	 * in `salta` le date che si è deciso di non creare. Le date in cui la sala è chiusa le salta
	 * il server: lì una lezione non può proprio esistere.
	 */
	fastify.post('/api/calendario/eventi/:id/data-fine', (request, reply) => rispondi(reply, async () => {
		const { end_date: fine, salta = [], anteprima } = request.body ?? {};
		if (!eUnGiorno(fine)) throw new Rifiuto(400, 'La data fine non è valida.');
		const oggi = oggiIso();

		const [base] = await db.select({ roomId: events.roomId }).from(events).where(eq(events.id, request.params.id)).limit(1);
		if (!base) throw new Rifiuto(404, "L'evento non esiste più.");

		// La sala resta ferma mentre si generano lezioni dentro di lei: una sospensione decisa in
		// quel momento da un collega le vedrebbe, invece di passarci sopra (lib/sale.js).
		const esito = await conSaleBloccate([base.roomId], () => db.transaction(async (tx) => {
			const [evento] = await tx.select().from(events).where(eq(events.id, request.params.id)).limit(1).for('update');
			if (evento.recurrenceType !== 'weekly') throw new Rifiuto(400, 'La data fine si cambia solo nelle serie settimanali.');
			if (fine < evento.startDate) throw new Rifiuto(400, "La data fine non può precedere l'inizio della serie.");
			if (fine < oggi) {
				throw new Rifiuto(400, 'La data fine non può essere nel passato: per togliere le lezioni rimaste usa Elimina.');
			}
			const [corso] = await tx.select({ nome: courses.name }).from(courses).where(eq(courses.id, evento.courseId)).limit(1);
			const [sala] = await tx.select().from(rooms).where(eq(rooms.id, evento.roomId)).limit(1);
			const lezioni = await tx.select().from(sessions).where(eq(sessions.eventId, evento.id));

			// Accorciando: le lezioni ancora da tenere oltre la nuova fine.
			const daTogliere = lezioni.filter((l) => l.date > fine).filter(daTenere);

			// Allungando: le date della regola dopo l'ultima lezione che la serie abbia mai avuto,
			// annullate comprese — una lezione annullata non torna da sola — e da oggi in poi.
			const ultima = lezioni.map((l) => l.date).sort().pop() ?? '';
			const nuove = dateGiuste({
				days_of_week: evento.daysOfWeek, start_date: evento.startDate, end_condition: 'by_date', end_date: fine,
			}).filter((d) => d > ultima && d >= oggi);
			if (nuove.length > MASSIMO_LEZIONI_NUOVE) {
				throw new Rifiuto(400, `Così si aggiungerebbero ${nuove.length} lezioni: il massimo in una volta è ${MASSIMO_LEZIONI_NUOVE}.`);
			}
			const salaApi = sala && translateToSnakeCase(rooms, sala);
			const saltateSala = nuove
				.map((d) => ({ date: d, motivo: motivoSalaNonPrenotabile(salaApi, d, d) }))
				.filter((s) => s.motivo);
			const chiusa = new Set(saltateSala.map((s) => s.date));
			const daSaltare = new Set(Array.isArray(salta) ? salta : []);
			const daCreare = nuove.filter((d) => !chiusa.has(d) && !daSaltare.has(d));

			const piano = await pianoRimozione(tx, daTogliere);
			const conti = { aggiunte: daCreare.length, ...contiRimozione(piano) };
			if (anteprima) {
				return {
					conti,
					extra: {
						nuove: nuove.filter((d) => !chiusa.has(d)),
						saltate_sala: saltateSala,
						modello: {
							room_id: evento.roomId, start_time: hhmm(evento.startTime), end_time: hhmm(evento.endTime), capacity: evento.capacity,
						},
					},
				};
			}

			await applicaRimozione(tx, piano, corso?.nome ?? 'corso');
			if (daCreare.length) {
				await tx.insert(sessions).values(daCreare.map((date) => ({
					eventId: evento.id, date, startTime: evento.startTime, endTime: evento.endTime,
					roomId: evento.roomId, capacity: evento.capacity, status: 'active', modifiedManually: false,
				})));
			}
			const primaFine = evento.endCondition === 'by_date' ? evento.endDate : null;
			await tx.update(events)
				.set({ endCondition: 'by_date', endDate: fine, occurrenceCount: null })
				.where(eq(events.id, evento.id));
			return { conti, evento, nomeCorso: corso?.nome ?? '', primaFine };
		}));

		if (anteprima) return { ...esito.conti, ...esito.extra };
		const dettagli = [
			`Data fine ${esito.primaFine ? `dal ${dataIt(esito.primaFine)} ` : ''}al ${dataIt(fine)}`,
			esito.conti.aggiunte ? `aggiunte ${esito.conti.aggiunte} lezioni` : '',
			descriviConti(esito.conti),
		].filter(Boolean).join(', ');
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'event', entitaNome: esito.nomeCorso, entitaId: esito.evento.id, dettagli,
		}, request.log);
		// Le lezioni nuove di una serie allungata entrano nelle prenotazioni fisse di chi le ha.
		if (esito.conti.aggiunte) await applicaFisse({ eventId: esito.evento.id });
		return esito.conti;
	}));
}

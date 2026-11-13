// Il calendario: leggere le lezioni e le sessioni, controllare le sovrapposizioni, togliere
// lezioni e cambiare la data fine di una sessione.
//
// Le letture sono rotte dedicate perché ogni vista scarica solo quello che usa: il mese della
// griglia con i posti già contati, una lezione con le sue prenotazioni, le sessioni in corso. Prima
// il gestionale scaricava tutte le lezioni da tre mesi fa e tutte le prenotazioni, e contava nel
// browser.
//
// Togliere lezioni e cambiare la data fine non passano dall'endpoint generico perché sono
// operazioni su molte righe insieme — lezioni, prenotazioni, sessione, fisse, avvisi ai soci —
// che devono riuscire tutte o nessuna. Le regole stanno in lib/calendario.js; qui si decide
// *quali* lezioni toccare. Ogni rotta che scrive accetta `anteprima: true`: fa gli stessi conti e
// non scrive niente, così la finestra può dire "8 lezioni, 2 con prenotati: 5 soci riceveranno un
// avviso" prima della conferma.
import { and, asc, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	events, sessions, courses, rooms, categories, bookings, members, prenotazioniFisse,
} from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { canAccess } from '../../../shared/permissions.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { registra } from '../lib/registro.js';
import { conSaleBloccate } from '../lib/sale.js';
import { dateGiuste } from '../lib/dateSettimanali.js';
import { translateToSnakeCase } from '../entities/columnMaps.js';
import {
	daTenere, pianoRimozione, contiRimozione, applicaRimozione, descriviConti, hhmm, conflitti,
} from '../lib/calendario.js';
import { oggiIso, eUnGiorno, lezioneFinita, giorniFra } from '../../../shared/giorni.js';
import { applicaFisse, chiudiFisseSenzaLezioni, fissaInCorso } from '../lib/prenotazioniFisse.js';
import { motivoSalaNonPrenotabile, dataIt } from '../../../shared/sale.js';

// Lo stesso tetto della creazione (EventFormDialog): una serie allungata di colpo di due anni è
// quasi sempre una data sbagliata.
const MASSIMO_LEZIONI_NUOVE = 104;
// La griglia del mese è di 42 giorni: tre mesi bastano a qualunque vista, e fermano chi chiede
// "dal 2000 al 2100".
const MASSIMO_GIORNI_LETTI = 92;
const MASSIMO_DATE_CONFLITTI = 200;
const E_UN_ORARIO = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

class Rifiuto extends Error {
	constructor(codice, messaggio) { super(messaggio); this.codice = codice; }
}

/** Una sessione (riga di `events`) come la leggono le schermate. */
const sessioneApi = (e) => ({
	id: e.id, course_id: e.courseId, recurrence_type: e.recurrenceType, giorno: e.giorno,
	start_date: e.startDate, end_condition: e.endCondition, end_date: e.endDate, occurrence_count: e.occurrenceCount,
	start_time: hhmm(e.startTime), end_time: hhmm(e.endTime), room_id: e.roomId, capacity: e.capacity,
});

/** Le colonne di una lezione nel calendario: lezione, corso, categoria e la sua sessione. */
const COLONNE_LEZIONE = {
	lezione: sessions,
	sessione: events,
	corso: { id: courses.id, nome: courses.name, instructorId: courses.instructorId, categoriaId: courses.categoryId },
	colore: categories.color,
};

/** Quante prenotazioni confermate e in attesa ha ogni lezione: Map<id, { confermati, in_attesa }>. */
async function postiContati(idLezioni) {
	if (!idLezioni.length) return new Map();
	const righe = await db.select({
		id: bookings.sessionId,
		confermati: sql`count(*) filter (where ${bookings.status} = 'confirmed')`.mapWith(Number),
		inAttesa: sql`count(*) filter (where ${bookings.status} = 'waitlisted')`.mapWith(Number),
	}).from(bookings).where(inArray(bookings.sessionId, idLezioni)).groupBy(bookings.sessionId);
	return new Map(righe.map((r) => [r.id, { confermati: r.confermati, in_attesa: r.inAttesa }]));
}

const lezioneApi = ({ lezione, sessione, corso, colore }, posti) => ({
	id: lezione.id, event_id: lezione.eventId, date: lezione.date,
	start_time: hhmm(lezione.startTime), end_time: hhmm(lezione.endTime),
	room_id: lezione.roomId, capacity: lezione.capacity, status: lezione.status, modified_manually: lezione.modifiedManually,
	course_id: corso.id, corso: corso.nome, instructor_id: corso.instructorId, category_id: corso.categoriaId, colore: colore ?? null,
	sessione: sessioneApi(sessione),
	confermati: posti?.confermati ?? 0, in_attesa: posti?.in_attesa ?? 0,
});

export default async function calendarioRoutes(fastify) {
	registerPgErrorHandler(fastify);

	// Leggere vuole il calendario in visione; scrivere, lezioni e sessioni in modifica. Chi ha solo
	// «view» sul modulo calendar vede il calendario, e non lo cambia.
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		if (request.method === 'GET') {
			if (utente.ruolo === 'member' || !canAccess(utente.ruolo, 'calendar', 'view')) {
				return reply.code(403).send({ error: 'Il tuo ruolo non consente di vedere il calendario.' });
			}
		} else if (!canWriteEntity(utente.ruolo, 'Session') || !canWriteEntity(utente.ruolo, 'Event')) {
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
	 * GET /api/calendario/lezioni?dal=AAAA-MM-GG&al=AAAA-MM-GG
	 * GET /api/calendario/lezioni?evento_id=…&dal=AAAA-MM-GG     (le lezioni di una sessione da quel giorno)
	 * → { lezioni: [{ id, event_id, date, start_time, end_time, room_id, capacity, status,
	 *     modified_manually, course_id, corso, instructor_id, category_id, colore, sessione, confermati, in_attesa }] }
	 */
	fastify.get('/api/calendario/lezioni', (request, reply) => rispondi(reply, async () => {
		const { dal, al, evento_id: idEvento } = request.query ?? {};
		if (!eUnGiorno(dal)) throw new Rifiuto(400, 'Indica da che giorno (dal=AAAA-MM-GG).');
		const filtri = [gte(sessions.date, dal)];
		if (idEvento) {
			filtri.push(eq(sessions.eventId, idEvento));
			if (al !== undefined && !eUnGiorno(al)) throw new Rifiuto(400, 'La data finale non è valida.');
			if (al) filtri.push(lte(sessions.date, al));
		} else {
			if (!eUnGiorno(al) || al < dal) throw new Rifiuto(400, 'Indica un intervallo valido (dal, al).');
			if (giorniFra(dal, al) > MASSIMO_GIORNI_LETTI) throw new Rifiuto(400, `Al massimo ${MASSIMO_GIORNI_LETTI} giorni per volta.`);
			filtri.push(lte(sessions.date, al));
		}
		const righe = await db.select(COLONNE_LEZIONE)
			.from(sessions)
			.innerJoin(events, eq(sessions.eventId, events.id))
			.innerJoin(courses, eq(events.courseId, courses.id))
			.leftJoin(categories, eq(courses.categoryId, categories.id))
			.where(and(...filtri))
			.orderBy(asc(sessions.date), asc(sessions.startTime));
		const posti = await postiContati(righe.map((r) => r.lezione.id));
		return { lezioni: righe.map((r) => lezioneApi(r, posti.get(r.lezione.id))) };
	}));

	/**
	 * GET /api/calendario/lezioni/:id
	 * → { lezione, prenotazioni: [{ id, member_id, nome, cognome, codice_socio, status,
	 *     waitlist_position, prenotazione_fissa_id, created_date }] }
	 * Una lezione vecchia si apre comunque: la pagina chiede sempre al server.
	 */
	fastify.get('/api/calendario/lezioni/:id', (request, reply) => rispondi(reply, async () => {
		const [riga] = await db.select(COLONNE_LEZIONE)
			.from(sessions)
			.innerJoin(events, eq(sessions.eventId, events.id))
			.innerJoin(courses, eq(events.courseId, courses.id))
			.leftJoin(categories, eq(courses.categoryId, categories.id))
			.where(eq(sessions.id, request.params.id))
			.limit(1);
		if (!riga) throw new Rifiuto(404, 'La lezione non esiste più.');
		const prenotazioni = await db.select({
			id: bookings.id, member_id: bookings.memberId, nome: members.nome, cognome: members.cognome,
			codice_socio: members.codiceSocio, status: bookings.status, waitlist_position: bookings.waitlistPosition,
			prenotazione_fissa_id: bookings.prenotazioneFissaId, created_date: bookings.createdDate,
		})
			.from(bookings)
			.innerJoin(members, eq(bookings.memberId, members.id))
			.where(eq(bookings.sessionId, riga.lezione.id))
			.orderBy(
				sql`case ${bookings.status} when 'confirmed' then 0 when 'waitlisted' then 1 else 2 end`,
				asc(bookings.waitlistPosition), asc(bookings.createdDate),
			);
		const posti = await postiContati([riga.lezione.id]);
		return { lezione: lezioneApi(riga, posti.get(riga.lezione.id)), prenotazioni };
	}));

	/**
	 * GET /api/calendario/sessioni?stato=in_corso|finite&corso_id=…
	 * → { sessioni: [{ …sessione, corso, corso_attivo, category_id, colore, sala, prima_lezione,
	 *     ultima_lezione, prossima_lezione, fisse }], finite }
	 *
	 * Una sessione (settimanale, o una vecchia a date scelte) è in corso finché ha una lezione
	 * attiva da oggi in poi; poi è finita. Con `stato=in_corso` (il predefinito) arriva anche il
	 * numero delle finite, che si leggono solo se le si apre. `fisse`: quante fisse in corso.
	 */
	fastify.get('/api/calendario/sessioni', (request, reply) => rispondi(reply, async () => {
		const stato = request.query?.stato ?? 'in_corso';
		if (!['in_corso', 'finite'].includes(stato)) throw new Rifiuto(400, 'Lo stato è «in_corso» o «finite».');
		const oggi = oggiIso();
		const filtri = [inArray(events.recurrenceType, ['weekly', 'custom'])];
		if (request.query?.corso_id) filtri.push(eq(events.courseId, request.query.corso_id));
		const righe = await db.select({
			sessione: events, corso: courses.name, corsoAttivo: courses.attivo, categoriaId: courses.categoryId,
			colore: categories.color, sala: rooms.name,
		})
			.from(events)
			.innerJoin(courses, eq(events.courseId, courses.id))
			.leftJoin(categories, eq(courses.categoryId, categories.id))
			.leftJoin(rooms, eq(events.roomId, rooms.id))
			.where(and(...filtri))
			.orderBy(asc(courses.name), asc(events.startTime));
		const ids = righe.map((r) => r.sessione.id);
		const date = ids.length ? await db.select({
			id: sessions.eventId,
			prima: sql`min(${sessions.date})::text`,
			ultima: sql`max(${sessions.date})::text`,
			prossima: sql`(min(${sessions.date}) filter (where ${sessions.status} = 'active' and ${sessions.date} >= ${oggi}))::text`,
		}).from(sessions).where(inArray(sessions.eventId, ids)).groupBy(sessions.eventId) : [];
		const fisse = ids.length ? await db.select({ id: prenotazioniFisse.eventId, quante: sql`count(*)`.mapWith(Number) })
			.from(prenotazioniFisse).where(and(inArray(prenotazioniFisse.eventId, ids), fissaInCorso(oggi)))
			.groupBy(prenotazioniFisse.eventId) : [];
		const datePer = new Map(date.map((d) => [d.id, d]));
		const fissePer = new Map(fisse.map((f) => [f.id, f.quante]));

		const tutte = righe.map((r) => {
			const d = datePer.get(r.sessione.id);
			return {
				...sessioneApi(r.sessione), corso: r.corso, corso_attivo: r.corsoAttivo, category_id: r.categoriaId,
				colore: r.colore ?? null, sala: r.sala ?? null,
				prima_lezione: d?.prima ?? null, ultima_lezione: d?.ultima ?? null, prossima_lezione: d?.prossima ?? null,
				fisse: fissePer.get(r.sessione.id) ?? 0,
			};
		});
		const inCorso = tutte.filter((s) => s.prossima_lezione);
		const finite = tutte.filter((s) => !s.prossima_lezione);
		return stato === 'finite' ? { sessioni: finite, finite: finite.length } : { sessioni: inCorso, finite: finite.length };
	}));

	/**
	 * POST /api/calendario/conflitti
	 *   { date: ['2026-11-12', …], start_time, end_time, room_id, course_id?, escludi_lezioni?: [id], escludi_evento_id? }
	 * → { conflitti: [{ data, tipo: 'sala'|'istruttore', messaggio, lezione_id }], libere: [data] }
	 *
	 * Le sovrapposizioni di sala e istruttore, contate sul server: la regola del browser
	 * (`checkEventConflicts`) voleva tutte le lezioni in memoria. È una scrittura in preparazione:
	 * la chiede chi può modificare il calendario.
	 */
	fastify.post('/api/calendario/conflitti', (request, reply) => rispondi(reply, async () => {
		const {
			date, start_time: inizio, end_time: fine, room_id: sala, course_id: idCorso,
			escludi_lezioni: escludiLezioni = [], escludi_evento_id: escludiEvento = null,
		} = request.body ?? {};
		if (!Array.isArray(date) || !date.length || !date.every(eUnGiorno)) throw new Rifiuto(400, 'Indica le date da controllare.');
		if (date.length > MASSIMO_DATE_CONFLITTI) throw new Rifiuto(400, `Al massimo ${MASSIMO_DATE_CONFLITTI} date per volta.`);
		if (!E_UN_ORARIO.test(String(inizio ?? '')) || !E_UN_ORARIO.test(String(fine ?? '')) || hhmm(fine) <= hhmm(inizio)) {
			throw new Rifiuto(400, "Indica un orario valido: l'inizio prima della fine.");
		}
		if (!sala) throw new Rifiuto(400, 'Indica la sala.');
		if (!Array.isArray(escludiLezioni)) throw new Rifiuto(400, 'Le lezioni da escludere sono un elenco.');
		let istruttore = null;
		if (idCorso) {
			const [corso] = await db.select({ istruttore: courses.instructorId }).from(courses).where(eq(courses.id, idCorso)).limit(1);
			if (!corso) throw new Rifiuto(404, 'Il corso non esiste.');
			istruttore = corso.istruttore;
		}
		return conflitti({
			date, start_time: hhmm(inizio), end_time: hhmm(fine), room_id: sala, instructor_id: istruttore, escludiLezioni, escludiEvento,
		});
	}));

	/**
	 * POST /api/calendario/elimina
	 *   { lezione_id?, evento_id?, ambito: 'lezione' | 'serie', anteprima? }
	 * → { eliminate, annullate, soci_avvisati, evento_eliminato }
	 *
	 * La lezione indicata, oppure tutta la sessione da oggi in poi (indicata con `evento_id`, o con
	 * una sua lezione). Se alla sessione non resta nessuna lezione, sparisce anche lei; altrimenti la
	 * sua data fine diventa l'ultima lezione rimasta, così il riepilogo e un'eventuale proroga
	 * ripartono da lì. Una sessione che resta senza lezioni da tenere chiude le sue fisse.
	 */
	fastify.post('/api/calendario/elimina', (request, reply) => rispondi(reply, async () => {
		const { lezione_id: idLezione, evento_id: idEvento, ambito, anteprima } = request.body ?? {};
		if (!['lezione', 'serie'].includes(ambito)) throw new Rifiuto(400, 'Scegli se eliminare la lezione o la sessione.');
		if (!idLezione && (ambito === 'lezione' || !idEvento)) throw new Rifiuto(400, ambito === 'lezione' ? 'Indica la lezione.' : 'Indica la sessione.');

		const esito = await db.transaction(async (tx) => {
			const [lezione] = idLezione
				? await tx.select().from(sessions).where(eq(sessions.id, idLezione)).limit(1)
				: [];
			if (idLezione && !lezione) throw new Rifiuto(404, 'La lezione non esiste più: forse è già stata eliminata.');
			const [evento] = await tx.select().from(events).where(eq(events.id, lezione?.eventId ?? idEvento)).limit(1).for('update');
			if (!evento) throw new Rifiuto(404, 'La sessione non esiste più: forse è già stata eliminata.');
			const [corso] = await tx.select({ nome: courses.name }).from(courses).where(eq(courses.id, evento.courseId)).limit(1);
			const nomeCorso = corso?.nome ?? 'corso';

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
				bersaglio = daOggi.filter(daTenere);
				if (!bersaglio.length) throw new Rifiuto(400, 'Nella sessione non ci sono lezioni da togliere da oggi in poi.');
			}

			const piano = await pianoRimozione(tx, bersaglio);
			const conti = contiRimozione(piano);
			if (anteprima) return { conti, evento_eliminato: false };

			await applicaRimozione(tx, piano, nomeCorso);

			const rimaste = await tx.select({ date: sessions.date, status: sessions.status }).from(sessions)
				.where(eq(sessions.eventId, evento.id));
			let eventoEliminato = false;
			let fisseChiuse = 0;
			if (rimaste.length === 0) {
				// Le sue fisse vanno via con lei (ON DELETE CASCADE); le prenotazioni nate da loro
				// restano, senza più la fissa (ON DELETE SET NULL).
				await tx.delete(events).where(eq(events.id, evento.id));
				eventoEliminato = true;
			} else {
				if (ambito === 'serie' && evento.recurrenceType === 'weekly') {
					const ultima = rimaste.filter((r) => r.status === 'active').map((r) => r.date).sort().pop();
					if (ultima) {
						await tx.update(events)
							.set({ endCondition: 'by_date', endDate: ultima, occurrenceCount: null })
							.where(eq(events.id, evento.id));
					}
				}
				fisseChiuse = await chiudiFisseSenzaLezioni(tx, evento.id);
			}
			return { conti, evento_eliminato: eventoEliminato, evento, nomeCorso, lezione, fisseChiuse };
		});

		if (!anteprima) {
			const cosa = ambito === 'lezione'
				? `Lezione del ${dataIt(esito.lezione.date)} alle ${hhmm(esito.lezione.startTime)}`
				: 'Sessione da oggi in poi';
			const extra = [
				esito.evento_eliminato ? 'sessione rimossa dal calendario' : '',
				esito.fisseChiuse ? `prenotazioni fisse chiuse: ${esito.fisseChiuse}` : '',
			].filter(Boolean).join('; ');
			await registra(request.utente, {
				tipoAzione: 'delete', entitaTipo: 'event', entitaNome: esito.nomeCorso, entitaId: esito.evento.id,
				dettagli: `${cosa}: ${descriviConti(esito.conti)}${extra ? `; ${extra}` : ''}`,
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
	 * Spostarla avanti genera le lezioni mancanti col modello della sessione (giorno, sala, orari,
	 * capienza); spostarla indietro toglie quelle oltre la nuova data con le regole di sempre. Una
	 * sessione contata a occorrenze diventa "fino a una data". Le fisse senza fine prenotano le
	 * lezioni nuove; quelle con una data restano com'erano. Una sessione rimasta senza lezioni da
	 * tenere chiude le sue fisse.
	 *
	 * Le sovrapposizioni con altre lezioni le controlla la finestra (POST /api/calendario/conflitti),
	 * e manda in `salta` le date che si è deciso di non creare. Le date in cui la sala è chiusa le
	 * salta il server: lì una lezione non può proprio esistere.
	 */
	fastify.post('/api/calendario/eventi/:id/data-fine', (request, reply) => rispondi(reply, async () => {
		const { end_date: fine, salta = [], anteprima } = request.body ?? {};
		if (!eUnGiorno(fine)) throw new Rifiuto(400, 'La data fine non è valida.');
		const oggi = oggiIso();

		const [base] = await db.select({ roomId: events.roomId }).from(events).where(eq(events.id, request.params.id)).limit(1);
		if (!base) throw new Rifiuto(404, 'La sessione non esiste più.');

		// La sala resta ferma mentre si generano lezioni dentro di lei: una sospensione decisa in
		// quel momento da un collega le vedrebbe, invece di passarci sopra (lib/sale.js).
		const esito = await conSaleBloccate([base.roomId], () => db.transaction(async (tx) => {
			const [evento] = await tx.select().from(events).where(eq(events.id, request.params.id)).limit(1).for('update');
			if (evento.recurrenceType !== 'weekly') throw new Rifiuto(400, 'La data fine si cambia solo nelle sessioni settimanali.');
			if (fine < evento.startDate) throw new Rifiuto(400, "La data fine non può precedere l'inizio della sessione.");
			if (fine < oggi) {
				throw new Rifiuto(400, 'La data fine non può essere nel passato: per togliere le lezioni rimaste usa Elimina.');
			}
			const [corso] = await tx.select({ nome: courses.name }).from(courses).where(eq(courses.id, evento.courseId)).limit(1);
			const [sala] = await tx.select().from(rooms).where(eq(rooms.id, evento.roomId)).limit(1);
			const lezioni = await tx.select().from(sessions).where(eq(sessions.eventId, evento.id));

			// Accorciando: le lezioni ancora da tenere oltre la nuova fine.
			const daTogliere = lezioni.filter((l) => l.date > fine).filter(daTenere);

			// Allungando: le date della regola dopo l'ultima lezione che la sessione abbia mai avuto,
			// annullate comprese — una lezione annullata non torna da sola — e da oggi in poi.
			const ultima = lezioni.map((l) => l.date).sort().pop() ?? '';
			const nuove = dateGiuste({
				giorno: evento.giorno, start_date: evento.startDate, end_condition: 'by_date', end_date: fine,
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
			const fisseChiuse = daTogliere.length ? await chiudiFisseSenzaLezioni(tx, evento.id) : 0;
			return { conti, evento, nomeCorso: corso?.nome ?? '', primaFine, fisseChiuse };
		}));

		if (anteprima) return { ...esito.conti, ...esito.extra };
		const dettagli = [
			`Data fine ${esito.primaFine ? `dal ${dataIt(esito.primaFine)} ` : ''}al ${dataIt(fine)}`,
			esito.conti.aggiunte ? `aggiunte ${esito.conti.aggiunte} lezioni` : '',
			descriviConti(esito.conti),
			esito.fisseChiuse ? `prenotazioni fisse chiuse: ${esito.fisseChiuse}` : '',
		].filter(Boolean).join(', ');
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'event', entitaNome: esito.nomeCorso, entitaId: esito.evento.id, dettagli,
		}, request.log);
		// Le lezioni nuove di una sessione allungata entrano nelle fisse senza fine di chi le ha.
		if (esito.conti.aggiunte) await applicaFisse({ eventId: esito.evento.id, soloSenzaFine: true });
		return esito.conti;
	}));
}

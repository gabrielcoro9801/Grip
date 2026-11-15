import { eq, and, or, gte, lte, inArray, ne, desc, isNull, count, min, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
	members,
	courses, categories, instructors, rooms, events, sessions, bookings, notifiche, consensi, prenotazioniFisse,
} from '../../db/schema/index.js';
import { iscrizioniDelSocio } from '../../lib/iscrizioni.js';
import { consensiDi } from '../../lib/consensi.js';
import { tipoConsensoValido } from '../../../../shared/consensi.js';
import { getUserFromRequest } from '../../auth/tokens.js';
import { socioDiAccount } from '../../auth/socioCorrente.js';
import { prenota, disdici, regolaOfferte } from '../../lib/prenotazioni.js';
import { firmaUrl } from '../../lib/urlFirmati.js';
import { statoIscrizione, motivoSenzaCopertura, sospensioneIl, fineCopertura } from '../../../../shared/abbonamenti.js';
import { oggiIso, eUnGiorno, giorniFra, giorniDaOggi, spostaGiorni, lezioneFinita } from '../../../../shared/giorni.js';
import { limiteDisdetta, motivoDisdettaChiusa, chiusuraLista, GIORNI_SETTIMANA } from '../../../../shared/corsi.js';
import { creaFissa, modificaFissa, terminaFissa, elencoFisse, limitiFissa, anteprimaFissa } from '../../lib/prenotazioniFisse.js';
import { avvisiSocio } from '../../../../shared/avvisi.js';
import { soglieEnte, contattiPalestra } from '../../lib/impostazioni.js';

/**
 * L'API del portale soci.
 *
 * ## Perché esiste, visto che c'è già /api/entities
 *
 * Il portale chiedeva le entità per nome — `Member`, `Subscription`, `Booking` — e il server
 * gli restituiva le righe filtrate. Funziona, ed è comodo finché il client è una pagina web
 * che si aggiorna insieme al server: si rilascia tutto insieme e nessuno se ne accorge.
 *
 * Con un'app installata su un telefono quel patto salta. L'app resta sul dispositivo di
 * qualcuno per mesi, in versioni che nessuno può aggiornare a comando, e se il suo contratto
 * sono i nomi delle colonne del database allora rinominare un campo rompe le app di chi non
 * ha aggiornato. Qui il contratto è esplicito: dei nomi delle colonne non esce niente.
 *
 * ## Perché non è solo una questione di contratto
 *
 * Per disegnare il calendario dei corsi il portale faceva **sette** richieste e si scaricava
 * fino a cinquecento prenotazioni **di tutti i soci** — col nome tolto dal server, ma con
 * l'identificativo del socio e quello della lezione: cioè chi frequenta cosa. Il conto dei
 * posti liberi lo deve fare il server e mandare un numero. Sono privacy e batteria, non
 * eleganza.
 *
 * ## Il confine
 *
 * Questo plugin è **solo per i soci**: un token dello staff riceve 403, non una risposta
 * parziale. Il socio a cui l'account è collegato si rilegge dal database a ogni richiesta
 * (vedi `auth/socioCorrente.js`), e da lì in poi nessun handler si fida di un identificativo
 * che arriva da fuori.
 *
 * `memberScope.js` non sparisce: resta la serratura sull'endpoint generico, che continua a
 * esistere. Queste rotte sono la porta d'ingresso, quello è il muro dietro.
 *
 * ## La versione nel percorso
 *
 * `v1` sta nell'indirizzo perché è l'unica forma che si legge in un log e si prova con
 * `curl`. Finché il portale è solo una pagina web, rilasciata insieme al server, `v1` cambia
 * con lui: a novembre 2026 ne sono usciti il codice d'accesso, i documenti e i consensi dati dal
 * portale (docs/piani/portale.md). Il giorno in cui ci sarà un'app installata, dentro `v1` si
 * aggiungerà soltanto, e rompere vorrà dire `v2`.
 */
export default async function memberRoutes(fastify) {
	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });

		// Solo i soci. Lo staff ha il gestionale e l'endpoint generico: lasciargli anche
		// questa superficie significherebbe due contratti da mantenere per le stesse cose.
		if (utente.ruolo !== 'member') {
			return reply.code(403).send({ error: 'Questa API è riservata al portale soci.' });
		}

		const idSocio = await socioDiAccount(utente.sub);
		if (!idSocio) return reply.code(403).send({ error: 'Account non collegato a un socio.' });

		request.utente = utente;
		request.idSocio = idSocio;
	});

	// --- Chi sono ----------------------------------------------------------------------

	/**
	 * Quello che serve alla schermata iniziale e all'anagrafica, in una richiesta sola.
	 *
	 * `giorni_alla_scadenza` e `in_scadenza` li calcola il server, con le soglie della palestra:
	 * la politica sta in un posto solo, e il client non deve portarsi dietro una libreria di date
	 * per rispondere a "scade presto?".
	 */
	fastify.get('/profilo', async (request) => {
		const [socio] = await db.select().from(members).where(eq(members.id, request.idSocio)).limit(1);
		if (!socio) return { socio: null, abbonamento: null };

		// Con le date dopo le sospensioni, dalla più recente.
		const [iscrizioni, soglie] = await Promise.all([iscrizioniDelSocio(request.idSocio), soglieEnte()]);
		const abbonamenti = iscrizioni.reverse();

		// La corrente è la più recente ancora valida oggi; se non ce n'è, l'ultima scaduta. La
		// colonna `status` non si guarda: nessuno la aggiorna, e sceglieva come "corrente" anche
		// un abbonamento scaduto da mesi.
		const statoDi = (a) => statoIscrizione(a, oggiIso(), soglie.abbonamentoInScadenzaGiorni);
		const corrente = abbonamenti.find((a) => statoDi(a) !== 'expired') ?? abbonamenti[0] ?? null;
		const sospensione = sospensioneIl(abbonamenti, oggiIso());

		return {
			socio: {
				id: socio.id,
				nome: socio.fullName,
				codice_socio: socio.codiceSocio,
				email: socio.email,
				telefono: socio.phone,
				data_nascita: socio.dateOfBirth,
				indirizzo: socio.address,
				contatto_emergenza: socio.emergencyContactName
					? { nome: socio.emergencyContactName, telefono: socio.emergencyContactPhone }
					: null,
				// Le note della scheda sono della segreteria, e al socio non si mostrano: prima
				// arrivavano qui così com'erano. Il campo resta nel contratto, vuoto, perché un
				// campo che sparisce rompe un'app installata che non ha aggiornato.
				note: null,
			},
			abbonamento: corrente && {
				id: corrente.id,
				piano: corrente.plan_name,
				stato: statoDi(corrente),
				inizio: corrente.start_date,
				// Dopo le sospensioni: è la scadenza vera.
				fine: corrente.end_date,
				giorni_alla_scadenza: giorniDaOggi(corrente.end_date),
				// La soglia della palestra, la stessa di Da fare: prima qui c'era un 7 scritto a mano.
				in_scadenza: entroGiorni(corrente.end_date, soglie.abbonamentoInScadenzaGiorni),
				// Fermo oggi: fino a quando, e il giorno in cui riprende.
				sospeso: sospensione ? { fino_al: sospensione.al, riprende_il: spostaGiorni(sospensione.al, 1) } : null,
			},
		};
	});

	fastify.get('/abbonamenti', async (request) => {
		const [righe, soglie] = await Promise.all([iscrizioniDelSocio(request.idSocio), soglieEnte()]);
		const oggi = oggiIso();

		return {
			// L'ultimo giorno in cui si può prenotare senza interruzioni, rinnovi compresi; null se
			// oggi nessun abbonamento copre. Aggiunto in D-2 (docs/piani/portale.md).
			prenotabile_fino_al: fineCopertura(righe, oggi),
			abbonamenti: righe.reverse().map((a) => ({
				id: a.id,
				piano: a.plan_name,
				stato: statoIscrizione(a, oggi, soglie.abbonamentoInScadenzaGiorni),
				inizio: a.start_date,
				// La scadenza dopo le sospensioni; `giorni_sospesi` dice di quanto si è allungata.
				fine: a.end_date,
				giorni_alla_scadenza: giorniDaOggi(a.end_date),
				in_scadenza: entroGiorni(a.end_date, soglie.abbonamentoInScadenzaGiorni) && giorniDaOggi(a.end_date) >= 0,
				prezzo_pagato: a.price_paid,
				giorni_sospesi: a.giorni_sospesi,
				// Quelle in corso o in arrivo: le passate sono già nella scadenza.
				sospensioni: a.sospensioni.filter((s) => s.al >= oggi).map((s) => ({ dal: s.dal, al: s.al, riprende_il: spostaGiorni(s.al, 1) })),
			})),
		};
	});

	/**
	 * La palestra: nome, indirizzo e i recapiti che scrive l'amministratore (Amministrazione ›
	 * Contatti). Un campo vuoto è null, e il portale non ne mostra la riga.
	 */
	fastify.get('/palestra', async () => contattiPalestra());

	// --- I corsi -----------------------------------------------------------------------

	/**
	 * L'agenda delle lezioni prenotabili, già messa in ordine e già contata.
	 *
	 * Sostituisce sette richieste e il lavoro di incrocio che il browser faceva a mano. Dei
	 * posti escono **numeri**, non le prenotazioni altrui: chi frequenta cosa non è un dato
	 * che il portale di un socio abbia ragione di ricevere.
	 *
	 * `?dal&al` (il portale chiede blocchi di 14 giorni), oppure `?sessione_id`: le lezioni di una
	 * sessione sola, per il foglio dell'orario. Le prenotazioni fisse non si applicano qui: una GET
	 * non prenota.
	 */
	fastify.get('/corsi/agenda', async (request, reply) => {
		const oggi = oggiIso();
		const dal = request.query.dal ?? oggi;
		const al = request.query.al ?? spostaGiorni(eUnGiorno(dal) ? dal : oggi, 30);
		const sessione = request.query.sessione_id;

		// Le date arrivano dalla query così come sono: una malformata finiva al database e
		// tornava come errore 500, e `?dal=2000-01-01&al=2100-01-01` faceva leggere al server
		// tutte le lezioni e tutte le prenotazioni della palestra.
		const motivo = motivoIntervalloNonValido(dal, al);
		if (motivo) return reply.code(400).send({ error: motivo });
		if (sessione !== undefined && !E_UN_ID.test(String(sessione))) return reply.code(400).send({ error: 'Sessione non valida.' });

		const lezioni = await lezioniPerIlSocio(request.idSocio, and(
			gte(sessions.date, dal),
			lte(sessions.date, al),
			eq(sessions.status, 'active'),
			...(sessione ? [eq(sessions.eventId, sessione)] : []),
		));
		const giorni = new Map();
		for (const l of lezioni) {
			if (!giorni.has(l.data)) giorni.set(l.data, []);
			giorni.get(l.data).push(l);
		}
		return { dal, al, giorni: [...giorni.entries()].map(([data, ls]) => ({ data, lezioni: ls })) };
	});

	/**
	 * Le mie lezioni: quelle che ho prenotato (anche disdette, anche annullate dalla palestra) fra
	 * `dal` e `al`, come le lezioni dell'agenda. Di base dagli ultimi 30 giorni ai prossimi 60.
	 * → { dal, al, lezioni: [lezione] }, in ordine di data e ora.
	 */
	fastify.get('/lezioni', async (request, reply) => {
		const oggi = oggiIso();
		const dal = request.query.dal ?? spostaGiorni(oggi, -30);
		const al = request.query.al ?? spostaGiorni(oggi, 60);
		const motivo = motivoIntervalloNonValido(dal, al);
		if (motivo) return reply.code(400).send({ error: motivo });
		const mie = db.select({ id: bookings.sessionId }).from(bookings).where(eq(bookings.memberId, request.idSocio));
		const lezioni = await lezioniPerIlSocio(request.idSocio, and(
			gte(sessions.date, dal),
			lte(sessions.date, al),
			inArray(sessions.id, mie),
		), { ancheDisdette: true });
		return { dal, al, lezioni };
	});

	/**
	 * Il catalogo per «Per corso»: le categorie, i loro corsi attivi e gli orari (le sessioni) con
	 * almeno una lezione da oggi in avanti. `categoria_recente` è quella della mia ultima
	 * prenotazione: è la fisarmonica che si apre all'ingresso.
	 */
	fastify.get('/corsi/catalogo', async (request) => {
		const oggi = oggiIso();
		const [righe, mieFisse, [recente]] = await Promise.all([
			db.select({
				sessione_id: events.id, ricorrenza: events.recurrenceType, giorno: events.giorno,
				inizio: events.startTime, fine: events.endTime, capienza: events.capacity,
				corso: { id: courses.id, nome: courses.name, descrizione: courses.description },
				categoria: { id: categories.id, nome: categories.name, colore: categories.color },
				istruttore: { id: instructors.id, nome: instructors.fullName },
				sala: { id: rooms.id, nome: rooms.name },
				prossima: min(sessions.date),
				lezioni: count(sessions.id),
			})
				.from(events)
				.innerJoin(sessions, and(eq(sessions.eventId, events.id), eq(sessions.status, 'active'), gte(sessions.date, oggi)))
				.innerJoin(courses, and(eq(events.courseId, courses.id), eq(courses.attivo, true)))
				.innerJoin(categories, eq(courses.categoryId, categories.id))
				.leftJoin(instructors, eq(courses.instructorId, instructors.id))
				.leftJoin(rooms, eq(events.roomId, rooms.id))
				.groupBy(events.id, courses.id, categories.id, instructors.id, rooms.id)
				.orderBy(categories.name, courses.name, events.startTime),
			elencoFisse({ memberId: request.idSocio }),
			db.select({ categoria: courses.categoryId }).from(bookings)
				.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
				.innerJoin(events, eq(sessions.eventId, events.id))
				.innerJoin(courses, eq(events.courseId, courses.id))
				.where(eq(bookings.memberId, request.idSocio))
				.orderBy(desc(bookings.createdDate))
				.limit(1),
		]);
		const fisse = new Set(mieFisse.map((f) => f.event_id));
		const categorie = new Map();
		for (const r of righe) {
			if (!categorie.has(r.categoria.id)) categorie.set(r.categoria.id, { ...r.categoria, corsi: new Map() });
			const corsi = categorie.get(r.categoria.id).corsi;
			if (!corsi.has(r.corso.id)) corsi.set(r.corso.id, { ...r.corso, istruttore: r.istruttore?.id ? r.istruttore : null, orari: [] });
			corsi.get(r.corso.id).orari.push({
				sessione_id: r.sessione_id, ricorrenza: r.ricorrenza, giorno: r.giorno,
				inizio: String(r.inizio).slice(0, 5), fine: String(r.fine).slice(0, 5), capienza: r.capienza,
				sala: r.sala?.id ? r.sala : null, prossima: r.prossima, lezioni: Number(r.lezioni), mia_fissa: fisse.has(r.sessione_id),
			});
		}
		// Gli orari di un corso in ordine di settimana: lunedì prima, poi l'ora.
		const ordine = (o) => `${o.giorno ? GIORNI_SETTIMANA.indexOf(o.giorno) : 9}${o.inizio}${o.prossima}`;
		return {
			categoria_recente: recente?.categoria ?? null,
			categorie: [...categorie.values()].map((c) => ({
				...c,
				corsi: [...c.corsi.values()].map((corso) => ({ ...corso, orari: corso.orari.sort((a, b) => ordine(a).localeCompare(ordine(b))) })),
			})),
		};
	});

	/**
	 * «I tuoi corsi» della Home: gli orari che ho prenotato almeno due volte negli ultimi 60 giorni
	 * e che non sono già una mia fissa, ognuno con la sua prossima lezione che non ho ancora
	 * prenotato. Al massimo tre. → { lezioni: [lezione] }
	 */
	fastify.get('/corsi/miei-orari', async (request) => {
		const oggi = oggiIso();
		const [frequenti, mieFisse] = await Promise.all([
			db.select({ evento: sessions.eventId, volte: count(bookings.id) })
				.from(bookings)
				.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
				.where(and(eq(bookings.memberId, request.idSocio), ne(bookings.status, 'cancelled'), gte(sessions.date, spostaGiorni(oggi, -60)), lte(sessions.date, oggi)))
				.groupBy(sessions.eventId)
				.having(sql`count(${bookings.id}) >= 2`)
				.orderBy(desc(count(bookings.id))),
			elencoFisse({ memberId: request.idSocio }),
		]);
		const fisse = new Set(mieFisse.map((f) => f.event_id));
		const eventi = frequenti.map((f) => f.evento).filter((e) => !fisse.has(e)).slice(0, 3);
		if (!eventi.length) return { lezioni: [] };
		const prossime = await lezioniPerIlSocio(request.idSocio, and(
			inArray(sessions.eventId, eventi),
			eq(sessions.status, 'active'),
			gte(sessions.date, oggi),
			lte(sessions.date, spostaGiorni(oggi, 30)),
		));
		const prima = new Map();
		for (const l of prossime) {
			if (l.finita || l.mia_prenotazione || prima.has(l.sessione_id)) continue;
			prima.set(l.sessione_id, l);
		}
		return { lezioni: eventi.map((e) => prima.get(e)).filter(Boolean) };
	});

	/**
	 * Prenota una lezione.
	 *
	 * Il socio è quello della sessione, non uno che arriva nella richiesta: dall'indirizzo
	 * non c'è modo di prenotare per un altro. La regola — se c'è posto, se si finisce in
	 * lista d'attesa, in che posizione — è la stessa che usa il gestionale, perché è
	 * letteralmente la stessa funzione (`lib/prenotazioni.js`).
	 */
	fastify.post('/corsi/lezioni/:id/prenota', async (request, reply) => {
		const esito = await prenota({ sessionId: request.params.id, memberId: request.idSocio });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio, code: esito.codice });

		reply.code(201);
		return {
			prenotazione: {
				id: esito.creata.id,
				lezione_id: esito.creata.sessionId,
				stato: esito.creata.status,
				posizione_attesa: esito.creata.waitlistPosition,
			},
		};
	});

	/**
	 * Disdice una propria prenotazione.
	 *
	 * Di quella di un altro si risponde "non trovata", non "non consentito": a chi non deve
	 * vederla non si conferma nemmeno che esista.
	 */
	fastify.post('/corsi/prenotazioni/:id/disdici', async (request, reply) => {
		const esito = await disdici({ bookingId: request.params.id, soloDelSocio: request.idSocio });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });

		// Chi è stato promosso dalla lista d'attesa non lo diciamo: è un altro socio, e al
		// portale non serve saperlo. Al gestionale sì, e infatti la sua rotta lo restituisce.
		return { disdetta: true };
	});

	// --- Le prenotazioni fisse ------------------------------------------------------------
	//
	// Con le date (D-4, docs/piani/portale.md): il socio sceglie fino a quando — una data o un
	// numero di lezioni — dentro il massimo (la copertura del suo abbonamento e l'ultima lezione
	// della sessione), e prima di confermare vede che cosa succederà a ogni lezione.

	/** Una fissa del socio, sua: altrimenti null (e la rotta risponde 404, non 403). */
	const suaFissa = async (request) => {
		const [f] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, request.params.id)).limit(1);
		return f && String(f.memberId) === String(request.idSocio) ? f : null;
	};
	const anteprimaApi = (a) => ({
		dal: a.dal, al: a.al, massimo: a.limiti.massimo,
		// Il perché del massimo: la fine della copertura, l'ultima lezione della sessione, l'ultima
		// lezione dentro la copertura.
		copertura_fino_al: a.limiti.copertura, ultima_lezione: a.limiti.ultima, ultima_coperta: a.limiti.ultima_coperta,
		lezioni: a.lezioni, prenotate: a.prenotate, in_attesa: a.in_attesa,
	});

	/**
	 * Le prenotazioni fisse in corso del socio, con fino a quando possono arrivare (`massimo`): se
	 * è oltre la loro fine, il portale mostra «Allunga».
	 */
	fastify.get('/corsi/fisse', async (request) => {
		const fisse = await elencoFisse({ memberId: request.idSocio });
		return {
			fisse: await Promise.all(fisse.map(async (f) => {
				const limiti = await limitiFissa({ memberId: request.idSocio, eventId: f.event_id, dal: f.dal });
				return {
					id: f.id, serie_id: f.event_id, corso: f.corso, giorni: f.giorno ? [f.giorno] : [],
					inizio: String(f.inizio).slice(0, 5), fine: String(f.fine).slice(0, 5), creata_il: f.creata_il,
					dal: f.dal, al: f.al, massimo: limiti.ultima_coperta ?? limiti.massimo,
				};
			})),
		};
	});

	/**
	 * GET /corsi/sessioni/:id/fissa/anteprima?al&numero (&fissa_id per cambiarne una)
	 * → { dal, al, massimo, copertura_fino_al, ultima_lezione, ultima_coperta, lezioni: [{ data, esito }], prenotate, in_attesa }
	 * `esito`: confermata, in_attesa, gia_prenotata, gia_in_attesa, sospesa, disdetta, piena, scoperta. Senza `al`
	 * né `numero`: fino al massimo. Non scrive niente.
	 */
	fastify.get('/corsi/sessioni/:id/fissa/anteprima', async (request, reply) => {
		let dal = null;
		if (request.query.fissa_id) {
			const [f] = await db.select().from(prenotazioniFisse).where(eq(prenotazioniFisse.id, request.query.fissa_id)).limit(1);
			if (!f || String(f.memberId) !== String(request.idSocio) || f.eventId !== request.params.id) return reply.code(404).send({ error: 'Prenotazione fissa inesistente.' });
			dal = f.dal;
		}
		const a = await anteprimaFissa({ memberId: request.idSocio, eventId: request.params.id, dal, al: request.query.al, numero: request.query.numero });
		if (a.errore) return reply.code(a.errore).send({ error: a.messaggio });
		return anteprimaApi(a);
	});

	/**
	 * POST /corsi/sessioni/:id/fissa { al } o { numero } → 201, come l'anteprima, con l'esito vero
	 * di ogni lezione: il test lo confronta con quello dell'anteprima.
	 */
	fastify.post('/corsi/sessioni/:id/fissa', async (request, reply) => {
		const { al = null, numero = null } = request.body ?? {};
		const [socio] = await db.select({ nome: members.fullName }).from(members).where(eq(members.id, request.idSocio)).limit(1);
		const esito = await creaFissa({ memberId: request.idSocio, eventId: request.params.id, al, numero, creataDa: socio?.nome ?? '' });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		const limiti = await limitiFissa({ memberId: request.idSocio, eventId: request.params.id, dal: esito.fissa.dal });
		reply.code(201);
		return {
			fissa: { id: esito.fissa.id },
			...anteprimaApi({ dal: esito.fissa.dal, al: esito.fissa.al, limiti, lezioni: esito.esito.lezioni, prenotate: esito.esito.prenotate, in_attesa: esito.esito.inAttesa }),
		};
	});

	/**
	 * PUT /corsi/fisse/:id { al } o { numero } → { fissa: { id, dal, al }, prenotate, in_attesa, disdette, rimaste }
	 * Allunga o accorcia: prenota i giorni aggiunti, disdice quelli tolti (nel rispetto del termine
	 * di disdetta: quelle oltre restano, `rimaste`).
	 */
	fastify.put('/corsi/fisse/:id', async (request, reply) => {
		if (!(await suaFissa(request))) return reply.code(404).send({ error: 'Prenotazione fissa inesistente.' });
		const { al = null, numero = null } = request.body ?? {};
		if (vuoto(al) && vuoto(numero)) return reply.code(400).send({ error: 'Indica fino a quando: una data o un numero di lezioni.' });
		const esito = await modificaFissa({ fissaId: request.params.id, al, numero, soloDelSocio: request.idSocio });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		return {
			fissa: { id: esito.fissa.id, dal: esito.fissa.dal, al: esito.fissa.al },
			prenotate: esito.esito.prenotate, in_attesa: esito.esito.inAttesa, disdette: esito.disdette, rimaste: esito.rimaste,
		};
	});

	/**
	 * POST /corsi/fisse/:id/termina { dal? } → { disdette, rimaste }: da `dal` (oggi, se manca) non
	 * prenota più, e le sue prenotazioni da lì si disdicono, nel rispetto del termine di disdetta.
	 */
	fastify.post('/corsi/fisse/:id/termina', async (request, reply) => {
		const esito = await terminaFissa({ fissaId: request.params.id, dal: request.body?.dal ?? null, soloDelSocio: request.idSocio });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		return esito;
	});

	// --- Le notifiche -------------------------------------------------------------------

	/**
	 * Gli avvisi del socio, dal più recente, e quanti sono da leggere.
	 *
	 * Le ultime cinquanta bastano: sono avvisi, non un archivio. `non_lette` è un conto a parte,
	 * perché la campanella lo chiede a ogni pagina e non deve scaricarsi l'elenco per saperlo.
	 * Con `?solo_conteggio=1` arriva soltanto quello.
	 */
	fastify.get('/notifiche', async (request) => {
		const [[{ n }], avvisi] = await Promise.all([
			db.select({ n: count() }).from(notifiche).where(and(eq(notifiche.memberId, request.idSocio), isNull(notifiche.lettaIl))),
			avvisiDelSocio(request.idSocio),
		]);
		// Gli avvisi (da sistemare adesso) si contano insieme alle notifiche non lette: la
		// campanella dice quante cose aspettano il socio, e se ce n'è una grave.
		const conteggio = { non_lette: Number(n), avvisi: avvisi.length, avvisi_gravi: avvisi.some((a) => a.gravita === 'rosso') };
		if (request.query?.solo_conteggio) return conteggio;
		const righe = await db.select({
			n: notifiche,
			lezione: { id: sessions.id, data: sessions.date, inizio: sessions.startTime, stato: sessions.status },
			corso: courses.name,
		})
			.from(notifiche)
			.leftJoin(sessions, eq(notifiche.lezioneId, sessions.id))
			.leftJoin(events, eq(sessions.eventId, events.id))
			.leftJoin(courses, eq(events.courseId, courses.id))
			.where(eq(notifiche.memberId, request.idSocio))
			.orderBy(desc(notifiche.createdDate))
			.limit(50);
		return {
			...conteggio,
			avvisi_elenco: avvisi,
			notifiche: righe.map(({ n: r, lezione, corso }) => ({
				id: r.id, tipo: r.tipo, titolo: r.titolo, testo: r.testo,
				letta: Boolean(r.lettaIl), creata_il: r.createdDate,
				// Di che lezione o di che fissa parla (D-3): per l'azione della notifica. La lezione
				// arriva con quello che serve a nominarla e ad aprirne il giorno.
				lezione_id: r.lezioneId, fissa_id: r.fissaId,
				lezione: lezione?.id ? { id: lezione.id, data: lezione.data, inizio: String(lezione.inizio).slice(0, 5), corso, annullata: lezione.stato !== 'active' } : null,
			})),
		};
	});

	/** Segna come lette tutte le notifiche del socio: è ciò che succede aprendo la pagina. */
	fastify.post('/notifiche/lette', async (request) => {
		const lette = await db.update(notifiche).set({ lettaIl: new Date() })
			.where(and(eq(notifiche.memberId, request.idSocio), isNull(notifiche.lettaIl)))
			.returning({ id: notifiche.id });
		return { lette: lette.length };
	});

	// I consensi alle comunicazioni promozionali (shared/consensi.js). Dal portale si **revocano**
	// soltanto (decisione R3, docs/piani/portale.md): la revoca non si blocca mai (GDPR art. 7.3),
	// mentre darli non serve più, perché le comunicazioni automatiche sono uscite
	// dall'applicazione. Ogni revoca si aggiunge al registro, con il nome del socio e "portale".
	const personaDelSocio = async (idSocio) => {
		const [socio] = await db.select({ personaId: members.personaId, nome: members.fullName }).from(members).where(eq(members.id, idSocio)).limit(1);
		return socio;
	};

	/** GET /consensi → { consensi: { marketing_email: { valore, fonte, il }, … } } */
	fastify.get('/consensi', async (request) => {
		const socio = await personaDelSocio(request.idSocio);
		return { consensi: await consensiDi(socio.personaId) };
	});

	/** PUT /consensi { tipo, valore: false } → { consensi }. Solo per togliere. */
	fastify.put('/consensi', async (request, reply) => {
		const { tipo, valore } = request.body ?? {};
		if (!tipoConsensoValido(tipo)) return reply.code(400).send({ error: 'Tipo di consenso non valido.' });
		if (valore !== false) return reply.code(400).send({ error: 'Dal portale un consenso si può solo revocare.' });
		const socio = await personaDelSocio(request.idSocio);
		await db.insert(consensi).values({ personaId: socio.personaId, tipo, valore, fonte: 'portale', autoreNome: socio.nome });
		return { consensi: await consensiDi(socio.personaId) };
	});
}

/**
 * Che cosa c'è da sistemare per il socio adesso: l'abbonamento, con la stessa regola del controllo
 * degli ingressi (shared/avvisi.js). Si calcola a ogni lettura e non si salva: un avviso sparisce
 * da solo quando il socio rinnova.
 */
async function avvisiDelSocio(memberId) {
	const [[socio], iscrizioni] = await Promise.all([
		db.select({ dateOfBirth: members.dateOfBirth, archiviatoIl: members.archiviatoIl }).from(members).where(eq(members.id, memberId)).limit(1),
		iscrizioniDelSocio(memberId),
	]);
	return avvisiSocio({ socio: { date_of_birth: socio?.dateOfBirth, archiviato_il: socio?.archiviatoIl }, iscrizioni })
		.map(({ codice, gravita, titolo, testo, azione }) => ({ codice, gravita, titolo, testo, azione }));
}

// --- Le date ------------------------------------------------------------------------
//
// Tutto in giorni interi sul calendario, senza ore: una scadenza è un giorno, non un
// istante, e confrontare istanti farebbe dire "scade fra 0 giorni" a un abbonamento che
// scade stasera e "fra 1" a uno che scade domani mattina presto. Il conto sta in
// `shared/giorni.js`, e "oggi" è quello di Roma.

function entroGiorni(data, soglia) {
	const giorni = giorniDaOggi(data);
	return giorni !== null && giorni <= soglia;
}

// Il calendario del portale chiede due mesi; tre bastano a qualunque vista ragionevole.
const GIORNI_MASSIMI_AGENDA = 92;
const E_UNA_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Perché l'intervallo chiesto all'agenda non va bene, o null. */
function motivoIntervalloNonValido(dal, al) {
	if (!E_UNA_DATA.test(String(dal)) || !eUnGiorno(dal)) return 'La data di inizio non è valida (AAAA-MM-GG).';
	if (!E_UNA_DATA.test(String(al)) || !eUnGiorno(al)) return 'La data di fine non è valida (AAAA-MM-GG).';
	if (al < dal) return 'La data di fine non può precedere quella di inizio.';
	if (giorniFra(dal, al) > GIORNI_MASSIMI_AGENDA) {
		return `L'agenda si chiede per al massimo ${GIORNI_MASSIMI_AGENDA} giorni alla volta.`;
	}
	return null;
}

// --- Le lezioni come le vede il socio -----------------------------------------------------

const E_UN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vera se la prenotazione ha un posto offerto ancora aperto. */
const offertaAperta = (b, adesso) => b.status === 'waitlisted' && b.postoOffertoFinoA && new Date(b.postoOffertoFinoA) > adesso;

/**
 * Vera se la lista d'attesa di una lezione va rimessa in regola prima di leggerla: un'offerta
 * scaduta, o un posto libero non ancora offerto mentre la lista è aperta (`regolaOfferte`).
 */
function daRegolare(lezione, ore, vive, adesso) {
	const coda = vive.filter((b) => b.status === 'waitlisted');
	if (!coda.length || lezione.status !== 'active' || lezioneFinita(lezione, adesso)) return false;
	if (coda.some((b) => b.postoOffertoFinoA && new Date(b.postoOffertoFinoA) <= adesso)) return true;
	const occupati = vive.filter((b) => b.status === 'confirmed' || offertaAperta(b, adesso)).length;
	return occupati < (lezione.capacity ?? 0) && adesso < chiusuraLista(lezione, ore) && coda.some((b) => !offertaAperta(b, adesso));
}

/**
 * Le lezioni scelte da `dove` (una condizione su `sessions`), descritte per il socio: posti
 * contati, la sua prenotazione, se e perché non può prenotare o disdire, quando chiude la lista
 * d'attesa. Prima di contare, le liste d'attesa che ne hanno bisogno si mettono in regola (le
 * offerte scadute si leggono dalle date: non c'è un processo che le guardi).
 *
 * @param ancheDisdette se il socio non ha una prenotazione viva, la sua ultima disdetta (Le mie
 *   lezioni la mostra come tale)
 */
async function lezioniPerIlSocio(idSocio, dove, { ancheDisdette = false, adesso = new Date() } = {}) {
	const righe = await db
		.select({
			sessione: sessions,
			evento: { id: events.id, ricorrenza: events.recurrenceType },
			corso: { id: courses.id, nome: courses.name, descrizione: courses.description, disdettaEntroOre: courses.disdettaEntroOre },
			categoria: { id: categories.id, nome: categories.name, colore: categories.color },
			istruttore: { id: instructors.id, nome: instructors.fullName },
			sala: { id: rooms.id, nome: rooms.name },
		})
		.from(sessions)
		.innerJoin(events, eq(sessions.eventId, events.id))
		.innerJoin(courses, eq(events.courseId, courses.id))
		.leftJoin(categories, eq(courses.categoryId, categories.id))
		.leftJoin(instructors, eq(courses.instructorId, instructors.id))
		.leftJoin(rooms, eq(sessions.roomId, rooms.id))
		.where(dove)
		.orderBy(sessions.date, sessions.startTime);
	if (!righe.length) return [];

	const idLezioni = righe.map((r) => r.sessione.id);
	const leggi = () => db.select().from(bookings).where(and(
		inArray(bookings.sessionId, idLezioni),
		ancheDisdette ? or(ne(bookings.status, 'cancelled'), eq(bookings.memberId, idSocio)) : ne(bookings.status, 'cancelled'),
	)).orderBy(desc(bookings.createdDate));
	let prenotazioni = await leggi();
	const viveDi = (id) => prenotazioni.filter((p) => p.sessionId === id && p.status !== 'cancelled');
	const storte = righe.filter((r) => daRegolare(r.sessione, r.corso.disdettaEntroOre, viveDi(r.sessione.id), adesso));
	if (storte.length) {
		for (const r of storte) await db.transaction((tx) => regolaOfferte(tx, r.sessione.id, adesso));
		prenotazioni = await leggi();
	}

	// Se il socio può prenotare quella lezione lo dice il server, con la stessa regola che
	// applica quando la prenotazione arriva: così il portale lo mostra prima del pulsante.
	const [mieIscrizioni, mieFisse] = await Promise.all([iscrizioniDelSocio(idSocio), elencoFisse({ memberId: idSocio })]);
	const fisse = new Set(mieFisse.map((f) => f.event_id));

	return righe.map((r) => {
		const s = r.sessione;
		const vive = viveDi(s.id);
		const mie = prenotazioni.filter((p) => p.sessionId === s.id && String(p.memberId) === String(idSocio));
		const mia = mie.find((p) => p.status !== 'cancelled') ?? (ancheDisdette ? mie[0] : null);
		const confermati = vive.filter((p) => p.status === 'confirmed').length;
		const offerti = vive.filter((p) => offertaAperta(p, adesso)).length;
		const capienza = s.capacity ?? 0;
		const finita = lezioneFinita(s, adesso);
		const chiusura = chiusuraLista(s, r.corso.disdettaEntroOre);
		const limite = limiteDisdetta(s, r.corso.disdettaEntroOre);
		const liberi = Math.max(0, capienza - confermati - offerti);
		const listaChiusa = adesso >= chiusura;
		const annullata = s.status !== 'active';
		return {
			id: s.id,
			sessione_id: r.evento.id,
			data: s.date,
			inizio: s.startTime,
			fine: s.endTime,
			corso: { id: r.corso.id, nome: r.corso.nome, descrizione: r.corso.descrizione },
			categoria: r.categoria?.id ? r.categoria : null,
			istruttore: r.istruttore?.id ? r.istruttore : null,
			sala: r.sala?.id ? r.sala : null,
			// I posti offerti a chi è in lista contano come occupati: sono suoi finché non scade.
			posti: {
				capienza,
				confermati,
				liberi,
				in_attesa: vive.filter((p) => p.status === 'waitlisted').length,
				al_completo: liberi === 0,
			},
			// null se si può prenotare; altrimenti il perché, da mostrare al posto del pulsante.
			// Una lezione di oggi già finita resta in agenda, ma non si prenota né si disdice.
			motivo_non_prenotabile: annullata ? 'La lezione è stata annullata.'
				: finita ? 'La lezione è già finita.'
					: liberi === 0 && listaChiusa && !mia ? "La lezione è piena e la lista d'attesa è chiusa."
						: motivoSenzaCopertura(mieIscrizioni, s.date),
			finita,
			annullata,
			// Fino a quando il socio può disdire da sé ("AAAA-MM-GGTHH:MM", ora di Roma), null se
			// fino alla fine; e, se il termine è passato, il perché.
			disdetta_fino_a: limite ? `${limite.data}T${limite.ora}` : null,
			motivo_disdetta_chiusa: motivoDisdettaChiusa(s, r.corso.disdettaEntroOre, adesso),
			// Fino a quando si entra in lista d'attesa e si ricevono offerte: poi il posto che si
			// libera è di chi lo prende.
			lista_chiude_il: chiusura?.toISOString() ?? null,
			lista_chiusa: listaChiusa,
			// La serie della lezione, se è una serie: è ciò su cui si prenota fisso.
			serie: r.evento.ricorrenza === 'weekly' || r.evento.ricorrenza === 'custom'
				? { id: r.evento.id, mia_fissa: fisse.has(r.evento.id) }
				: null,
			mia_prenotazione: mia
				? {
					id: mia.id,
					stato: mia.status,
					posizione_attesa: mia.waitlistPosition,
					// Un posto offerto, aperto: si conferma con «prenota».
					posto_offerto_fino_a: offertaAperta(mia, adesso) ? new Date(mia.postoOffertoFinoA).toISOString() : null,
					fissa: Boolean(mia.prenotazioneFissaId),
					motivo_disdetta: mia.motivoDisdetta ?? null,
					creata_il: mia.createdDate,
				}
				: null,
		};
	});
}

const vuoto = (v) => v === null || v === undefined || v === '';

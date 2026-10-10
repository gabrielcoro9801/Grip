import { eq, and, gte, lte, inArray, ne, desc, isNull, count } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
	members, subscriptions, memberDocuments, qrAccessi,
	courses, categories, instructors, rooms, events, sessions, bookings, notifiche, consensi,
} from '../../db/schema/index.js';
import { consensiDi } from '../persone.js';
import { tipoConsensoValido } from '../../../../shared/consensi.js';
import { getUserFromRequest } from '../../auth/tokens.js';
import { socioDiAccount } from '../../auth/socioCorrente.js';
import { codiceDinamico } from '../../lib/qrDinamico.js';
import { prenota, disdici } from '../../lib/prenotazioni.js';
import { firmaUrl } from '../../lib/urlFirmati.js';
import { msResiduiFinestra } from '../../../../shared/qrDinamico.js';
import { nomeDocumento, conStatoDocumenti } from '../../../../shared/anagrafica.js';
import { statoIscrizione, abbonamentoCopre, MESSAGGIO_SENZA_ABBONAMENTO } from '../../../../shared/abbonamenti.js';
import { oggiIso, eUnGiorno, giorniFra, giorniDaOggi, spostaGiorni, lezioneFinita } from '../../../../shared/giorni.js';
import { limiteDisdetta, motivoDisdettaChiusa } from '../../../../shared/corsi.js';
import { applicaFisse, creaFissa, terminaFissa, elencoFisse } from '../../lib/prenotazioniFisse.js';
import { avvisiSocio } from '../../../../shared/avvisi.js';

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
 * `curl`. Dentro `v1` si **aggiunge**: non si toglie un campo e non se ne rinomina uno. Un
 * campo che non serve più resta e si documenta come ignorato. Rompere significa `v2`, con
 * `v1` vivo finché esistono installazioni che lo usano.
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
	 * `giorni_alla_scadenza` e `in_scadenza` li calcola il server. Oggi quelle soglie vivono
	 * nel browser in due punti diversi — sette giorni in `MemberDashboard`, trenta in
	 * `MemberDocuments` — cioè la stessa politica scritta due volte, in un posto dove nessuno
	 * la cerca. Stando qui è una sola, ed è anche ciò che libera un client mobile dal doversi
	 * portare dietro una libreria di date per rispondere a "scade presto?".
	 */
	fastify.get('/profilo', async (request) => {
		const [socio] = await db.select().from(members).where(eq(members.id, request.idSocio)).limit(1);
		if (!socio) return { socio: null, abbonamento: null, documenti: null };

		const abbonamenti = await db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.memberId, request.idSocio))
			.orderBy(desc(subscriptions.startDate));

		// Servono anche tipo e data di caricamento, non solo la scadenza: un certificato
		// scaduto e già sostituito è archiviato, e non va contato fra quelli scaduti —
		// altrimenti il socio che ha rinnovato si vede un avviso rosso che non sa come
		// togliere. La regola sta in shared/anagrafica.js, la stessa della segreteria.
		const documenti = conStatoDocumenti(
			await db
				.select({
					document_type: memberDocuments.documentType,
					created_date: memberDocuments.createdDate,
					expiry_date: memberDocuments.expiryDate,
				})
				.from(memberDocuments)
				.where(eq(memberDocuments.memberId, request.idSocio)),
			giorniDaOggi
		);

		// La corrente è la più recente ancora valida oggi; se non ce n'è, l'ultima scaduta. La
		// colonna `status` non si guarda: nessuno la aggiorna, e sceglieva come "corrente" anche
		// un abbonamento scaduto da mesi.
		const statoDi = (a) => statoIscrizione({ end_date: a.endDate });
		const corrente = abbonamenti.find((a) => statoDi(a) !== 'expired') ?? abbonamenti[0] ?? null;

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
				piano: corrente.planName,
				stato: statoDi(corrente),
				inizio: corrente.startDate,
				fine: corrente.endDate,
				giorni_alla_scadenza: giorniDaOggi(corrente.endDate),
				in_scadenza: entroGiorni(corrente.endDate, 7),
			},
			documenti: {
				totale: documenti.length,
				in_scadenza: documenti.filter((d) => d.stato === 'in_scadenza').length,
				scaduti: documenti.filter((d) => d.stato === 'scaduto').length,
			},
		};
	});

	fastify.get('/abbonamenti', async (request) => {
		const righe = await db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.memberId, request.idSocio))
			.orderBy(desc(subscriptions.startDate));

		return {
			abbonamenti: righe.map((a) => ({
				id: a.id,
				piano: a.planName,
				stato: statoIscrizione({ end_date: a.endDate }),
				inizio: a.startDate,
				fine: a.endDate,
				giorni_alla_scadenza: giorniDaOggi(a.endDate),
				prezzo_pagato: a.pricePaid,
			})),
		};
	});

	fastify.get('/documenti', async (request) => {
		const righe = await db
			.select()
			.from(memberDocuments)
			.where(eq(memberDocuments.memberId, request.idSocio))
			.orderBy(desc(memberDocuments.createdDate));

		// Lo stato dipende da tutti i documenti del socio, non dal singolo: un certificato
		// scaduto è "archiviato" se ne è arrivato uno nuovo, "scaduto" se è ancora l'ultimo.
		// I nomi delle colonne qui sono in camelCase, quelli della regola condivisa no.
		const stati = new Map(
			conStatoDocumenti(
				righe.map((d) => ({
					id: d.id,
					document_type: d.documentType,
					created_date: d.createdDate,
					expiry_date: d.expiryDate,
				})),
				giorniDaOggi
			).map((d) => [d.id, d.stato])
		);

		return {
			documenti: righe.map((d) => ({
				id: d.id,
				tipo: d.documentType,
				// Come lo si chiama: "Certificato medico", o il titolo di un documento "altro".
				nome: nomeDocumento({ document_type: d.documentType, titolo: d.titolo }),
				titolo: d.titolo,
				nome_file: d.fileName,
				// Firmato: senza firma /uploads/ non apre piu niente (lib/urlFirmati.js).
				url: firmaUrl(d.fileUrl),
				scadenza: d.expiryDate,
				giorni_alla_scadenza: giorniDaOggi(d.expiryDate),
				// `scaduto` e `in_scadenza` restano quello che dicono: fatti sulla data, e
				// c'erano prima. `stato` è la lettura completa — valido, in_scadenza,
				// scaduto, archiviato — ed è quella che le schermate usano per il bollino.
				scaduto: scaduto(d.expiryDate),
				in_scadenza: entroGiorni(d.expiryDate, 30) && !scaduto(d.expiryDate),
				stato: stati.get(d.id),
				caricato_il: d.createdDate,
				caricato_da: d.caricatoDa,
				note: d.notes,
			})),
		};
	});

	/**
	 * Il codice d'accesso da mostrare alla reception.
	 *
	 * Il codice cambia ogni minuto e lo firma il server con una chiave che non esce da qui.
	 * Il portale prima faceva due richieste — il QR del socio e poi il codice — e questa ne
	 * fa una: davanti al tornello, con la rete della palestra, la differenza si sente.
	 */
	fastify.get('/accesso', async (request) => {
		// Tutti i codici del socio, non solo quelli attivi: "non ne hai uno" e "il tuo è
		// stato revocato" sono due cose diverse da dire a chi sta davanti al tornello, e
		// distinguerle serve a mandarlo alla reception con la domanda giusta.
		const suoi = await db
			.select()
			.from(qrAccessi)
			.where(eq(qrAccessi.clienteId, request.idSocio));

		const attivo = suoi.find((q) => q.stato === 'attivo');
		if (!attivo) {
			const stato = suoi.some((q) => q.stato === 'revocato') ? 'revocato' : 'assente';
			return { stato, attivo: false, codice: null, valido_per_ms: null };
		}

		return {
			stato: 'attivo',
			attivo: true,
			codice: codiceDinamico(attivo.codice),
			valido_per_ms: msResiduiFinestra(),
		};
	});

	// --- I corsi -----------------------------------------------------------------------

	/**
	 * L'agenda delle lezioni prenotabili, già messa in ordine e già contata.
	 *
	 * Sostituisce sette richieste e il lavoro di incrocio che il browser faceva a mano. Dei
	 * posti escono **numeri**, non le prenotazioni altrui: chi frequenta cosa non è un dato
	 * che il portale di un socio abbia ragione di ricevere.
	 */
	fastify.get('/corsi/agenda', async (request, reply) => {
		const oggi = oggiIso();
		const dal = request.query.dal ?? oggi;
		const al = request.query.al ?? spostaGiorni(eUnGiorno(dal) ? dal : oggi, 30);

		// Le date arrivano dalla query così come sono: una malformata finiva al database e
		// tornava come errore 500, e `?dal=2000-01-01&al=2100-01-01` faceva leggere al server
		// tutte le lezioni e tutte le prenotazioni della palestra.
		const motivo = motivoIntervalloNonValido(dal, al);
		if (motivo) return reply.code(400).send({ error: motivo });

		// Prima di mostrare l'agenda, le fisse del socio prenotano quello che devono: è il
		// momento in cui lui guarda, e l'operazione è idempotente.
		await applicaFisse({ memberId: request.idSocio });
		const mieFisse = new Set((await elencoFisse({ memberId: request.idSocio })).map((f) => f.event_id));

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
			.where(and(
				gte(sessions.date, dal),
				lte(sessions.date, al),
				eq(sessions.status, 'active'),
			))
			.orderBy(sessions.date, sessions.startTime);

		const idLezioni = righe.map((r) => r.sessione.id);
		const prenotazioni = idLezioni.length
			? await db
				.select()
				.from(bookings)
				.where(and(inArray(bookings.sessionId, idLezioni), ne(bookings.status, 'cancelled')))
			: [];

		// I conteggi si fanno qui e escono come numeri. Le righe delle prenotazioni non
		// lasciano il server, tranne quella del socio che sta chiedendo.
		const conta = new Map();
		const mie = new Map();
		for (const p of prenotazioni) {
			const c = conta.get(p.sessionId) ?? { confermati: 0, in_attesa: 0 };
			if (p.status === 'confirmed') c.confermati += 1;
			else if (p.status === 'waitlisted') c.in_attesa += 1;
			conta.set(p.sessionId, c);
			if (String(p.memberId) === String(request.idSocio)) mie.set(p.sessionId, p);
		}

		// Se il socio può prenotare quella lezione lo dice il server, con la stessa regola che
		// applica quando la prenotazione arriva: così il portale lo mostra prima del pulsante.
		const mieIscrizioni = await db
			.select({ start_date: subscriptions.startDate, end_date: subscriptions.endDate })
			.from(subscriptions)
			.where(eq(subscriptions.memberId, request.idSocio));

		const giorni = new Map();
		for (const r of righe) {
			const s = r.sessione;
			const c = conta.get(s.id) ?? { confermati: 0, in_attesa: 0 };
			const miaPrenotazione = mie.get(s.id);
			const capienza = s.capacity ?? 0;
			const coperta = abbonamentoCopre(mieIscrizioni, s.date);

			const lezione = {
				id: s.id,
				data: s.date,
				inizio: s.startTime,
				fine: s.endTime,
				corso: { id: r.corso.id, nome: r.corso.nome, descrizione: r.corso.descrizione },
				categoria: r.categoria?.id ? r.categoria : null,
				istruttore: r.istruttore?.id ? r.istruttore : null,
				sala: r.sala?.id ? r.sala : null,
				posti: {
					capienza,
					confermati: c.confermati,
					liberi: Math.max(0, capienza - c.confermati),
					in_attesa: c.in_attesa,
					al_completo: c.confermati >= capienza,
				},
				// null se si può prenotare; altrimenti il perché, da mostrare al posto del pulsante.
				// Una lezione di oggi già finita resta in agenda, ma non si prenota né si disdice.
				motivo_non_prenotabile: lezioneFinita(s) ? 'La lezione è già finita.' : (coperta ? null : MESSAGGIO_SENZA_ABBONAMENTO),
				finita: lezioneFinita(s),
				// Fino a quando il socio può disdire da sé ("AAAA-MM-GGTHH:MM", ora di Roma), null se
				// fino alla fine; e, se il termine è passato, il perché.
				disdetta_fino_a: (() => {
					const limite = limiteDisdetta(s, r.corso.disdettaEntroOre);
					return limite ? `${limite.data}T${limite.ora}` : null;
				})(),
				motivo_disdetta_chiusa: motivoDisdettaChiusa(s, r.corso.disdettaEntroOre),
				// La serie della lezione, se è una serie: è ciò su cui si prenota fisso.
				serie: r.evento.ricorrenza === 'weekly' || r.evento.ricorrenza === 'custom'
					? { id: r.evento.id, mia_fissa: mieFisse.has(r.evento.id) }
					: null,
				mia_prenotazione: miaPrenotazione
					? {
						id: miaPrenotazione.id,
						stato: miaPrenotazione.status,
						posizione_attesa: miaPrenotazione.waitlistPosition,
					}
					: null,
			};

			if (!giorni.has(s.date)) giorni.set(s.date, []);
			giorni.get(s.date).push(lezione);
		}

		return {
			dal,
			al,
			giorni: [...giorni.entries()].map(([data, lezioni]) => ({ data, lezioni })),
		};
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
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });

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

	/** Le prenotazioni fisse attive del socio. */
	fastify.get('/corsi/fisse', async (request) => {
		const fisse = await elencoFisse({ memberId: request.idSocio });
		return {
			fisse: fisse.map((f) => ({
				id: f.id, serie_id: f.event_id, corso: f.corso, giorni: f.giorni ?? f.giorni_serie ?? [],
				inizio: String(f.inizio).slice(0, 5), fine: String(f.fine).slice(0, 5), creata_il: f.creata_il,
			})),
		};
	});

	/**
	 * Prenota fisso in una serie: { giorni? } (i giorni della serie da tenere; assenti = tutti).
	 * Risponde con quante lezioni ha prenotato subito, quante in lista d'attesa e quante sono
	 * rimaste senza abbonamento.
	 */
	fastify.post('/corsi/serie/:id/fissa', async (request, reply) => {
		const [socio] = await db.select({ nome: members.fullName }).from(members).where(eq(members.id, request.idSocio)).limit(1);
		const esito = await creaFissa({ memberId: request.idSocio, eventId: request.params.id, giorni: request.body?.giorni, creataDa: socio?.nome ?? '' });
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });
		reply.code(201);
		return { fissa: { id: esito.fissa.id }, prenotate: esito.esito.prenotate, in_attesa: esito.esito.inAttesa, senza_abbonamento: esito.esito.scoperte };
	});

	/** Termina una propria fissa: le prenotazioni future si disdicono, nel rispetto del termine di disdetta. */
	fastify.delete('/corsi/fisse/:id', async (request, reply) => {
		const esito = await terminaFissa({ fissaId: request.params.id, soloDelSocio: request.idSocio });
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
		const righe = await db.select().from(notifiche)
			.where(eq(notifiche.memberId, request.idSocio))
			.orderBy(desc(notifiche.createdDate))
			.limit(50);
		return {
			...conteggio,
			avvisi_elenco: avvisi,
			notifiche: righe.map((r) => ({
				id: r.id, tipo: r.tipo, titolo: r.titolo, testo: r.testo,
				letta: Boolean(r.lettaIl), creata_il: r.createdDate,
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

	// I consensi alle comunicazioni promozionali (shared/consensi.js): li dà e li toglie il socio,
	// canale per canale. Ogni scelta si aggiunge al registro, con il nome del socio e "portale".
	const personaDelSocio = async (idSocio) => {
		const [socio] = await db.select({ personaId: members.personaId, nome: members.fullName }).from(members).where(eq(members.id, idSocio)).limit(1);
		return socio;
	};

	/** GET /consensi → { consensi: { marketing_email: { valore, fonte, il }, … } } */
	fastify.get('/consensi', async (request) => {
		const socio = await personaDelSocio(request.idSocio);
		return { consensi: await consensiDi(socio.personaId) };
	});

	/** PUT /consensi { tipo, valore } → { consensi } */
	fastify.put('/consensi', async (request, reply) => {
		const { tipo, valore } = request.body ?? {};
		if (!tipoConsensoValido(tipo)) return reply.code(400).send({ error: 'Tipo di consenso non valido.' });
		if (typeof valore !== 'boolean') return reply.code(400).send({ error: 'Indica se dai o togli il consenso.' });
		const socio = await personaDelSocio(request.idSocio);
		await db.insert(consensi).values({ personaId: socio.personaId, tipo, valore, fonte: 'portale', autoreNome: socio.nome });
		return { consensi: await consensiDi(socio.personaId) };
	});
}

/**
 * Che cosa c'è da sistemare per il socio adesso: abbonamento e documenti, con la stessa regola
 * del bancone degli ingressi (shared/avvisi.js). Si calcola a ogni lettura e non si salva: un
 * avviso sparisce da solo quando il socio rinnova o porta il documento.
 */
async function avvisiDelSocio(memberId) {
	const [[socio], iscrizioni, documenti] = await Promise.all([
		db.select({ dateOfBirth: members.dateOfBirth, archiviatoIl: members.archiviatoIl }).from(members).where(eq(members.id, memberId)).limit(1),
		db.select({ start_date: subscriptions.startDate, end_date: subscriptions.endDate }).from(subscriptions).where(eq(subscriptions.memberId, memberId)),
		db.select({ document_type: memberDocuments.documentType, created_date: memberDocuments.createdDate, expiry_date: memberDocuments.expiryDate })
			.from(memberDocuments).where(eq(memberDocuments.memberId, memberId)),
	]);
	return avvisiSocio({ socio: { date_of_birth: socio?.dateOfBirth, archiviato_il: socio?.archiviatoIl }, iscrizioni, documenti })
		.map(({ codice, gravita, titolo, testo, azione }) => ({ codice, gravita, titolo, testo, azione }));
}

// --- Le date ------------------------------------------------------------------------
//
// Tutto in giorni interi sul calendario, senza ore: una scadenza è un giorno, non un
// istante, e confrontare istanti farebbe dire "scade fra 0 giorni" a un abbonamento che
// scade stasera e "fra 1" a uno che scade domani mattina presto. Il conto sta in
// `shared/giorni.js`, e "oggi" è quello di Roma.

function scaduto(data) {
	const giorni = giorniDaOggi(data);
	return giorni !== null && giorni < 0;
}

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

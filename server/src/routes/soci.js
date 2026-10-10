// Quello che la scheda di un socio deve sapere, e poter fare, sul suo accesso al portale.
//
// L'accesso al portale è un account, e gli account si leggono e si scrivono solo da Admin &
// Utenti (auth/authorize.js): da lì si creano gli account dello staff e si assegnano i ruoli.
// La scheda del socio però deve poter dire se l'accesso c'è, e la reception deve poterlo dare
// o reimpostare: è il suo lavoro allo sportello. Queste rotte fanno quello e nient'altro — un
// account con ruolo `member`, collegato a quel socio — con il permesso della scheda, senza
// aprire la tabella degli account a chi gestisce i soci.
//
// Qui stanno anche archiviazione e riattivazione di un socio: toccano il suo accesso, le sue
// prenotazioni e il registro, e non sono una modifica dell'anagrafica come le altre.
import bcrypt from 'bcryptjs';
import { eq, and, ne, gte, lte, isNull, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { attivita, bookings, members, sessions, sospensioni, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';
import { registra } from '../lib/registro.js';
import { disdici } from '../lib/prenotazioni.js';
import { applicaFisse } from '../lib/prenotazioniFisse.js';
import { iscrizioniDelSocio, sospensioniDelSocio } from '../lib/iscrizioni.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { abbonamentoCopre } from '../../../shared/abbonamenti.js';
import { NOTA_DIARIO_MASSIMO, motivoAbbandonoValido, etichettaMotivoAbbandono } from '../../../shared/lead.js';
import { oggiIso, lezioneFinita, eUnGiorno, spostaGiorni } from '../../../shared/giorni.js';

const nomeDi = async (idAccount) => {
	const [a] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, idAccount)).limit(1);
	return a?.nome ?? '';
};

const CAMPI_PUBBLICI = {
	id: staffAccounts.id,
	email: staffAccounts.email,
	attivo: staffAccounts.attivo,
	last_activity_date: staffAccounts.lastActivityDate,
	password_da_cambiare: staffAccounts.passwordDaCambiare,
};

function accountDelSocio(idSocio) {
	return db
		.select(CAMPI_PUBBLICI)
		.from(staffAccounts)
		.where(and(eq(staffAccounts.linkedMemberId, idSocio), eq(staffAccounts.ruolo, 'member')))
		.limit(1)
		.then(([account]) => account ?? null);
}

export default async function sociRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		const azione = request.method === 'GET' ? 'view' : 'edit';
		if (utente.ruolo === 'member' || !canAccess(utente.ruolo, 'crm_members', azione)) {
			return reply.code(403).send({ error: 'Non consentito.' });
		}
		request.utente = utente;
	});

	// GET /api/soci/:id/accesso-portale → { account: {...} | null }
	fastify.get('/api/soci/:id/accesso-portale', async (request) => ({
		account: await accountDelSocio(request.params.id),
	}));

	/**
	 * POST /api/soci/:id/accesso-portale { password } → { account, creato }
	 *
	 * Crea l'accesso se non c'è, altrimenti ne reimposta la password. In entrambi i casi la
	 * password l'ha scelta la reception, che la conosce: al primo accesso il socio deve
	 * cambiarla, e le sessioni già aperte con quella vecchia non valgono più.
	 */
	fastify.post('/api/soci/:id/accesso-portale', async (request, reply) => {
		const password = request.body?.password;
		const nonValida = motivoPasswordNonValida(password);
		if (nonValida) return reply.code(400).send({ error: nonValida });

		const [socio] = await db
			.select({ id: members.id, nome: members.fullName, email: members.email })
			.from(members)
			.where(eq(members.id, request.params.id))
			.limit(1);
		if (!socio) return reply.code(404).send({ error: 'Socio non trovato.' });

		const passwordHash = await bcrypt.hash(password, 10);
		const esistente = await accountDelSocio(socio.id);

		if (esistente) {
			await db
				.update(staffAccounts)
				.set({ passwordHash, passwordDaCambiare: true, tokenVersion: sql`${staffAccounts.tokenVersion} + 1` })
				.where(eq(staffAccounts.id, esistente.id));
			await registra(request.utente, {
				tipoAzione: 'password_reset', entitaTipo: 'staff_account', entitaNome: `Portale socio — ${socio.nome}`,
				entitaId: esistente.id, dettagli: 'Password del portale reimpostata dalla scheda socio',
			}, request.log);
			return { account: await accountDelSocio(socio.id), creato: false };
		}

		// L'email è il nome con cui si entra: senza, il socio non saprebbe cosa scrivere.
		const email = String(socio.email ?? '').trim();
		if (!email) {
			return reply.code(400).send({ error: "Il socio non ha un'email: aggiungila nell'anagrafica, è quella con cui entrerà nel portale." });
		}
		const [giaUsata] = await db
			.select({ id: staffAccounts.id })
			.from(staffAccounts)
			.where(sql`lower(${staffAccounts.email}) = lower(${email})`)
			.limit(1);
		if (giaUsata) {
			return reply.code(400).send({ error: `L'email ${email} è già usata da un altro account.` });
		}

		await db.insert(staffAccounts).values({
			nome: socio.nome || 'Socio',
			email,
			passwordHash,
			ruolo: 'member',
			attivo: true,
			linkedMemberId: socio.id,
			passwordDaCambiare: true,
		});
		const account = await accountDelSocio(socio.id);
		await registra(request.utente, {
			tipoAzione: 'create', entitaTipo: 'staff_account', entitaNome: `Portale socio — ${socio.nome}`,
			entitaId: account?.id, dettagli: 'Accesso al portale creato dalla scheda socio',
		}, request.log);
		reply.code(201);
		return { account, creato: true };
	});

	/**
	 * POST /api/soci/:id/archivia { motivo, nota? } → { socio, prenotazioni_disdette }
	 *
	 * Un socio che lascia la palestra. Non si cancella niente: scheda, abbonamenti e storico
	 * restano, e lo si riattiva quando torna. Da archiviato non compare negli elenchi, non compra
	 * abbonamenti, non prenota, e portale e QR non lo fanno entrare (auth/revoca.js, routes/qr.js).
	 *
	 * Il motivo (MOTIVI_ABBANDONO, shared/lead.js) è obbligatorio: finisce nel diario e la
	 * dashboard conta perché se ne vanno. È anche il modo di chiudere uno "scaduto da recuperare"
	 * che non torna: archiviato, esce da Oggi.
	 *
	 * Le prenotazioni alle lezioni che devono ancora finire si disdicono: tenere il posto a chi
	 * non verrà più lo toglierebbe a chi è in lista d'attesa, che così viene promosso.
	 */
	fastify.post('/api/soci/:id/archivia', async (request, reply) => {
		const motivo = request.body?.motivo;
		const nota = String(request.body?.nota ?? '').trim() || null;
		const [socio] = await db
			.select({ id: members.id, nome: members.fullName, archiviatoIl: members.archiviatoIl, personaId: members.personaId })
			.from(members)
			.where(eq(members.id, request.params.id))
			.limit(1);
		if (!socio) return reply.code(404).send({ error: 'Socio non trovato.' });
		if (socio.archiviatoIl) return { socio: await socioPubblico(socio.id), prenotazioni_disdette: 0 };
		if (!motivoAbbandonoValido(motivo)) return reply.code(400).send({ error: 'Scegli perché se ne va.' });
		if (motivo === 'altro' && !nota) return reply.code(400).send({ error: 'Con «Altro» scrivi il motivo nella nota.' });
		if (nota && nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });

		const oggi = oggiIso();
		const autoreNome = await nomeDi(request.utente.sub);
		// Solo chi archivia davvero scrive il motivo: con un doppio clic la seconda richiesta non
		// trova più niente da archiviare, e la dashboard non conta due abbandoni.
		const archiviato = await db.transaction(async (tx) => {
			const fatto = await tx.update(members).set({ archiviatoIl: oggi, updatedDate: new Date() })
				.where(and(eq(members.id, socio.id), isNull(members.archiviatoIl))).returning({ id: members.id });
			if (fatto.length) await tx.insert(attivita).values({ personaId: socio.personaId, tipo: 'abbandono', esito: motivo, nota, autoreId: request.utente.sub, autoreNome });
			return fatto.length > 0;
		});
		if (!archiviato) return { socio: await socioPubblico(socio.id), prenotazioni_disdette: 0 };

		const future = await db
			.select({ id: bookings.id, date: sessions.date, endTime: sessions.endTime })
			.from(bookings)
			.innerJoin(sessions, eq(bookings.sessionId, sessions.id))
			.where(and(eq(bookings.memberId, socio.id), ne(bookings.status, 'cancelled'), gte(sessions.date, oggi)));
		let disdette = 0;
		for (const p of future.filter((f) => !lezioneFinita(f))) {
			const esito = await disdici({ bookingId: p.id });
			if (!esito.errore) disdette += 1;
		}

		await registra(request.utente, {
			tipoAzione: 'deactivate', entitaTipo: 'member', entitaNome: socio.nome, entitaId: socio.id,
			dettagli: `Archiviato (${etichettaMotivoAbbandono(motivo)})${disdette ? `; prenotazioni future disdette: ${disdette}` : ''}`,
		}, request.log);
		return { socio: await socioPubblico(socio.id), prenotazioni_disdette: disdette };
	});

	/** POST /api/soci/:id/riattiva → { socio }. Torna com'era: portale e QR ripartono da soli. */
	/**
	 * GET /api/soci/:id/sospensioni → { sospensioni: [{ id, dal, al, riprende_il, nota, autore_nome, stato }] }
	 * `stato`: in_corso | futura | finita.
	 */
	fastify.get('/api/soci/:id/sospensioni', async (request) => {
		const oggi = oggiIso();
		return {
			sospensioni: (await sospensioniDelSocio(request.params.id)).reverse().map((s) => ({
				id: s.id, dal: s.dal, al: s.al, riprende_il: spostaGiorni(s.al, 1), nota: s.nota, autore_nome: s.autoreNome,
				stato: s.dal > oggi ? 'futura' : s.al < oggi ? 'finita' : 'in_corso',
			})),
		};
	});

	/**
	 * POST /api/soci/:id/sospensioni { dal, riprende_il, nota? } → 201 { sospensione, prenotazioni_disdette }
	 *
	 * Ferma l'abbonamento da `dal` al giorno prima di `riprende_il`: in quei giorni il socio non
	 * entra e non prenota, e la scadenza slitta di altrettanto (si calcola: shared/abbonamenti.js).
	 * La decide la reception, senza tetti di durata né di numero (scelta della palestra); il motivo
	 * è facoltativo. Si sospende da oggi in avanti, un giorno coperto da un abbonamento, senza
	 * accavallarsi a un'altra sospensione. Le prenotazioni di quei giorni si disdicono: il posto
	 * passa a chi è in lista d'attesa.
	 */
	fastify.post('/api/soci/:id/sospensioni', async (request, reply) => {
		// Giorni, non istanti: "2026-10-10T08:00" passerebbe il controllo e falserebbe i confronti.
		const dal = String(request.body?.dal ?? '').slice(0, 10);
		const ripresa = String(request.body?.riprende_il ?? '').slice(0, 10);
		const nota = String(request.body?.nota ?? '').trim() || null;
		const oggi = oggiIso();
		if (!eUnGiorno(dal) || !eUnGiorno(ripresa)) return reply.code(400).send({ error: 'Indica da quando e quando riprende.' });
		if (dal < oggi) return reply.code(400).send({ error: 'Una sospensione parte da oggi o da un giorno futuro.' });
		if (ripresa <= dal) return reply.code(400).send({ error: 'La ripresa viene dopo il primo giorno di sospensione.' });
		if (nota && nota.length > NOTA_DIARIO_MASSIMO) return reply.code(400).send({ error: `La nota sta in ${NOTA_DIARIO_MASSIMO} caratteri.` });
		const al = spostaGiorni(ripresa, -1);
		const autoreNome = await nomeDi(request.utente.sub);

		const esito = await db.transaction(async (tx) => {
			// Il socio bloccato: due sospensioni insieme, da due postazioni, si accavallerebbero.
			const [socio] = await tx.select({ id: members.id, nome: members.fullName, personaId: members.personaId, archiviatoIl: members.archiviatoIl })
				.from(members).where(eq(members.id, request.params.id)).limit(1).for('update');
			if (!socio) return { errore: 404, messaggio: 'Socio non trovato.' };
			if (socio.archiviatoIl) return { errore: 400, messaggio: 'Il socio è archiviato: riattivalo prima.' };
			const iscrizioni = await iscrizioniDelSocio(socio.id, tx);
			const esistenti = await sospensioniDelSocio(socio.id, tx);
			if (esistenti.some((s) => s.dal <= al && dal <= s.al)) return { errore: 409, messaggio: "Si accavalla a un'altra sospensione." };
			if (!abbonamentoCopre(iscrizioni, dal)) return { errore: 400, messaggio: "Quel giorno non c'è un abbonamento da sospendere." };
			const [sospensione] = await tx.insert(sospensioni).values({ memberId: socio.id, dal, al, nota, autoreNome }).returning();
			await tx.insert(attivita).values({
				personaId: socio.personaId, tipo: 'sospensione', esito: `${dal}/${al}`, nota, autoreId: request.utente.sub, autoreNome,
			});
			return { socio, sospensione };
		});
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio });

		const ferme = await db.select({ id: bookings.id, date: sessions.date, endTime: sessions.endTime })
			.from(bookings).innerJoin(sessions, eq(bookings.sessionId, sessions.id))
			.where(and(eq(bookings.memberId, esito.socio.id), ne(bookings.status, 'cancelled'), gte(sessions.date, dal), lte(sessions.date, al)));
		let disdette = 0;
		for (const p of ferme.filter((f) => !lezioneFinita(f))) {
			if (!(await disdici({ bookingId: p.id })).errore) disdette += 1;
		}
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'member', entitaNome: esito.socio.nome, entitaId: esito.socio.id,
			dettagli: `Abbonamento sospeso dal ${dal} al ${al}${disdette ? `; prenotazioni disdette: ${disdette}` : ''}`,
		}, request.log);
		reply.code(201);
		return { sospensione: { id: esito.sospensione.id, dal, al, riprende_il: ripresa }, prenotazioni_disdette: disdette };
	});

	/**
	 * POST /api/soci/:id/sospensioni/:sid/termina { riprende_il? } → { sospensione | null }
	 *
	 * Il socio torna prima: riprende da `riprende_il` (oggi, se non c'è). Una sospensione non
	 * ancora cominciata, fatta finire prima di partire, si cancella. Accorciare non vuol dire
	 * riscrivere il passato: i giorni già fermi restano fermi.
	 */
	fastify.post('/api/soci/:id/sospensioni/:sid/termina', async (request, reply) => {
		const oggi = oggiIso();
		const ripresa = String(request.body?.riprende_il ?? oggi).slice(0, 10);
		if (!eUnGiorno(ripresa) || ripresa < oggi) return reply.code(400).send({ error: 'Si riprende da oggi o da un giorno futuro.' });
		const [s] = await db.select().from(sospensioni)
			.where(and(eq(sospensioni.id, request.params.sid), eq(sospensioni.memberId, request.params.id))).limit(1);
		if (!s) return reply.code(404).send({ error: 'Sospensione non trovata.' });
		if (ripresa > s.al) return reply.code(400).send({ error: `Riprende già il ${spostaGiorni(s.al, 1)}: si può solo anticipare.` });
		const [socio] = await db.select({ nome: members.fullName, personaId: members.personaId }).from(members).where(eq(members.id, s.memberId)).limit(1);
		const autoreNome = await nomeDi(request.utente.sub);
		const cancellata = ripresa <= s.dal;
		const aggiornata = await db.transaction(async (tx) => {
			await tx.insert(attivita).values({ personaId: socio.personaId, tipo: 'fine_sospensione', esito: ripresa, autoreId: request.utente.sub, autoreNome });
			if (cancellata) { await tx.delete(sospensioni).where(eq(sospensioni.id, s.id)); return null; }
			const [riga] = await tx.update(sospensioni).set({ al: spostaGiorni(ripresa, -1) }).where(eq(sospensioni.id, s.id)).returning();
			return riga;
		});
		// Le fisse riprendono a prenotare i giorni tornati liberi.
		await applicaFisse({ memberId: s.memberId });
		await registra(request.utente, {
			tipoAzione: 'update', entitaTipo: 'member', entitaNome: socio.nome, entitaId: s.memberId,
			dettagli: cancellata ? `Sospensione dal ${s.dal} annullata` : `Sospensione anticipata: riprende il ${ripresa}`,
		}, request.log);
		return { sospensione: aggiornata && { id: aggiornata.id, dal: aggiornata.dal, al: aggiornata.al, riprende_il: ripresa } };
	});

	fastify.post('/api/soci/:id/riattiva', async (request, reply) => {
		const [socio] = await db
			.select({ id: members.id, nome: members.fullName, archiviatoIl: members.archiviatoIl, personaId: members.personaId })
			.from(members)
			.where(eq(members.id, request.params.id))
			.limit(1);
		if (!socio) return reply.code(404).send({ error: 'Socio non trovato.' });
		if (socio.archiviatoIl) {
			const autoreNome = await nomeDi(request.utente.sub);
			await db.transaction(async (tx) => {
				const fatto = await tx.update(members).set({ archiviatoIl: null, updatedDate: new Date() })
					.where(and(eq(members.id, socio.id), isNotNull(members.archiviatoIl))).returning({ id: members.id });
				if (fatto.length) await tx.insert(attivita).values({ personaId: socio.personaId, tipo: 'riattivazione', autoreId: request.utente.sub, autoreNome });
			});
			await registra(request.utente, {
				tipoAzione: 'activate', entitaTipo: 'member', entitaNome: socio.nome, entitaId: socio.id, dettagli: 'Riattivato',
			}, request.log);
		}
		return { socio: await socioPubblico(socio.id) };
	});
}

async function socioPubblico(id) {
	const [socio] = await db
		.select({ id: members.id, full_name: members.fullName, archiviato_il: members.archiviatoIl })
		.from(members)
		.where(eq(members.id, id))
		.limit(1);
	return socio ?? null;
}

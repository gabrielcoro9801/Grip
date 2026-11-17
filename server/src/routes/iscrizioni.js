// L'iscrizione di un socio in un passo: anagrafica, abbonamento, privacy e accesso al portale
// insieme, in una transazione. O si salva tutto, o niente: prima erano tre schermate e
// tre salvataggi, e un errore al terzo lasciava un socio a metà (senza abbonamento, o senza accesso).
//
// Un ex socio che torna ritrova la sua scheda, con il suo codice e la sua storia: lo si
// riconosce dal codice fiscale. (Fino al 17/11/2026 si iscriveva anche un contatto, `lead_id`:
// i lead sono usciti dall'applicazione, archivio/lead.)
//
// Le regole di ogni pezzo sono quelle di sempre — l'anagrafica (`anagraficaSocio`), la vendita di
// un abbonamento (le trasformazioni dell'endpoint generico, entities/hooks.js), la password
// (shared/password.js) — chiamate dentro la stessa transazione.
//
// Il certificato medico e i consensi promozionali con il modulo firmato non si raccolgono più qui:
// i documenti sono usciti dall'applicazione a novembre 2026 (docs/piani/portale.md).
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members, attivita, subscriptions, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { anagraficaSocio, applyWriteTransform, verificaCampiFile, rifiuta } from '../entities/hooks.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import { registra } from '../lib/registro.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';

// Quello che l'iscrizione può scrivere sul socio. Il codice socio e le date di sistema restano
// fuori: il codice lo assegna il contatore. Il consenso privacy non viene dall'anagrafica: è il
// suo passo, `informativa_privacy`.
const CAMPI_SOCIO = [
	'nome', 'cognome', 'sesso', 'codice_fiscale', 'email', 'phone', 'date_of_birth', 'address',
	'emergency_contact_name', 'emergency_contact_phone', 'notes', 'foto_url', 'consenso_genitori_firmato',
];

const scegli = (corpo, campi) => Object.fromEntries(campi.filter((c) => c in (corpo ?? {})).map((c) => [c, corpo[c]]));

export default async function iscrizioniRoutes(fastify) {
	registerPgErrorHandler(fastify);

	fastify.addHook('preHandler', async (request, reply) => {
		const utente = getUserFromRequest(request);
		if (!utente) return reply.code(401).send({ error: 'Non autenticato.' });
		request.utente = utente;
	});

	/**
	 * POST /api/iscrivi → 201 { member, riattivato, accesso_portale }
	 *
	 *   {
	 *     anagrafica: { nome, cognome, sesso, codice_fiscale, date_of_birth, … },
	 *     abbonamento?: { plan_id, start_date?, price_paid? },
	 *     informativa_privacy: true,                  — l'informativa firmata in reception
	 *     portale?: { password }                      — l'accesso, con l'email dell'anagrafica
	 *   }
	 *
	 * Serve poter scrivere i soci. Il socio non ha questo permesso, per costruzione. `certificato`, `consensi` e `modulo_consensi` (i passi
	 * di prima) si rifiutano: un client vecchio non deve credere di averli salvati.
	 */
	fastify.post('/api/iscrivi', async (request, reply) => {
		const corpo = request.body ?? {};
		const ruolo = request.utente.ruolo;
		const puo = (entita) => canWriteEntity(ruolo, entita);
		if (!puo('Member')) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
		}

		// Prima di aprire la transazione, quello che si controlla senza il database.
		const anagrafica = anagraficaSocio(scegli(corpo.anagrafica, CAMPI_SOCIO), { creazione: true });
		if (corpo.certificato || corpo.consensi || corpo.modulo_consensi) {
			return reply.code(400).send({ error: "Certificato e consensi promozionali non si raccolgono più all'iscrizione." });
		}
		verificaCampiFile({ foto_url: anagrafica.foto_url });
		if (corpo.informativa_privacy !== true) return reply.code(400).send({ error: "Serve l'informativa privacy firmata." });
		const password = corpo.portale?.password;
		if (corpo.portale) {
			const nonValida = motivoPasswordNonValida(password);
			if (nonValida) return reply.code(400).send({ error: nonValida });
			if (!String(anagrafica.email ?? '').trim()) return reply.code(400).send({ error: "Per l'accesso al portale serve l'email: è quella con cui entrerà." });
		}
		const passwordHash = corpo.portale ? await bcrypt.hash(password, 10) : null;
		const [autore] = await db.select({ nome: staffAccounts.nome }).from(staffAccounts).where(eq(staffAccounts.id, request.utente.sub)).limit(1);
		const autoreNome = autore?.nome ?? '';

		const esito = await db.transaction(async (tx) => {
			// Chi è: un ex socio con lo stesso codice fiscale, o nessuno.
			const [gia] = await tx.select({ id: members.id, archiviatoIl: members.archiviatoIl }).from(members)
				.where(sql`upper(${members.codiceFiscale}) = ${anagrafica.codice_fiscale}`).limit(1).for('update');
			if (gia && !gia.archiviatoIl) return { errore: 409, messaggio: 'È già socio: con questo codice fiscale c\'è una scheda attiva.', socio_id: gia.id };

			let socio;
			if (gia) {
				[socio] = await tx.update(members)
					.set({ ...translateToJs(members, anagrafica), archiviatoIl: null, updatedDate: new Date() })
					.where(eq(members.id, gia.id)).returning();
			} else {
				[socio] = await tx.insert(members)
					.values({ ...translateToJs(members, anagrafica), codiceSocio: await assegnaCodiceSocio(tx) })
					.returning();
			}
			await tx.insert(attivita).values({
				personaId: socio.personaId, tipo: 'iscrizione',
				esito: gia ? 'riattivato' : 'nuovo', autoreId: request.utente.sub, autoreNome,
			});

			// L'abbonamento, con le regole dell'endpoint generico (un tipo vendibile, la scadenza dal
			// tipo). Un rifiuto annulla tutto.
			let abbonamento = null;
			if (corpo.abbonamento) {
				const vendita = await applyWriteTransform('Subscription', { ...scegli(corpo.abbonamento, ['plan_id', 'start_date', 'price_paid']), member_id: socio.id }, { conn: tx });
				[abbonamento] = await tx.insert(subscriptions).values(translateToJs(subscriptions, vendita)).returning();
			}

			// L'accesso al portale: un account `member` collegato al socio, con la password scelta qui,
			// da cambiare al primo accesso. Un ex socio che l'aveva ancora la ritrova reimpostata.
			let accesso = null;
			if (passwordHash) {
				const [suo] = await tx.select({ id: staffAccounts.id }).from(staffAccounts).where(eq(staffAccounts.linkedMemberId, socio.id)).limit(1);
				if (suo) {
					await tx.update(staffAccounts)
						// Con l'email di oggi: è quella che la reception gli dice di usare.
						.set({ email: String(socio.email).trim(), passwordHash, passwordDaCambiare: true, attivo: true, tokenVersion: sql`${staffAccounts.tokenVersion} + 1` })
						.where(eq(staffAccounts.id, suo.id));
					accesso = 'reimpostato';
				} else {
					const email = String(socio.email).trim();
					const [usata] = await tx.select({ id: staffAccounts.id }).from(staffAccounts).where(sql`lower(${staffAccounts.email}) = lower(${email})`).limit(1);
					if (usata) throw rifiuta(`L'email ${email} è già usata da un altro account.`);
					await tx.insert(staffAccounts).values({
						nome: socio.fullName || 'Socio', email, passwordHash, ruolo: 'member', attivo: true, linkedMemberId: socio.id, passwordDaCambiare: true,
					});
					accesso = 'creato';
				}
			}
			return { socio, riattivato: Boolean(gia), abbonamento, accesso };
		});
		if (esito.errore) return reply.code(esito.errore).send({ error: esito.messaggio, ...(esito.socio_id ? { socio_id: esito.socio_id } : {}) });

		const { socio, riattivato, abbonamento, accesso } = esito;
		const pezzi = [abbonamento && `abbonamento ${abbonamento.planName}`, accesso && 'accesso al portale'].filter(Boolean);
		await registra(request.utente, {
			tipoAzione: riattivato ? 'activate' : 'create', entitaTipo: 'member', entitaNome: socio.fullName, entitaId: socio.id,
			dettagli: `${riattivato ? 'Tornato socio' : 'Iscritto'}${pezzi.length ? `, con ${pezzi.join(', ')}` : ''}`,
		}, request.log);
		reply.code(201);
		return { member: translateToSnakeCase(members, socio), riattivato, accesso_portale: accesso };
	});
}

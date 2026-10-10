// L'iscrizione di un socio in un passo: anagrafica, abbonamento, certificato, privacy e accesso al
// portale insieme, in una transazione. O si salva tutto, o niente: prima erano tre schermate e
// tre salvataggi, e un errore al terzo lasciava un socio a metà (senza abbonamento, o senza accesso).
//
// Si iscrive un contatto (`lead_id`: la trattativa si chiude come *iscritto*, il diario resta alla
// persona) o chi entra direttamente. In tutti e due i casi un ex socio che torna ritrova la sua
// scheda, con il suo codice e la sua storia: dal contatto lo si riconosce dalla persona, entrando
// direttamente dal codice fiscale.
//
// Le regole di ogni pezzo sono quelle di sempre — l'anagrafica (`anagraficaSocio`), la vendita di
// un abbonamento e il documento (le trasformazioni dell'endpoint generico, entities/hooks.js), la
// password (shared/password.js) — chiamate dentro la stessa transazione.
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members, trattative, attivita, subscriptions, memberDocuments, staffAccounts, consensi } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canWriteEntity } from '../auth/authorize.js';
import { translateToJs, translateToSnakeCase } from '../entities/columnMaps.js';
import { anagraficaSocio, applyWriteTransform, verificaCampiFile, rifiuta } from '../entities/hooks.js';
import { assegnaCodiceSocio } from '../lib/codiceSocio.js';
import { registra } from '../lib/registro.js';
import { registerPgErrorHandler } from './errorHandler.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';
import { tipoConsensoValido } from '../../../shared/consensi.js';
import { oggiIso } from '../../../shared/giorni.js';

// Quello che l'iscrizione può scrivere sul socio. Il codice socio e le date di sistema restano
// fuori: il codice lo assegna il contatore. Il consenso privacy non viene dall'anagrafica: è il
// suo passo, `informativa_privacy`.
const CAMPI_SOCIO = [
	'nome', 'cognome', 'sesso', 'codice_fiscale', 'email', 'phone', 'date_of_birth', 'address',
	'emergency_contact_name', 'emergency_contact_phone', 'notes', 'foto_url',
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
	 *     lead_id?,                                   — il contatto che si iscrive
	 *     anagrafica: { nome, cognome, sesso, codice_fiscale, date_of_birth, … },
	 *     abbonamento?: { plan_id, start_date?, price_paid? },
	 *     certificato?: { file_url, file_name?, expiry_date },
	 *     informativa_privacy: true,                  — l'informativa firmata in reception
	 *     consensi?: { marketing_email?: bool, marketing_sms?: bool, marketing_push?: bool },
	 *     portale?: { password }                      — l'accesso, con l'email dell'anagrafica
	 *   }
	 *
	 * Serve poter scrivere i soci; i contatti se si iscrive un contatto, i documenti se c'è il
	 * certificato. Il socio non ha nessuno di questi permessi, per costruzione.
	 */
	fastify.post('/api/iscrivi', async (request, reply) => {
		const corpo = request.body ?? {};
		const ruolo = request.utente.ruolo;
		const puo = (entita) => canWriteEntity(ruolo, entita);
		if (!puo('Member') || (corpo.lead_id && !puo('Lead')) || (corpo.certificato && !puo('MemberDocument'))) {
			return reply.code(403).send({ error: 'Il tuo ruolo non consente questa operazione.' });
		}

		// Prima di aprire la transazione, quello che si controlla senza il database.
		const anagrafica = anagraficaSocio(scegli(corpo.anagrafica, CAMPI_SOCIO), { creazione: true });
		verificaCampiFile({ foto_url: anagrafica.foto_url, file_url: corpo.certificato?.file_url });
		if (corpo.informativa_privacy !== true) return reply.code(400).send({ error: "Serve l'informativa privacy firmata." });
		const oggi = oggiIso();
		anagrafica.gdpr_consent = true;
		anagrafica.gdpr_consent_date = oggi;
		const sceltiConsensi = Object.entries(corpo.consensi ?? {});
		if (sceltiConsensi.some(([tipo, valore]) => !tipoConsensoValido(tipo) || typeof valore !== 'boolean')) {
			return reply.code(400).send({ error: 'Consensi non validi.' });
		}
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
			// Chi è: un contatto (e la sua persona), un ex socio con lo stesso codice fiscale, o nessuno.
			let trattativa = null;
			let gia = null;
			if (corpo.lead_id) {
				[trattativa] = await tx.select().from(trattative).where(eq(trattative.id, corpo.lead_id)).limit(1).for('update');
				// Già iscritto — da un collega, o da un doppio clic — oppure eliminato.
				if (!trattativa || trattativa.stato === 'iscritto') return { errore: 404, messaggio: 'Il contatto non esiste più: forse è già stato iscritto.' };
				[gia] = await tx.select({ id: members.id, archiviatoIl: members.archiviatoIl }).from(members)
					.where(eq(members.personaId, trattativa.personaId)).limit(1).for('update');
			} else {
				[gia] = await tx.select({ id: members.id, archiviatoIl: members.archiviatoIl }).from(members)
					.where(sql`upper(${members.codiceFiscale}) = ${anagrafica.codice_fiscale}`).limit(1).for('update');
				if (gia && !gia.archiviatoIl) return { errore: 409, messaggio: 'È già socio: con questo codice fiscale c\'è una scheda attiva.', socio_id: gia.id };
			}

			let socio;
			if (gia) {
				[socio] = await tx.update(members)
					.set({ ...translateToJs(members, anagrafica), archiviatoIl: null, updatedDate: new Date() })
					.where(eq(members.id, gia.id)).returning();
			} else {
				[socio] = await tx.insert(members)
					.values({ ...translateToJs(members, anagrafica), codiceSocio: await assegnaCodiceSocio(tx), ...(trattativa ? { personaId: trattativa.personaId } : {}) })
					.returning();
			}
			if (trattativa) {
				await tx.update(trattative)
					.set({ stato: 'iscritto', statoDal: oggi, richiamareIl: null, updatedDate: new Date() })
					.where(eq(trattative.id, trattativa.id));
			}
			await tx.insert(attivita).values({
				personaId: socio.personaId, trattativaId: trattativa?.id ?? null, tipo: 'iscrizione',
				esito: gia ? 'riattivato' : 'nuovo', autoreId: request.utente.sub, autoreNome,
			});

			// L'abbonamento e il certificato, con le regole dell'endpoint generico (un tipo vendibile,
			// la scadenza dal tipo; il tipo di documento e la sua scadenza). Un rifiuto annulla tutto.
			let abbonamento = null;
			if (corpo.abbonamento) {
				const vendita = await applyWriteTransform('Subscription', { ...scegli(corpo.abbonamento, ['plan_id', 'start_date', 'price_paid']), member_id: socio.id }, { conn: tx });
				[abbonamento] = await tx.insert(subscriptions).values(translateToJs(subscriptions, vendita)).returning();
			}
			if (corpo.certificato) {
				const documento = await applyWriteTransform('MemberDocument', {
					...scegli(corpo.certificato, ['file_url', 'file_name', 'expiry_date']),
					document_type: 'certificato_medico', member_id: socio.id, caricato_da: autoreNome,
				}, { conn: tx });
				if (!documento.file_url) throw rifiuta('Carica il certificato, o salta il passo.');
				await tx.insert(memberDocuments).values(translateToJs(memberDocuments, documento));
			}

			if (sceltiConsensi.length) {
				await tx.insert(consensi).values(sceltiConsensi.map(([tipo, valore]) => ({ personaId: socio.personaId, tipo, valore, fonte: 'reception', autoreNome })));
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
		const pezzi = [abbonamento && `abbonamento ${abbonamento.planName}`, corpo.certificato && 'certificato', accesso && 'accesso al portale'].filter(Boolean);
		await registra(request.utente, {
			tipoAzione: riattivato ? 'activate' : 'create', entitaTipo: 'member', entitaNome: socio.fullName, entitaId: socio.id,
			dettagli: `${riattivato ? 'Tornato socio' : 'Iscritto'}${corpo.lead_id ? ' da un contatto (lead)' : ''}${pezzi.length ? `, con ${pezzi.join(', ')}` : ''}`,
		}, request.log);
		reply.code(201);
		return { member: translateToSnakeCase(members, socio), riattivato, accesso_portale: accesso };
	});
}

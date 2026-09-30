// Quello che la scheda di un socio deve sapere, e poter fare, sul suo accesso al portale.
//
// L'accesso al portale è un account, e gli account si leggono e si scrivono solo da Admin &
// Utenti (auth/authorize.js): da lì si creano gli account dello staff e si assegnano i ruoli.
// La scheda del socio però deve poter dire se l'accesso c'è, e la reception deve poterlo dare
// o reimpostare: è il suo lavoro allo sportello. Queste rotte fanno quello e nient'altro — un
// account con ruolo `member`, collegato a quel socio — con il permesso della scheda, senza
// aprire la tabella degli account a chi gestisce i soci.
import bcrypt from 'bcryptjs';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { members, staffAccounts } from '../db/schema/index.js';
import { getUserFromRequest } from '../auth/tokens.js';
import { canAccess } from '../../../shared/permissions.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';
import { registra } from '../lib/registro.js';

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
}

// Autenticazione applicativa: sostituisce il provider esterno usato prima e il confronto di
// password in chiaro che StaffAuthContext/MemberAuthContext facevano lato browser.
// Un solo sistema per staff e member, distinti dal campo `ruolo`.
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts } from '../db/schema/index.js';
import { signToken, getUserFromRequest } from '../auth/tokens.js';
import { revocaSessioniDi } from '../auth/revoca.js';
import { matriceCorrente } from '../../../shared/permissions.js';

// Ciò che il client può vedere di un account: mai l'hash della password.
//
// Include i permessi del suo ruolo, perché la matrice non è più una costante del codice:
// l'interfaccia deve sapere cosa mostrare, e deve saperlo da chi la decide. Sono i permessi
// del solo ruolo dell'utente — gli altri non lo riguardano.
function toPublicUser(account) {
	const matrice = matriceCorrente();
	return {
		id: account.id,
		nome: account.nome,
		email: account.email,
		ruolo: account.ruolo,
		attivo: account.attivo,
		linked_collaboratore_id: account.linkedCollaboratoreId,
		linked_member_id: account.linkedMemberId,
		permessi: matrice.permessi[account.ruolo] ?? {},
		capacita: matrice.capacita[account.ruolo] ?? [],
	};
}

export default async function authRoutes(fastify) {
	// POST /api/auth/login  { email, password }
	fastify.post('/api/auth/login', async (request, reply) => {
		const { email, password } = request.body ?? {};
		if (!email || !password) {
			return reply.code(400).send({ error: 'Email e password sono obbligatorie.' });
		}

		// Confronto case-insensitive sull'email: gli utenti digitano l'indirizzo
		// con maiuscole variabili e un login fallito per questo sarebbe incomprensibile.
		const [account] = await db
			.select()
			.from(staffAccounts)
			.where(sql`lower(${staffAccounts.email}) = lower(${email})`)
			.limit(1);

		// Messaggio volutamente identico in tutti i casi di fallimento: non rivelare
		// se l'email esiste, se è disattivata o se è solo la password a essere errata.
		const invalid = { error: 'Credenziali non valide.' };
		if (!account || !account.attivo) return reply.code(401).send(invalid);

		const passwordOk = await bcrypt.compare(password, account.passwordHash);
		if (!passwordOk) return reply.code(401).send(invalid);

		await db
			.update(staffAccounts)
			.set({ lastActivityDate: new Date() })
			.where(eq(staffAccounts.id, account.id));

		const user = toPublicUser(account);
		// `tv` nel token: e' cio che permette di revocare questa sessione (auth/revoca.js).
		return { token: signToken({ sub: account.id, ruolo: account.ruolo, tv: account.tokenVersion }), user };
	});

	// GET /api/auth/me — valida il token e restituisce lo stato aggiornato dell'account.
	// Rileggere dal DB (invece di fidarsi del solo JWT) fa sì che una disattivazione o
	// un cambio ruolo abbiano effetto immediato, senza aspettare la scadenza del token.
	fastify.get('/api/auth/me', async (request, reply) => {
		const claims = getUserFromRequest(request);
		if (!claims) return reply.code(401).send({ error: 'Non autenticato.' });

		const [account] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, claims.sub)).limit(1);
		if (!account || !account.attivo) return reply.code(401).send({ error: 'Non autenticato.' });

		return { user: toPublicUser(account) };
	});

	// POST /api/auth/logout — con i JWT stateless il logout è lato client (scarta il
	// token); l'endpoint esiste per simmetria e per poter aggiungere in futuro una
	// blocklist dei token senza cambiare il contratto col frontend.
	fastify.post('/api/auth/logout', async () => ({ success: true }));

	// POST /api/auth/change-password { current_password, new_password }
	fastify.post('/api/auth/change-password', async (request, reply) => {
		const claims = getUserFromRequest(request);
		if (!claims) return reply.code(401).send({ error: 'Non autenticato.' });

		const { current_password: currentPassword, new_password: newPassword } = request.body ?? {};
		if (!currentPassword || !newPassword) {
			return reply.code(400).send({ error: 'Password attuale e nuova sono obbligatorie.' });
		}
		if (newPassword.length < 8) {
			return reply.code(400).send({ error: 'La nuova password deve avere almeno 8 caratteri.' });
		}

		const [account] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, claims.sub)).limit(1);
		if (!account) return reply.code(401).send({ error: 'Non autenticato.' });

		if (!(await bcrypt.compare(currentPassword, account.passwordHash))) {
			return reply.code(400).send({ error: 'Password attuale non corretta.' });
		}

		await db
			.update(staffAccounts)
			.set({ passwordHash: await bcrypt.hash(newPassword, 10) })
			.where(eq(staffAccounts.id, account.id));

		// Chi conosceva la vecchia password non deve restare dentro: cambiarla butta fuori
		// tutte le sessioni di questo account, compresa quella da cui si sta chiedendo.
		await revocaSessioniDi(account.id);

		return { success: true };
	});
}

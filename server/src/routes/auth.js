// Autenticazione applicativa: sostituisce il provider esterno usato prima e il confronto di
// password in chiaro che StaffAuthContext/MemberAuthContext facevano lato browser.
// Un solo sistema per staff e member, distinti dal campo `ruolo`.
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts } from '../db/schema/index.js';
import { signToken, getUserFromRequest } from '../auth/tokens.js';
import { matriceCorrente } from '../../../shared/permissions.js';
import { motivoPasswordNonValida } from '../../../shared/password.js';
import { secondiDiAttesa, registraFallimento, registraSuccesso } from '../lib/tentativiAccesso.js';
import { config } from '../config.js';
import { registra } from '../lib/registro.js';

// Un hash vero di una password che nessuno ha: serve a far durare un login su un'email
// inesistente quanto uno su un'email che esiste. Stesso costo (10) degli hash degli account.
const HASH_FITTIZIO = bcrypt.hashSync('nessun-account-ha-questa-password', 10);

/** L'IP di chi si collega: dall'intestazione del proxy se ce n'è uno (config.intestazioneIp). */
function ipDi(request) {
	const daProxy = config.intestazioneIp && request.headers[config.intestazioneIp];
	return String(daProxy || request.ip || '').split(',')[0].trim() || null;
}

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
		// Vera se la password l'ha scelta qualcun altro: le schermate mostrano solo il cambio
		// password, e il server rifiuta il resto finché non è fatto.
		password_da_cambiare: account.passwordDaCambiare,
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

		const ip = ipDi(request);
		const attesa = secondiDiAttesa(email, ip);
		if (attesa > 0) {
			reply.header('Retry-After', String(attesa));
			return reply.code(429).send({ error: `Troppi tentativi falliti. Riprova fra ${Math.ceil(attesa / 60)} minuti.` });
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

		// Il confronto si fa sempre, anche senza account, contro un hash fittizio: se l'email non
		// esisteva la risposta arrivava subito, se esisteva dopo il calcolo di bcrypt, e dal tempo
		// di risposta si capiva quali email hanno un account.
		const passwordOk = await bcrypt.compare(String(password), account?.passwordHash ?? HASH_FITTIZIO);
		if (!account || !account.attivo || !passwordOk) {
			registraFallimento(email, ip);
			return reply.code(401).send(invalid);
		}
		registraSuccesso(email);

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
		const nonValida = motivoPasswordNonValida(newPassword);
		if (nonValida) return reply.code(400).send({ error: nonValida });
		if (newPassword === currentPassword) {
			return reply.code(400).send({ error: 'La nuova password deve essere diversa da quella attuale.' });
		}

		const [account] = await db.select().from(staffAccounts).where(eq(staffAccounts.id, claims.sub)).limit(1);
		if (!account) return reply.code(401).send({ error: 'Non autenticato.' });

		if (!(await bcrypt.compare(currentPassword, account.passwordHash))) {
			return reply.code(400).send({ error: 'Password attuale non corretta.' });
		}

		// Chi conosceva la vecchia password non deve restare dentro: cambiarla butta fuori tutte
		// le sessioni di questo account. Quella da cui si sta chiedendo riceve un token nuovo,
		// con il numero di versione nuovo: chi ha appena cambiato la password non deve
		// rientrare, e dopo un cambio obbligato sarebbe un giro in più senza motivo.
		const [aggiornato] = await db
			.update(staffAccounts)
			.set({
				passwordHash: await bcrypt.hash(newPassword, 10),
				passwordDaCambiare: false,
				tokenVersion: sql`${staffAccounts.tokenVersion} + 1`,
			})
			.where(eq(staffAccounts.id, account.id))
			.returning();

		await registra(claims, {
			tipoAzione: 'password_change', entitaTipo: 'staff_account', entitaNome: aggiornato.nome, entitaId: aggiornato.id,
			dettagli: account.passwordDaCambiare ? 'Password scelta al primo accesso' : "Password cambiata dall'interessato",
		}, request.log);

		return {
			success: true,
			token: signToken({ sub: aggiornato.id, ruolo: aggiornato.ruolo, tv: aggiornato.tokenVersion }),
			user: toPublicUser(aggiornato),
		};
	});
}

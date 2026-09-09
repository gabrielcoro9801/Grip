// Creazione del primo amministratore all'avvio, quando non esiste nessun account.
//
// Il problema che risolve: un'installazione appena messa online ha un database vuoto, e per
// creare un account bisogna essere autenticati — la schermata degli utenti è dietro il login.
// Si esce da questo cerchio solo dall'esterno, e su una piattaforma a container le due strade
// sono entrambe sgradevoli: esporre il database su internet, oppure aprire un accesso SSH
// alla macchina. Per un gestionale venduto ad altre associazioni significherebbe chiedere a
// ognuna di fare una di quelle due cose al primo avvio.
//
// Qui il primo account nasce dall'interno, dove il database è raggiungibile senza aprire
// niente, leggendo le stesse variabili che il seed userebbe.
//
// Tre condizioni, tutte necessarie:
//  1. non esiste **nessun** account — non è un modo per aggiungerne, solo per partire;
//  2. `SEED_ADMIN_PASSWORD` è impostata — senza, non si inventa una password;
//  3. si esegue una volta sola, perché dalla seconda la condizione 1 è falsa.
//
// Conseguenza utile: se un giorno si perdessero tutti gli account, basta riavviare per
// rientrare. Conseguenza da conoscere: chi può impostare le variabili d'ambiente del servizio
// può, su un archivio vuoto, creare l'amministratore. Ma chi può impostare le variabili
// controlla già il segreto dei token, quindi non è un potere nuovo.
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { staffAccounts, organizations } from '../db/schema/index.js';
import { bootstrapRuoli } from './ruoli.js';

export async function creaAmministratoreIniziale(log) {
	const [{ quanti }] = await db
		.select({ quanti: sql`count(*)::int`.as('quanti') })
		.from(staffAccounts);

	if (quanti > 0) return { creato: false, motivo: 'esistono già degli account' };

	const email = process.env.SEED_ADMIN_EMAIL;
	const password = process.env.SEED_ADMIN_PASSWORD;

	if (!password) {
		log?.warn(
			"Nessun account presente e SEED_ADMIN_PASSWORD non impostata: nessuno potrà accedere. " +
			"Imposta SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD fra le variabili e riavvia.",
		);
		return { creato: false, motivo: 'password non impostata' };
	}
	if (!email) {
		log?.warn('Nessun account presente e SEED_ADMIN_EMAIL non impostata: indicala e riavvia.');
		return { creato: false, motivo: 'email non impostata' };
	}

	// L'ente e i suoi ruoli servono comunque: senza organizzazione l'applicazione non sa a
	// chi appartengono i dati, e senza ruoli non si decide chi può fare cosa.
	const [enteEsistente] = await db.select().from(organizations).limit(1);
	const ente = enteEsistente ?? (await db
		.insert(organizations)
		.values({ nome: process.env.SEED_ORGANIZZAZIONE || 'La mia associazione' })
		.returning())[0];

	const ruoliCreati = await bootstrapRuoli(ente.id);

	await db.insert(staffAccounts).values({
		nome: 'Amministratore',
		email,
		passwordHash: await bcrypt.hash(password, 10),
		ruolo: 'admin',
		attivo: true,
	});

	log?.info(
		`Primo avvio: creato l'amministratore ${email} per "${ente.nome}" (${ruoliCreati} ruoli). ` +
		'Cambia la password dopo il primo accesso.',
	);

	return { creato: true, email, organizzazione: ente.nome };
}

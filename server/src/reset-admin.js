// Rimette in piedi un amministratore: cambia la password e, se serve, il ruolo.
//
// Esiste per un caso preciso e non improbabile: il primo account si crea con `db:seed`, che
// se l'account c'è già **lascia la password invariata**. Sbagliandola a digitare, o
// dimenticandola, si resta chiusi fuori dalla produzione senza nessun modo di rientrare
// dall'applicazione — la schermata da cui si gestiscono gli account è dietro il login.
//
// Uso:
//   RESET_EMAIL=tu@esempio.it RESET_PASSWORD='nuova-lunga' npm run db:reset-admin
//   railway run npm --prefix server run db:reset-admin      (per la produzione)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { staffAccounts } from './db/schema/index.js';
import { annunciaDatabase } from './lib/descriviDatabase.js';

const EMAIL = process.env.RESET_EMAIL;
const PASSWORD = process.env.RESET_PASSWORD;

annunciaDatabase();

if (!EMAIL || !PASSWORD) {
	console.error('Servono RESET_EMAIL e RESET_PASSWORD.');
	console.error("Esempio:  RESET_EMAIL=tu@esempio.it RESET_PASSWORD='nuova-lunga' npm run db:reset-admin");
	process.exit(1);
}

// Una password corta qui è un problema serio: questo account può tutto, ed è raggiungibile
// da internet. Meglio rifiutare che lasciar passare una scelta frettolosa.
if (PASSWORD.length < 12) {
	console.error(`La password è di ${PASSWORD.length} caratteri: ne servono almeno 12.`);
	console.error("Questo account ha accesso a tutto ed è esposto su internet.");
	process.exit(1);
}

const [account] = await db
	.select()
	.from(staffAccounts)
	.where(sql`lower(${staffAccounts.email}) = lower(${EMAIL})`)
	.limit(1);

if (!account) {
	console.error(`Nessun account con email ${EMAIL}.`);
	console.error('Per crearne uno da zero usa `npm run db:seed`.');
	await pool.end();
	process.exit(1);
}

const ruoloPrecedente = account.ruolo;

await db
	.update(staffAccounts)
	.set({
		passwordHash: await bcrypt.hash(PASSWORD, 10),
		// Riattivato e riportato ad amministratore: se si è arrivati qui è perché serve
		// rientrare, e un account disattivato o declassato non risolverebbe il problema.
		ruolo: 'admin',
		attivo: true,
	})
	.where(sql`${staffAccounts.id} = ${account.id}`);

console.log(`Password aggiornata per ${account.email}.`);
if (ruoloPrecedente !== 'admin') console.log(`Ruolo portato da "${ruoloPrecedente}" ad "admin".`);
if (!account.attivo) console.log('Account riattivato.');

await pool.end();
process.exit(0);

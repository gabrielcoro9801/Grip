// Applica le migrazioni al database. Da eseguire prima di avviare il server.
//
// In locale si usa `npm run db:migrate`, che passa da drizzle-kit. In produzione no:
// drizzle-kit è uno strumento di sviluppo e non viene installato (`--omit=dev`). Qui si usa
// il migratore incluso in `drizzle-orm`, che è già una dipendenza di produzione e legge le
// stesse cartelle `drizzle/` — quindi applica esattamente le stesse migrazioni.
//
// Va eseguito a ogni deploy, non solo al primo: è il modo in cui una modifica allo schema
// arriva sul database di produzione. Le migrazioni già applicate vengono saltate.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './db/client.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL non impostata: non so a quale database applicare le migrazioni.');
	process.exit(1);
}

try {
	await migrate(db, { migrationsFolder: path.join(serverRoot, 'drizzle') });
	console.log('Migrazioni applicate.');
	await pool.end();
	process.exit(0);
} catch (errore) {
	console.error('Migrazioni fallite:', errore.message);
	// Uscire con errore ferma il deploy: un server avviato su uno schema incompleto
	// risponderebbe con errori incomprensibili invece di non partire affatto.
	await pool.end().catch(() => {});
	process.exit(1);
}

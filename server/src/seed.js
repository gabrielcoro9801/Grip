// Seed minimo per rendere l'applicazione utilizzabile da zero.
//
// Serve a risolvere il problema dell'uovo e la gallina introdotto dalla protezione
// degli endpoint: per creare un account bisogna essere autenticati, quindi il primo
// account deve nascere fuori dall'API. Il resto dei dati di base (piano dei conti,
// causali operative) viene già creato dall'app stessa al primo accesso.
//
// Uso:  npm run db:seed
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { staffAccounts, organizations } from './db/schema/index.js';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@grip.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin1234';

async function seed() {
	const [existingOrg] = await db.select().from(organizations).limit(1);
	const org = existingOrg ?? (await db.insert(organizations).values({ nome: 'La mia palestra' }).returning())[0];
	console.log(existingOrg ? `Organizzazione già presente: ${org.nome}` : `Creata organizzazione: ${org.nome}`);

	const [existingAdmin] = await db
		.select()
		.from(staffAccounts)
		.where(eq(staffAccounts.email, ADMIN_EMAIL))
		.limit(1);

	if (existingAdmin) {
		console.log(`Account admin già presente: ${ADMIN_EMAIL} (password invariata)`);
	} else {
		await db.insert(staffAccounts).values({
			nome: 'Amministratore',
			email: ADMIN_EMAIL,
			passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
			ruolo: 'admin',
			attivo: true,
		});
		console.log(`Creato account admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
		console.log('Cambia questa password dopo il primo accesso.');
	}

	process.exit(0);
}

seed().catch((error) => {
	console.error('Seed fallito:', error);
	process.exit(1);
});

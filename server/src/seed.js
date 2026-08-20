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
import { bootstrapContabilita } from './lib/bootstrapContabilita.js';

const NOME_ORGANIZZAZIONE = process.env.SEED_ORGANIZZAZIONE || 'La mia associazione';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@grip.local';
// La password del primo account è nota a chiunque legga questo file: in sviluppo è una
// comodità, altrove è una porta aperta. Fuori dallo sviluppo va indicata, e il seed si
// rifiuta di procedere senza.
const PASSWORD_DI_SVILUPPO = 'admin1234';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD
	|| ((process.env.NODE_ENV || 'development') !== 'production'
		? PASSWORD_DI_SVILUPPO
		: null);

async function seed() {
	if (!ADMIN_PASSWORD) {
		console.error('SEED_ADMIN_PASSWORD non impostata.');
		console.error('Con NODE_ENV=production il primo account non può nascere con una password');
		console.error('scritta nel codice sorgente: indicane una.');
		process.exit(1);
	}

	const [existingOrg] = await db.select().from(organizations).limit(1);
	const org = existingOrg ?? (await db.insert(organizations).values({ nome: NOME_ORGANIZZAZIONE }).returning())[0];
	console.log(existingOrg ? `Organizzazione già presente: ${org.nome}` : `Creata organizzazione: ${org.nome}`);

	// Piano dei conti e causali: prima li creava il browser al primo accesso, il che
	// significava che lo scheletro contabile lo costruiva chi apriva l'app per primo.
	const { contiCreati, causaliCreate, aliquotaIva } = await bootstrapContabilita(org.id);
	console.log(contiCreati ? `Creati ${contiCreati} conti e ${causaliCreate} causali (IVA ordinaria ${aliquotaIva ?? '?'}%)` : 'Piano dei conti già presente');

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

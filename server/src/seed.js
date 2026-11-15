// Seed minimo per rendere l'applicazione utilizzabile da zero: l'organizzazione, i ruoli e il primo
// amministratore, da ADMIN_EMAIL e ADMIN_PASSWORD (lib/primoAccesso.js). Uso:  npm run db:seed
import 'dotenv/config';
import { annunciaDatabase } from './lib/descriviDatabase.js';
import { creaAmministratoreIniziale } from './lib/primoAccesso.js';

annunciaDatabase();
creaAmministratoreIniziale(console)
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('Seed fallito:', error.message);
		process.exit(1);
	});
